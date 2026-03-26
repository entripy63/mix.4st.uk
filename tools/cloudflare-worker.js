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

    // Origin validation
    const origin = request.headers.get('Origin') || request.headers.get('Referer') || '';
    if (!origin.includes('4st.uk') && !origin.includes('steveqv225')) {
      return new Response('Forbidden', { status: 403 });
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

    try {
      // Cloudflare fetch() follows redirects automatically (up to 20)
      const response = await fetch(streamUrl, {
        headers: fetchHeaders,
        redirect: 'follow'
      });

      // Build response headers
      const responseHeaders = {
        'Content-Type': inferContentType(response.headers.get('Content-Type'), streamUrl),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type'
      };

      // Preserve headers needed for seeking and range requests
      for (const header of ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Encoding']) {
        const value = response.headers.get(header);
        if (value) responseHeaders[header] = value;
      }

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
