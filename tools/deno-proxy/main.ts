// Stream proxy for Deno Deploy
// Handles CORS, redirects, Range headers, and ICY/Shoutcast raw TCP fallback

const ALLOWED_ORIGINS = ["4st.uk", "steveqv225"];
const CORS_EXPOSE = "Icy-MetaInt, Icy-Br, Icy-Name, Icy-Genre, Icy-Url, Icy-Description, Ice-Audio-Info, Content-Length, Content-Range, Accept-Ranges, Content-Type";

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  // Status endpoint
  if (url.pathname === "/status") {
    return new Response(JSON.stringify({ status: "ok", type: "deno-deploy" }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Range, Icy-Metadata",
        "Access-Control-Expose-Headers": CORS_EXPOSE,
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // Origin validation
  const origin = req.headers.get("Origin") || req.headers.get("Referer") || "";
  if (!ALLOWED_ORIGINS.some((o) => origin.includes(o))) {
    return new Response("Forbidden", {
      status: 403,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  const streamUrl = url.searchParams.get("url");
  if (!streamUrl) {
    return new Response("Missing url parameter", {
      status: 400,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  const icyMeta = url.searchParams.get("icy") === "1" ? "1" : "0";

  const fetchHeaders: Record<string, string> = {
    "User-Agent": "AudioPlayer/1.0",
    "Icy-MetaData": icyMeta,
  };

  const rangeHeader = req.headers.get("Range");
  if (rangeHeader) {
    fetchHeaders["Range"] = rangeHeader;
  }

  try {
    return await doFetchRequest(streamUrl, fetchHeaders, icyMeta, 0);
  } catch (_e) {
    return new Response("Upstream error", {
      status: 502,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }
});

async function doFetchRequest(
  targetUrl: string,
  headers: Record<string, string>,
  icyMeta: string,
  redirectCount: number,
): Promise<Response> {
  if (redirectCount > 5) {
    return new Response("Too many redirects", {
      status: 502,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  const target = new URL(targetUrl);

  // For http:// URLs, try raw TCP first if it's likely an ICY server
  // (Deno's fetch() will also fail on ICY responses)
  if (target.protocol === "http:") {
    try {
      const response = await fetch(targetUrl, { headers, redirect: "manual" });

      // Handle redirects manually
      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers.get("Location");
        if (location) {
          response.body?.cancel();
          return doFetchRequest(location, headers, icyMeta, redirectCount + 1);
        }
      }

      return buildProxyResponse(response);
    } catch (_e) {
      // fetch() failed — likely an ICY/Shoutcast server, try raw TCP
      return doRawRequest(target, icyMeta);
    }
  }

  // HTTPS — use fetch() directly
  const response = await fetch(targetUrl, { headers, redirect: "manual" });

  if ([301, 302, 307, 308].includes(response.status)) {
    const location = response.headers.get("Location");
    if (location) {
      response.body?.cancel();
      return doFetchRequest(location, headers, icyMeta, redirectCount + 1);
    }
  }

  return buildProxyResponse(response);
}

function buildProxyResponse(upstream: Response): Response {
  const responseHeaders: Record<string, string> = {
    "Content-Type": upstream.headers.get("Content-Type") || "application/octet-stream",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": CORS_EXPOSE,
  };

  // Preserve headers for seeking and range requests
  for (const h of ["Content-Length", "Content-Range", "Accept-Ranges", "Content-Encoding"]) {
    const value = upstream.headers.get(h);
    if (value) responseHeaders[h] = value;
  }

  // Preserve ICY headers
  upstream.headers.forEach((value, key) => {
    if (key.startsWith("icy-") || key.startsWith("ice-")) {
      responseHeaders[key] = value;
    }
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

// Raw TCP fallback for ICY/Shoutcast servers that don't speak valid HTTP
async function doRawRequest(target: URL, icyMeta: string): Promise<Response> {
  const port = parseInt(target.port) || 80;
  const path = target.pathname + target.search;

  const conn = await Deno.connect({ hostname: target.hostname, port });

  const request = `GET ${path} HTTP/1.0\r\nHost: ${target.host}\r\nUser-Agent: AudioPlayer/1.0\r\nIcy-MetaData: ${icyMeta}\r\nConnection: close\r\n\r\n`;
  await conn.write(new TextEncoder().encode(request));

  // Read until we find the header/body separator
  const chunks: Uint8Array[] = [];
  let headerEnd = -1;
  let totalRead = 0;

  while (headerEnd === -1) {
    const buf = new Uint8Array(4096);
    const n = await conn.read(buf);
    if (n === null) break;
    chunks.push(buf.subarray(0, n));
    totalRead += n;

    // Check for \r\n\r\n in accumulated data
    const combined = concatUint8Arrays(chunks);
    const text = new TextDecoder().decode(combined);
    headerEnd = text.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      // Parse headers
      const headerStr = text.substring(0, headerEnd);
      const bodyStart = headerEnd + 4;
      const remainingBody = combined.subarray(new TextEncoder().encode(text.substring(0, bodyStart)).length);

      let contentType = "audio/mpeg";
      const icyHeaders: Record<string, string> = {};

      for (const line of headerStr.split("\r\n")) {
        const ctMatch = line.match(/^content-type:\s*(.+)/i);
        if (ctMatch) contentType = ctMatch[1].trim();
        const icyMatch = line.match(/^(icy-[^:]+|ice-[^:]+):\s*(.+)/i);
        if (icyMatch) icyHeaders[icyMatch[1].toLowerCase()] = icyMatch[2].trim();
      }

      // Stream the response using a ReadableStream
      const responseHeaders: Record<string, string> = {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": CORS_EXPOSE,
        ...icyHeaders,
      };

      const stream = new ReadableStream({
        start(controller) {
          // Enqueue any body data we already read
          if (remainingBody.length > 0) {
            controller.enqueue(remainingBody);
          }
        },
        async pull(controller) {
          try {
            const buf = new Uint8Array(8192);
            const n = await conn.read(buf);
            if (n === null) {
              controller.close();
              conn.close();
              return;
            }
            controller.enqueue(buf.subarray(0, n));
          } catch {
            controller.close();
            try { conn.close(); } catch { /* ignore */ }
          }
        },
        cancel() {
          try { conn.close(); } catch { /* ignore */ }
        },
      });

      return new Response(stream, { status: 200, headers: responseHeaders });
    }

    // Safety: don't read more than 16KB of headers
    if (totalRead > 16384) break;
  }

  conn.close();
  return new Response("Failed to parse upstream response", {
    status: 502,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
