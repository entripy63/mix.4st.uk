const http = require('http');
const https = require('https');
const net = require('net');

const ALLOWED_ORIGINS = ['4st.uk', 'steveqv225'];
const PORT = process.env.PORT || 8080;
let activeConnections = 0;

const server = http.createServer(async (req, res) => {
  // Status endpoint (no origin check needed)
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ active: activeConnections, mem: Math.round(process.memoryUsage().rss / 1048576) + 'MB' }));
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
      res.writeHead(502);
      res.end('Too many redirects');
      return;
    }

    const target = new URL(targetUrl);
    const transport = target.protocol === 'https:' ? https : http;

    const proxyReq = transport.request(target, { headers: fetchHeaders }, (proxyRes) => {
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

      // Detect if this is a live stream (no content-length = infinite stream)
      const isLiveStream = !proxyRes.headers['content-length'];

      res.writeHead(proxyRes.statusCode, responseHeaders);

      if (isLiveStream) {
        // Don't let pipe() auto-end the response — we want to destroy it
        // abruptly so the browser sees a network error, triggering
        // IcecastMetadataPlayer's seamless retry/reconnection logic.
        proxyRes.pipe(res, { end: false });
        proxyRes.on('end', () => { res.destroy(); });
      } else {
        proxyRes.pipe(res);
      }

      res.on('close', () => { proxyRes.destroy(); proxyReq.destroy(); });
    });

    proxyReq.setTimeout(10000, () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.writeHead(504);
        res.end('Upstream timeout');
      }
    });

    proxyReq.on('error', (err) => {
      if (err.code === 'HPE_INVALID_CONSTANT') {
        doRawRequest(target, res, icyMeta);
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
function doRawRequest(target, res, icyMeta) {
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

  socket.on('end', () => {
    // For live streams (no content-length), destroy instead of ending cleanly
    // to trigger IcecastMetadataPlayer's seamless reconnection
    if (!res.destroyed) {
      res.destroy();
    }
  });
  res.on('close', () => socket.destroy());
}

server.listen(PORT, () => {
  console.log('Stream proxy listening on port ' + PORT);
});
