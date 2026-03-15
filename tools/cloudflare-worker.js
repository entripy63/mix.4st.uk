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

    // Build upstream request headers
    const fetchHeaders = {
      'User-Agent': 'AudioPlayer/1.0',
      'Icy-MetaData': '0'
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
        'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type'
      };

      // Preserve headers needed for seeking and range requests
      for (const header of ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Encoding']) {
        const value = response.headers.get(header);
        if (value) responseHeaders[header] = value;
      }

      // For live streams (no Content-Length), convert a clean stream end
      // into an error to trigger IcecastMetadataPlayer's seamless reconnection
      const isLiveStream = !response.headers.get('Content-Length');
      const body = isLiveStream && response.body
        ? response.body.pipeThrough(new TransformStream({
            flush() { throw new Error('network error'); },
          }))
        : response.body;

      return new Response(body, {
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
