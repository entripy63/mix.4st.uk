// Stream proxy for Deno Deploy
// Handles CORS, redirects, Range headers, and ICY/Shoutcast raw TCP fallback

const CORS_EXPOSE = "Icy-MetaInt, Icy-Br, Icy-Name, Icy-Genre, Icy-Url, Icy-Description, Ice-Audio-Info, Content-Length, Content-Range, Accept-Ranges, Content-Type";

// ── Abuse-protection config (tune here) ──────────────────────────────────
// Allowed page origin: 4st.uk and any subdomain (covers test + production).
const ALLOWED_ORIGIN_SUFFIX = "4st.uk";
// Final-response Content-Types that are never a stream but are high-value for
// abuse (SSRF / using the proxy as a generic web scraper). Blocked outright.
// NOTE: only applied to the FINAL response, never to redirect hops.
const BLOCKED_CONTENT_TYPES = [
  "text/html", "application/xhtml+xml", "application/json",
  "application/xml", "text/xml", "application/rss+xml",
  "application/atom+xml", "text/csv",
];
// All abuse protection here is STATELESS (origin + proto + content-type + SSRF
// IP block) so it works identically across Deno Deploy's ephemeral, multi-
// isolate environment. Volumetric rate limiting is delegated to the platform.
// ─────────────────────────────────────────────────────────────────────────

class BlockedAddressError extends Error {}

function originAllowed(raw: string): boolean {
  if (!raw) return false;
  let host: string;
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return false; }
  return host === ALLOWED_ORIGIN_SUFFIX || host.endsWith("." + ALLOWED_ORIGIN_SUFFIX);
}

function clientIP(req: Request, info?: Deno.ServeHandlerInfo): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const addr = info?.remoteAddr;
  if (addr && addr.transport === "tcp") return addr.hostname.replace(/^::ffff:/i, "");
  return "unknown";
}

function isBlockedContentType(ct: string | null): boolean {
  if (!ct) return false;
  return BLOCKED_CONTENT_TYPES.includes(ct.split(";")[0].trim().toLowerCase());
}

// Reject loopback / private / link-local / CGNAT / metadata / multicast IPs.
function isBlockedIP(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/i, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const o = v4.split(".").map(Number);
    if (o[0] === 0 || o[0] === 127) return true;                // this-host / loopback
    if (o[0] === 10) return true;                               // 10/8
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;  // 172.16/12
    if (o[0] === 192 && o[1] === 168) return true;              // 192.168/16
    if (o[0] === 169 && o[1] === 254) return true;              // link-local + cloud metadata
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // CGNAT 100.64/10
    if (o[0] >= 224) return true;                               // multicast / reserved
    return false;
  }
  const lc = ip.toLowerCase();
  if (lc === "::" || lc === "::1") return true;                 // unspecified / loopback
  if (lc.startsWith("fe80")) return true;                       // link-local
  if (lc.startsWith("fc") || lc.startsWith("fd")) return true;  // unique local fc00::/7
  if (lc.startsWith("ff")) return true;                         // multicast
  return false;
}

// Reject private/reserved destinations (literal IPs and resolved names).
// Throws BlockedAddressError if blocked.
async function assertAllowedHost(hostname: string): Promise<void> {
  const h = hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  const looksLikeIP = /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":");
  if (looksLikeIP) {
    if (isBlockedIP(h)) throw new BlockedAddressError("Blocked destination: " + h);
    return;
  }
  const addrs: string[] = [];
  try { addrs.push(...await Deno.resolveDns(h, "A")); } catch { /* ignore */ }
  try { addrs.push(...await Deno.resolveDns(h, "AAAA")); } catch { /* ignore */ }
  for (const a of addrs) {
    if (isBlockedIP(a)) throw new BlockedAddressError("Blocked destination: " + a);
  }
}

function logRequest(ip: string, host: string, ct: string | null, status: number): void {
  console.log(`[proxy] ip=${ip} host=${host} ct=${ct || "-"} status=${status}`);
}

// Infer Content-Type from URL extension when upstream returns a generic type
function inferContentType(upstreamCT: string | null, targetUrl: string): string {
  if (upstreamCT && upstreamCT !== "application/octet-stream" && upstreamCT !== "binary/octet-stream") {
    return upstreamCT;
  }
  try {
    const ext = new URL(targetUrl).pathname.split(".").pop()?.toLowerCase();
    const types: Record<string, string> = {
      mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", opus: "audio/opus",
      flac: "audio/flac", wav: "audio/wav", aac: "audio/aac", webm: "audio/webm",
    };
    return (ext && types[ext]) || upstreamCT || "application/octet-stream";
  } catch (_) { return upstreamCT || "application/octet-stream"; }
}

Deno.serve(async (req: Request, info: Deno.ServeHandlerInfo): Promise<Response> => {
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

  // Stateless abuse checks. Legitimate traffic is always HTTPS; reject plain
  // http when the platform reports the original scheme.
  const proto = req.headers.get("x-forwarded-proto");
  if (proto && proto !== "https") {
    return new Response("Forbidden", {
      status: 403,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  // Origin validation
  const origin = req.headers.get("Origin") || req.headers.get("Referer") || "";
  if (!originAllowed(origin)) {
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

  const ip = clientIP(req, info);
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
    return await doFetchRequest(streamUrl, fetchHeaders, icyMeta, 0, streamUrl, ip, req.signal);
  } catch (e) {
    if (e instanceof BlockedAddressError) {
      logRequest(ip, "-", null, 403);
      return new Response("Forbidden destination", {
        status: 403,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }
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
  originalUrl: string,
  ip: string,
  signal: AbortSignal,
): Promise<Response> {
  if (redirectCount > 5) {
    return new Response("Too many redirects", {
      status: 502,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  const target = new URL(targetUrl);

  // Block private/reserved destinations (checked at every redirect hop).
  await assertAllowedHost(target.hostname);

  // For http:// URLs, try raw TCP first if it's likely an ICY server
  // (Deno's fetch() will also fail on ICY responses)
  if (target.protocol === "http:") {
    try {
      // Pass the client's abort signal so a disconnect tears down the upstream
      // fetch (otherwise the runtime can keep draining an infinite live stream).
      const response = await fetch(targetUrl, { headers, redirect: "manual", signal });

      // Handle redirects manually
      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers.get("Location");
        if (location) {
          response.body?.cancel();
          return doFetchRequest(location, headers, icyMeta, redirectCount + 1, originalUrl, ip, signal);
        }
      }

      return buildProxyResponse(response, originalUrl, ip);
    } catch (e) {
      if (e instanceof BlockedAddressError) throw e;
      // Client went away mid-fetch — don't open a fresh raw connection.
      if (signal.aborted || (e instanceof Error && e.name === "AbortError")) throw e;
      // fetch() failed — likely an ICY/Shoutcast server, try raw TCP
      return doRawRequest(target, icyMeta, ip, signal);
    }
  }

  // HTTPS — use fetch() directly
  const response = await fetch(targetUrl, { headers, redirect: "manual", signal });

  if ([301, 302, 307, 308].includes(response.status)) {
    const location = response.headers.get("Location");
    if (location) {
      response.body?.cancel();
      return doFetchRequest(location, headers, icyMeta, redirectCount + 1, originalUrl, ip, signal);
    }
  }

  return buildProxyResponse(response, originalUrl, ip);
}

function buildProxyResponse(upstream: Response, originalUrl: string, ip: string): Response {
  // Final response only: reject high-abuse, never-a-stream content types.
  const upstreamCT = upstream.headers.get("Content-Type");
  if (isBlockedContentType(upstreamCT)) {
    upstream.body?.cancel();
    logRequest(ip, new URL(originalUrl).hostname, upstreamCT, 415);
    return new Response("Unsupported content type", {
      status: 415,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  const responseHeaders: Record<string, string> = {
    "Content-Type": inferContentType(upstreamCT, originalUrl),
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

  logRequest(ip, new URL(originalUrl).hostname, upstreamCT, upstream.status);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

// Raw TCP fallback for ICY/Shoutcast servers that don't speak valid HTTP
async function doRawRequest(target: URL, icyMeta: string, ip: string, signal: AbortSignal): Promise<Response> {
  await assertAllowedHost(target.hostname);
  const port = parseInt(target.port) || 80;
  const path = target.pathname + target.search;

  const conn = await Deno.connect({ hostname: target.hostname, port });

  // Close the upstream socket the moment the client disconnects. Without this
  // the socket (and the live server pushing into it) lingers, draining data the
  // client will never receive — the in≫out leak that held memory for hours.
  let connClosed = false;
  const closeConn = () => {
    if (connClosed) return;
    connClosed = true;
    signal.removeEventListener("abort", closeConn);
    try { conn.close(); } catch { /* ignore */ }
  };
  if (signal.aborted) {
    closeConn();
    return new Response("Client gone", { status: 499, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  signal.addEventListener("abort", closeConn);

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

      // Final response only: reject high-abuse, never-a-stream content types.
      if (isBlockedContentType(contentType)) {
        closeConn();
        logRequest(ip, target.hostname, contentType, 415);
        return new Response("Unsupported content type", {
          status: 415,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }
      logRequest(ip, target.hostname, contentType, 200);

      // Stream the response using a ReadableStream
      const responseHeaders: Record<string, string> = {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": CORS_EXPOSE,
        ...icyHeaders,
      };

      const readBuf = new Uint8Array(16384);
      const stream = new ReadableStream({
        start(controller) {
          if (remainingBody.length > 0) {
            controller.enqueue(remainingBody);
          }
        },
        async pull(controller) {
          try {
            const n = await conn.read(readBuf);
            if (n === null) {
              closeConn();
              controller.close();
              return;
            }
            controller.enqueue(readBuf.slice(0, n));
          } catch {
            closeConn();
            // If the client aborted, this is expected teardown, not an error.
            if (signal.aborted) { try { controller.close(); } catch { /* ignore */ } return; }
            controller.error(new Error("network error"));
          }
        },
        cancel() {
          closeConn();
        },
      });

      return new Response(stream, { status: 200, headers: responseHeaders });
    }

    // Safety: don't read more than 16KB of headers
    if (totalRead > 16384) break;
  }

  closeConn();
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
