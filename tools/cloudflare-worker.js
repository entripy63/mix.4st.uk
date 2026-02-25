export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || request.headers.get('Referer') || '';
    
    if (!origin.includes('4st.uk') && !origin.includes('steveqv225')) {
      return new Response('Forbidden', { status: 403 });
    }
   
    const url = new URL(request.url);
    const streamUrl = url.searchParams.get('url');
    if (!streamUrl) {
      return new Response('Missing url parameter', { status: 400 });
    }
    
    // Forward Range header to support seeking
    const fetchHeaders = {
      'User-Agent': 'AudioPlayer/1.0',
      'Icy-MetaData': '0'
    };
    
    const rangeHeader = request.headers.get('Range');
    if (rangeHeader) {
      fetchHeaders['Range'] = rangeHeader;
    }
    
    const response = await fetch(streamUrl, {
      headers: fetchHeaders
    });
    
    const contentType = response.headers.get('Content-Type') || '';
    
    // Build response headers, preserving range support headers
    const responseHeaders = {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*'
    };
    
    // Copy headers needed for seeking
    const headersToProxy = ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Encoding'];
    headersToProxy.forEach(header => {
      const value = response.headers.get(header);
      if (value) {
        responseHeaders[header] = value;
      }
    });
    
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });
  }
}
