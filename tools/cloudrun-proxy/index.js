const http = require('http');
const https = require('https');
const net = require('net');

const ALLOWED_ORIGINS = ['4st.uk', 'steveqv225'];
const PORT = process.env.PORT || 8080;
const MAX_CONNECTIONS = 10;
let activeConnections = 0;

const server = http.createServer(async (req, res) => {
  // Status endpoint (no origin check needed)
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ active: activeConnections, max: MAX_CONNECTIONS, mem: Math.round(process.memoryUsage().rss / 1048576) + 'MB' }));
    return;
  }

  if (activeConnections >= MAX_CONNECTIONS) {
    res.writeHead(503);
    res.end('Too many connections');
    return;
  }

  activeConnections++;
  res.on('close', () => { activeConnections--; });
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Icy-Metadata',
      'Access-Control-Expose-Headers': 'Icy-MetaInt, Icy-Br, Icy-Name, Icy-Genre, Icy-Url, Icy-Description, Ice-Audio-Info, Content-Length, Content-Range, Accept-Ranges',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  const origin = req.headers['origin'] || req.headers['referer'] || '';
  if (!ALLOWED_ORIGINS.some(o => origin.includes(o))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const streamUrl = url.searchParams.get('url');
  if (!streamUrl) {
    res.writeHead(400);
    res.end('Missing url parameter');
    return;
  }

  const fetchHeaders = {
    'User-Agent': 'AudioPlayer/1.0',
    'Icy-MetaData': '1'
  };

  if (req.headers['range']) {
    fetchHeaders['Range'] = req.headers['range'];
  }

  function doRequest(targetUrl, redirectCount) {
    if (redirectCount > 5) {
      res.writeHead(502);
      res.end('Too many redirects');
      return;
    }

    const target = new URL(targetUrl);
    const transport = target.protocol === 'https:' ? https : http;

    // Some Shoutcast servers respond with ICY protocol (HTTP/0.9) which
    // Node's http.request can't handle. Use a raw TCP socket for these.
    const proxyReq = transport.request(target, { headers: fetchHeaders }, (proxyRes) => {
      // Follow redirects
      if ([301, 302, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers['location']) {
        proxyRes.resume();
        doRequest(proxyRes.headers['location'], redirectCount + 1);
        return;
      }

      const responseHeaders = {
        'Content-Type': proxyRes.headers['content-type'] || '',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Icy-MetaInt, Icy-Br, Icy-Name, Icy-Genre, Icy-Url, Icy-Description, Ice-Audio-Info, Content-Length, Content-Range, Accept-Ranges'
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
      proxyRes.pipe(res);

      // Clean up upstream when client disconnects (e.g. probe completes)
      res.on('close', () => { proxyRes.destroy(); proxyReq.destroy(); });
    });

    proxyReq.on('error', (err) => {
      // If HTTP parsing fails (e.g. ICY/Shoutcast), fall back to raw TCP
      if (err.code === 'HPE_INVALID_CONSTANT') {
        doRawRequest(target, res);
      } else if (!res.headersSent) {
        res.writeHead(502);
        res.end('Upstream error');
      }
    });

    proxyReq.end();
  }

  doRequest(streamUrl, 0);
});

// Raw TCP fallback for ICY/Shoutcast servers that don't speak valid HTTP
function doRawRequest(target, res) {
  const port = target.port || 80;
  const path = target.pathname + target.search;
  const socket = net.connect(port, target.hostname, () => {
    socket.write(`GET ${path} HTTP/1.0\r\nHost: ${target.host}\r\nUser-Agent: AudioPlayer/1.0\r\nIcy-MetaData: 1\r\nConnection: close\r\n\r\n`);
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

    // Parse ICY headers
    let contentType = 'audio/mpeg';
    const icyHeaders = {};
    for (const line of headerStr.split('\r\n')) {
      const ctMatch = line.match(/^content-type:\s*(.+)/i);
      if (ctMatch) contentType = ctMatch[1].trim();
      const icyMatch = line.match(/^(icy-[^:]+|ice-[^:]+):\s*(.+)/i);
      if (icyMatch) icyHeaders[icyMatch[1].toLowerCase()] = icyMatch[2].trim();
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Icy-MetaInt, Icy-Br, Icy-Name, Icy-Genre, Icy-Url, Icy-Description, Ice-Audio-Info, Content-Length, Content-Range, Accept-Ranges',
      ...icyHeaders
    });

    if (body.length) res.write(body);
  });

  socket.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end('Upstream error');
    }
  });

  socket.on('end', () => res.end());
  res.on('close', () => socket.destroy());
}

server.listen(PORT, () => {
  console.log(`Stream proxy listening on port ${PORT}`);
});
