// ── Abuse-protection config (tune here) ──────────────────────────────────
// Allowed page origin: 4st.uk and any subdomain (covers test + production).
const ALLOWED_ORIGIN_SUFFIX = '4st.uk';
// Final-response Content-Types that are never a stream but are high-value for
// abuse (SSRF / using the proxy as a generic web scraper). Blocked outright.
const BLOCKED_CONTENT_TYPES = [
  'text/html', 'application/xhtml+xml', 'application/json',
  'application/xml', 'text/xml', 'application/rss+xml',
  'application/atom+xml', 'text/csv'
];
// NOTE: Cloudflare Workers are stateless across isolates, so per-IP rate /
// concurrency limiting is unreliable in-code. Configure a Cloudflare
// Rate Limiting rule (dashboard / WAF) on this Worker's route instead.
// ─────────────────────────────────────────────────────────────────────────

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
    if (o[0] === 0 || o[0] === 127) return true;
    if (o[0] === 10) return true;
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    if (o[0] === 169 && o[1] === 254) return true;
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true;
    if (o[0] >= 224) return true;
    return false;
  }
  const lc = ip.toLowerCase();
  if (lc === '::' || lc === '::1') return true;
  if (lc.startsWith('fe80')) return true;
  if (lc.startsWith('fc') || lc.startsWith('fd')) return true;
  if (lc.startsWith('ff')) return true;
  return false;
}

// Cloudflare fetch() cannot reach raw IPs and the platform blocks internal
// addresses, but reject literal private-IP destinations defensively too.
function blockedLiteralIP(hostname) {
  const h = hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  const looksLikeIP = /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':');
  return looksLikeIP && isBlockedIP(h);
}

function logRequest(ip, host, ct, status) {
  console.log(`[proxy] ip=${ip} host=${host} ct=${ct || '-'} status=${status}`);
}

export default {
  async fetch(request) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Icy-Metadata',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    // Stateless abuse checks. Legitimate traffic is always HTTPS; reject plain
    // http when the platform reports the original scheme.
    const proto = request.headers.get('x-forwarded-proto');
    if (proto && proto !== 'https') {
      return new Response('Forbidden', { status: 403, headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    // Origin validation
    const origin = request.headers.get('Origin') || request.headers.get('Referer') || '';
    if (!originAllowed(origin)) {
      return new Response('Forbidden', { status: 403, headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    const url = new URL(request.url);
    const streamUrl = url.searchParams.get('url');

    // Infer Content-Type from URL extension when upstream returns a generic type
    const inferContentType = (upstreamCT, targetUrl) => {
      if (upstreamCT && upstreamCT !== 'application/octet-stream' && upstreamCT !== 'binary/octet-stream') {
        return upstreamCT;
      }
      try {
        const ext = new URL(targetUrl).pathname.split('.').pop().toLowerCase();
        const types = { mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/opus',
                        flac: 'audio/flac', wav: 'audio/wav', aac: 'audio/aac', webm: 'audio/webm' };
        return types[ext] || upstreamCT || 'application/octet-stream';
      } catch (_) { return upstreamCT || 'application/octet-stream'; }
    };
    if (!streamUrl) {
      // Status endpoint
      if (url.pathname === '/status') {
        return new Response(JSON.stringify({ status: 'ok', type: 'cloudflare-worker' }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      return new Response('Missing url parameter', {
        status: 400,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Check if this is a live stream request (icy=1 added by stream-player.js)
    const icyMeta = url.searchParams.get('icy') === '1' ? '1' : '0';

    // Build upstream request headers
    const fetchHeaders = {
      'User-Agent': 'AudioPlayer/1.0',
      'Icy-MetaData': icyMeta
    };

    const rangeHeader = request.headers.get('Range');
    if (rangeHeader) {
      fetchHeaders['Range'] = rangeHeader;
    }

    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';

    // Block literal private/reserved IP destinations (defensive).
    let targetHost;
    try { targetHost = new URL(streamUrl).hostname; } catch (_) { targetHost = ''; }
    if (targetHost && blockedLiteralIP(targetHost)) {
      logRequest(clientIp, targetHost, '-', 403);
      return new Response('Forbidden destination', {
        status: 403,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }

    try {
      // Cloudflare fetch() follows redirects automatically (up to 20)
      const response = await fetch(streamUrl, {
        headers: fetchHeaders,
        redirect: 'follow'
      });

      // Final response only: reject high-abuse, never-a-stream content types.
      const upstreamCT = response.headers.get('Content-Type');
      if (isBlockedContentType(upstreamCT)) {
        logRequest(clientIp, targetHost, upstreamCT, 415);
        return new Response('Unsupported content type', {
          status: 415,
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }

      // Build response headers
      const responseHeaders = {
        'Content-Type': inferContentType(upstreamCT, streamUrl),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type'
      };

      // Preserve headers needed for seeking and range requests
      for (const header of ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Encoding']) {
        const value = response.headers.get(header);
        if (value) responseHeaders[header] = value;
      }

      logRequest(clientIp, targetHost, upstreamCT, response.status);
      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders
      });
    } catch (e) {
      return new Response('Upstream error: ' + e.message, {
        status: 502,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
};
