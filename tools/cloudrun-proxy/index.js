const http = require('http');
const https = require('https');
const net = require('net');
const dns = require('dns');

const PORT = process.env.PORT || 8080;

// ── Abuse protection (all STATELESS) ─────────────────────────────────────
// Everything here survives Cloud Run's hourly instance suspend/replace and
// multi-instance scaling because it keeps no per-connection state. Volumetric
// rate limiting is delegated to the infrastructure layer (Cloud Armor /
// Cloudflare rules / host nftables), which is the only place it can be done
// reliably across ephemeral, multi-instance deployments.
//
// Allowed page origin: 4st.uk and any subdomain (covers test + production).
const ALLOWED_ORIGIN_SUFFIX = '4st.uk';
// Final-response Content-Types that are never a stream but are high-value for
// abuse (SSRF / using the proxy as a generic web scraper). Blocked outright.
// Only applied to the FINAL response, never to redirect hops.
const BLOCKED_CONTENT_TYPES = [
  'text/html', 'application/xhtml+xml', 'application/json',
  'application/xml', 'text/xml', 'application/rss+xml',
  'application/atom+xml', 'text/csv'
];
const EXPOSE_HEADERS = 'Icy-MetaInt, Icy-Br, Icy-Name, Icy-Genre, Icy-Url, Icy-Description, Ice-Audio-Info, Content-Length, Content-Range, Accept-Ranges';
// ─────────────────────────────────────────────────────────────────────────

// Live responses, for an accurate /status count that does NOT depend on
// graceful close firing — Cloud Run suspends instances without running close
// handlers, so a decrement-on-close counter leaks. We instead prune dead
// sockets on read, which self-heals after a suspend/resume.
const activeResponses = new Set();
function liveCount() {
  for (const r of activeResponses) {
    if (r.writableEnded || r.destroyed || (r.socket && r.socket.destroyed)) {
      activeResponses.delete(r);
    }
  }
  return activeResponses.size;
}

// Every response — success OR error — must carry CORS headers, otherwise the
// browser reports "CORS header missing" instead of the real status and the
// app's proxy-fallback logic can't see the failure to try the next proxy.
function deny(res, status, message) {
  if (!res.headersSent) {
    res.writeHead(status, { 'Access-Control-Allow-Origin': '*' });
    res.end(message);
  }
}

function originAllowed(raw) {
  if (!raw) return false;
  let host;
  try { host = new URL(raw).hostname.toLowerCase(); } catch (_) { return false; }
  return host === ALLOWED_ORIGIN_SUFFIX || host.endsWith('.' + ALLOWED_ORIGIN_SUFFIX);
}

function isBlockedContentType(ct) {
  if (!ct) return false;
  return BLOCKED_CONTENT_TYPES.includes(ct.split(';')[0].trim().toLowerCase());
}

// Reject loopback / private / link-local / CGNAT / metadata / multicast IPs.
function isBlockedIP(ip) {
  const v4 = ip.replace(/^::ffff:/i, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const o = v4.split('.').map(Number);
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
  if (lc === '::' || lc === '::1') return true;                 // unspecified / loopback
  if (lc.startsWith('fe80')) return true;                       // link-local
  if (lc.startsWith('fc') || lc.startsWith('fd')) return true;  // unique local fc00::/7
  if (lc.startsWith('ff')) return true;                         // multicast
  return false;
}

// Validate a destination host (literal IP or resolved name) against the SSRF
// block-list. Calls cb(blocked). Fails open on resolution error so a transient
// DNS hiccup never blocks a legitimate stream; the real connection then errors
// normally. Uses the platform's default connection logic (no custom lookup) so
// streaming/family-selection behaviour is unchanged.
function checkHostAllowed(hostname, cb) {
  const h = hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (net.isIP(h) !== 0) { cb(isBlockedIP(h)); return; }
  dns.lookup(h, { all: true }, (err, addrs) => {
    if (err) { cb(false); return; }
    cb(addrs.some(a => isBlockedIP(a.address)));
  });
}

function clientIP(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function logRequest(ip, host, ct, status) {
  console.log(`[proxy] ip=${ip} host=${host} ct=${ct || '-'} status=${status}`);
}

// Infer Content-Type from URL extension when upstream returns a generic type
function inferContentType(upstreamCT, targetUrl) {
  if (upstreamCT && upstreamCT !== 'application/octet-stream' && upstreamCT !== 'binary/octet-stream') {
    return upstreamCT;
  }
  try {
    const ext = new URL(targetUrl).pathname.split('.').pop().toLowerCase();
    const types = { mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/opus',
                    flac: 'audio/flac', wav: 'audio/wav', aac: 'audio/aac', webm: 'audio/webm' };
    return types[ext] || upstreamCT || 'application/octet-stream';
  } catch (_) { return upstreamCT || 'application/octet-stream'; }
}

const server = http.createServer((req, res) => {
  // Status endpoint (no checks needed)
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ active: liveCount(), mem: Math.round(process.memoryUsage().rss / 1048576) + 'MB' }));
    return;
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Icy-Metadata',
      'Access-Control-Expose-Headers': EXPOSE_HEADERS,
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  // ── Stateless abuse checks ──────────────────────────────────────────────
  // Legitimate traffic is always HTTPS. Reject plain-http when the platform
  // tells us the original scheme (header absent => allow; the NUC's firewall
  // blocks non-443 at the packet level).
  const proto = req.headers['x-forwarded-proto'];
  if (proto && proto !== 'https') { deny(res, 403, 'Forbidden'); return; }

  const origin = req.headers['origin'] || req.headers['referer'] || '';
  if (!originAllowed(origin)) { deny(res, 403, 'Forbidden'); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const streamUrl = url.searchParams.get('url');
  if (!streamUrl) { deny(res, 400, 'Missing url parameter'); return; }

  const ip = clientIP(req);
  activeResponses.add(res);
  res.on('close', () => activeResponses.delete(res));

  // Allow client to control ICY metadata via ?icy=0 (default: 1)
  const icyMeta = url.searchParams.get('icy') === '1' ? '1' : '0';

  const fetchHeaders = {
    'User-Agent': 'AudioPlayer/1.0',
    'Icy-MetaData': icyMeta
  };

  if (req.headers['range']) {
    fetchHeaders['Range'] = req.headers['range'];
  }

  function doRequest(targetUrl, redirectCount) {
    if (redirectCount > 5) {
      deny(res, 502, 'Too many redirects');
      return;
    }

    let target;
    try { target = new URL(targetUrl); } catch (_) { deny(res, 400, 'Invalid URL'); return; }

    // SSRF guard: reject private/reserved destinations (every redirect hop).
    checkHostAllowed(target.hostname, (blocked) => {
      if (blocked) {
        logRequest(ip, target.hostname, '-', 403);
        deny(res, 403, 'Forbidden destination');
        return;
      }

      const transport = target.protocol === 'https:' ? https : http;

      const proxyReq = transport.request(target, { headers: fetchHeaders }, (proxyRes) => {
        if ([301, 302, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers['location']) {
          proxyRes.resume();
          doRequest(proxyRes.headers['location'], redirectCount + 1);
          return;
        }

        // Final response only: reject high-abuse, never-a-stream content types.
        const upstreamCT = proxyRes.headers['content-type'];
        if (isBlockedContentType(upstreamCT)) {
          logRequest(ip, target.hostname, upstreamCT, 415);
          proxyRes.resume();
          proxyReq.destroy();
          deny(res, 415, 'Unsupported content type');
          return;
        }

        const responseHeaders = {
          'Content-Type': inferContentType(upstreamCT, streamUrl),
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': EXPOSE_HEADERS
        };

        ['content-length', 'content-range', 'accept-ranges', 'content-encoding'].forEach(h => {
          if (proxyRes.headers[h]) {
            responseHeaders[h] = proxyRes.headers[h];
          }
        });

        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (key.startsWith('icy-') || key.startsWith('ice-')) {
            responseHeaders[key] = value;
          }
        }

        res.writeHead(proxyRes.statusCode, responseHeaders);
        logRequest(ip, target.hostname, upstreamCT, proxyRes.statusCode);
        proxyRes.pipe(res);

        res.on('close', () => { proxyRes.destroy(); proxyReq.destroy(); });
      });

      proxyReq.setTimeout(10000, () => {
        proxyReq.destroy();
        deny(res, 504, 'Upstream timeout');
      });

      proxyReq.on('error', (err) => {
        if (err.code === 'HPE_INVALID_CONSTANT') {
          doRawRequest(target, res, icyMeta, ip);
        } else {
          deny(res, 502, 'Upstream error');
        }
      });

      proxyReq.end();
    });
  }

  doRequest(streamUrl, 0);
});

// Raw TCP fallback for ICY/Shoutcast servers that don't speak valid HTTP.
// Reached only after checkHostAllowed() has already validated this target.
function doRawRequest(target, res, icyMeta, ip) {
  const port = target.port || 80;
  const path = target.pathname + target.search;
  const socket = net.connect(port, target.hostname, () => {
    socket.write(`GET ${path} HTTP/1.0\r\nHost: ${target.host}\r\nUser-Agent: AudioPlayer/1.0\r\nIcy-MetaData: ${icyMeta}\r\nConnection: close\r\n\r\n`);
  });

  let headersParsed = false;
  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    if (headersParsed) {
      res.write(chunk);
      return;
    }

    buffer = Buffer.concat([buffer, chunk]);
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;

    const headerStr = buffer.slice(0, headerEnd).toString();
    const body = buffer.slice(headerEnd + 4);
    headersParsed = true;

    let contentType = 'audio/mpeg';
    const icyHeaders = {};
    for (const line of headerStr.split('\r\n')) {
      const ctMatch = line.match(/^content-type:\s*(.+)/i);
      if (ctMatch) contentType = ctMatch[1].trim();
      const icyMatch = line.match(/^(icy-[^:]+|ice-[^:]+):\s*(.+)/i);
      if (icyMatch) icyHeaders[icyMatch[1].toLowerCase()] = icyMatch[2].trim();
    }

    // Final response only: reject high-abuse, never-a-stream content types.
    if (isBlockedContentType(contentType)) {
      logRequest(ip, target.hostname, contentType, 415);
      socket.destroy();
      deny(res, 415, 'Unsupported content type');
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': EXPOSE_HEADERS,
      ...icyHeaders
    });
    logRequest(ip, target.hostname, contentType, 200);

    if (body.length) res.write(body);
  });

  socket.on('error', () => {
    deny(res, 502, 'Upstream error');
  });

  socket.on('end', () => {
    if (!res.destroyed) {
      res.end();
    }
  });
  res.on('close', () => socket.destroy());
}

server.listen(PORT, () => {
  console.log('Stream proxy listening on port ' + PORT);
});
