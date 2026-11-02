import { connect } from 'cloudflare:sockets';
import { resolve4, resolve6 } from 'node:dns/promises';
import { isIP } from 'node:net';

// Separate test deployments: production origins remain excluded.
const ALLOWED_ORIGINS = ['https://m.4st.uk'];
const HEADER_LIMIT = 32768;
const HEADER_TIMEOUT_MS = 15000;
const BLOCKED_TYPES = [
  'text/html', 'application/xhtml+xml', 'application/json', 'application/xml',
  'text/xml', 'application/rss+xml', 'application/atom+xml', 'text/csv'
];
const FORWARDED_HEADERS = [
  'content-length', 'content-range', 'accept-ranges', 'content-encoding'
];
const EXPOSE = [
  'Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges',
  'Icy-MetaInt', 'Icy-Br', 'Icy-Name', 'Icy-Genre', 'Icy-Url',
  'Icy-Description', 'Ice-Audio-Info', 'X-Proxy-Transport'
];

class ForbiddenDestination extends Error {}

function errorResponse(message, status) {
  return new Response(message, { status, headers: { 'Access-Control-Allow-Origin': '*' } });
}

function blockedIP(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113);
  }
  // Only public IPv6 unicast. Excludes mapped IPv4, local/NAT64 addresses,
  // documentation ranges and legacy transition tunnels as well as multicast.
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const first = parseInt(canonical.split(':')[0], 16) || 0;
  return first < 0x2000 || first > 0x3fff ||
    /^(2001:(db8|0):|2001::|2002:)/.test(canonical);
}

function checkedURL(value) {
  const target = new URL(value);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new ForbiddenDestination('Only HTTP(S) URLs without credentials are allowed');
  }
  const hostname = target.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) && blockedIP(hostname)) throw new ForbiddenDestination('Forbidden address');
  return target;
}

async function socketAddress(target) {
  const hostname = target.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname)) return hostname; // checkedURL already validated it.
  const answers = await Promise.allSettled([resolve4(hostname), resolve6(hostname)]);
  // Workers' DNS implementation can include CNAMEs in A/AAAA answers.
  const addresses = answers.flatMap(answer => answer.status === 'fulfilled' ? answer.value : [])
    .filter(address => isIP(address));
  if (!addresses.length) throw new Error('DNS resolution failed');
  if (addresses.some(blockedIP)) throw new ForbiddenDestination('Forbidden DNS destination');
  // Connect to the validated IP, not the hostname: no second DNS lookup/rebinding.
  return addresses[0];
}

function contentType(value, target) {
  if (value && !['application/octet-stream', 'binary/octet-stream'].includes(value.toLowerCase())) return value;
  const types = { mp3: 'audio/mpeg', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/opus',
    m4a: 'audio/mp4', flac: 'audio/flac', wav: 'audio/wav', webm: 'audio/webm' };
  return types[target.pathname.split('.').pop().toLowerCase()] || value || 'application/octet-stream';
}

async function nativeRequest(target, headers, signal) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error('Upstream header timeout')), HEADER_TIMEOUT_MS);
  try {
    return await fetch(target.href, {
      headers, redirect: 'manual', signal: AbortSignal.any([signal, timeout.signal])
    });
  } finally {
    clearTimeout(timer); // No duration limit once streaming starts.
  }
}

// A bounded line parser shared by HTTP headers and chunked-transfer framing.
// Audio bytes are never decoded as text or copied into an accumulating body.
class SocketReader {
  constructor(reader) {
    this.reader = reader;
    this.buffer = new Uint8Array();
  }

  async read() {
    // close() closes the socket and rejects pending reads. Racing every audio
    // read against one unresolved promise would retain handlers for hours.
    return this.reader.read();
  }

  async line(limit) {
    while (true) {
      for (let i = 0; i + 1 < this.buffer.length; i++) {
        if (this.buffer[i] === 13 && this.buffer[i + 1] === 10) {
          if (i + 2 > limit) throw new Error('Upstream headers too large');
          const line = new TextDecoder('latin1').decode(this.buffer.subarray(0, i));
          this.buffer = this.buffer.subarray(i + 2);
          return line;
        }
      }
      if (this.buffer.length >= limit) throw new Error('Upstream headers too large');
      const { value, done } = await this.read();
      if (done) throw new Error('Incomplete upstream headers');
      const combined = new Uint8Array(this.buffer.length + value.length);
      combined.set(this.buffer);
      combined.set(value, this.buffer.length);
      this.buffer = combined;
    }
  }

  async chunk(limit = Infinity) {
    if (!this.buffer.length) {
      const { value, done } = await this.read();
      if (done) return null;
      this.buffer = value;
    }
    const chunk = this.buffer.subarray(0, limit);
    this.buffer = this.buffer.subarray(chunk.length);
    return chunk;
  }
}

async function* socketBody(source, headers) {
  if (headers.get('transfer-encoding')?.toLowerCase() === 'chunked') {
    while (true) {
      const line = await source.line(8192);
      if (!/^[0-9a-f]+(?:;.*)?$/i.test(line)) throw new Error('Invalid chunk size');
      let remaining = parseInt(line.split(';')[0], 16);
      if (!Number.isSafeInteger(remaining)) throw new Error('Invalid chunk size');
      if (remaining === 0) {
        let budget = HEADER_LIMIT;
        while (true) {
          const trailer = await source.line(budget);
          budget -= trailer.length + 2;
          if (!trailer) return;
        }
      }
      while (remaining > 0) {
        const chunk = await source.chunk(remaining);
        if (!chunk) throw new Error('Truncated chunk');
        remaining -= chunk.length;
        yield chunk;
      }
      if (await source.line(2) !== '') throw new Error('Invalid chunk terminator');
    }
  }

  const length = headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) {
    throw new Error('Invalid content length');
  }
  let remaining = length === null ? Infinity : Number(length);
  while (remaining > 0) {
    const chunk = await source.chunk(remaining);
    if (!chunk) {
      if (remaining !== Infinity) throw new Error('Truncated upstream body');
      return;
    }
    remaining -= chunk.length;
    yield chunk;
  }
}

async function tcpRequest(target, headers, signal) {
  // Deadline covers DNS, opening the socket and reading headers, not playback.
  let rejectStopped;
  const stopped = new Promise((_, reject) => { rejectStopped = reject; });
  void stopped.catch(() => {});
  let socket;
  let closed = false;
  let bytes = 0;
  const started = Date.now();
  const close = reason => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    if (socket) void socket.close().catch(() => {});
    console.log(JSON.stringify({ event: 'tcp-close', host: target.hostname, reason, bytes, elapsedMs: Date.now() - started }));
  };
  const abort = () => {
    rejectStopped(signal.reason || new Error('Client disconnected'));
    close('client-abort');
  };
  const timer = setTimeout(() => {
    rejectStopped(new Error('Upstream header timeout'));
    close('header-timeout');
  }, HEADER_TIMEOUT_MS);
  signal.addEventListener('abort', abort, { once: true });

  try {
    signal.throwIfAborted();
    const address = await Promise.race([socketAddress(target), stopped]);
    signal.throwIfAborted();
    socket = connect({ hostname: address, port: Number(target.port) || (target.protocol === 'https:' ? 443 : 80) },
      { secureTransport: target.protocol === 'https:' ? 'on' : 'off' });
    void socket.closed.catch(() => {});
    await Promise.race([socket.opened, stopped]);
    const writer = socket.writable.getWriter();
    const range = headers.get('range');
    await Promise.race([writer.write(new TextEncoder().encode(
      `GET ${target.pathname}${target.search} HTTP/1.0\r\nHost: ${target.host}\r\n` +
      `User-Agent: AudioPlayer/1.0\r\nIcy-MetaData: ${headers.get('icy-metadata')}\r\n` +
      'Accept-Encoding: identity\r\nConnection: close\r\n' + (range ? `Range: ${range}\r\n` : '') + '\r\n'
    )), stopped]);
    writer.releaseLock();
    const source = new SocketReader(socket.readable.getReader());
    let budget = HEADER_LIMIT;
    const statusLine = await source.line(budget);
    budget -= statusLine.length + 2;
    const match = statusLine.match(/^(?:HTTP\/1\.[01]|ICY) ([2-5]\d\d)(?: .*)?$/);
    if (!match) throw new Error('Invalid upstream HTTP/ICY status');
    const status = Number(match[1]);
    const responseHeaders = new Headers();
    while (true) {
      const line = await source.line(budget);
      budget -= line.length + 2;
      if (!line) break;
      const colon = line.indexOf(':');
      if (colon <= 0) throw new Error('Invalid upstream header');
      responseHeaders.append(line.slice(0, colon), line.slice(colon + 1).trim());
    }
    const transfer = responseHeaders.get('transfer-encoding');
    if (transfer && transfer.toLowerCase() !== 'chunked') throw new Error('Unsupported transfer encoding');
    if (transfer) responseHeaders.delete('content-length');
    clearTimeout(timer);

    if ([204, 205, 304].includes(status)) {
      close('no-body');
      return new Response(null, { status, headers: responseHeaders });
    }
    if (!transfer && !responseHeaders.has('content-length')) {
      // ICY metadata is part of the opaque body, not HTTP chunk framing. After
      // headers, relay these unbounded streams natively: no JS per audio chunk.
      const relay = new IdentityTransformStream();
      source.reader.releaseLock();
      bytes = null; // Counting chunks would defeat native pass-through.
      const pump = async () => {
        if (source.buffer.length) {
          const writer = relay.writable.getWriter();
          try { await writer.write(source.buffer); }
          finally { writer.releaseLock(); }
        }
        await socket.readable.pipeTo(relay.writable);
      };
      // Do not await a live stream before returning its response. pipeTo
      // propagates downstream cancellation and upstream errors in both directions.
      void pump().then(() => close('eof'), () => close('pipe-ended'));
      return new Response(relay.readable, { status, headers: responseHeaders });
    }
    const body = socketBody(source, responseHeaders);
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { value, done } = await body.next();
          if (done) {
            close('eof');
            controller.close();
          } else {
            bytes += value.length;
            controller.enqueue(value);
          }
        } catch (error) {
          close('read-error');
          controller.error(error);
        }
      },
      cancel() {
        close('body-cancel');
        void body.return().catch(() => {});
      }
    }, { highWaterMark: 0 });
    return new Response(stream, { status, headers: responseHeaders });
  } catch (error) {
    close('request-error');
    throw error;
  }
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Icy-Metadata', 'Access-Control-Max-Age': '86400'
      } });
    }
    if (request.method !== 'GET') return errorResponse('Method not allowed', 405);
    const proto = request.headers.get('x-forwarded-proto');
    if (proto && proto !== 'https') return errorResponse('HTTPS required', 403);
    const url = new URL(request.url);
    if (url.pathname === '/status' && !url.searchParams.has('url')) {
      return Response.json({ status: 'ok', type: 'cloudflare-tcp-candidate' }, {
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }
    try {
      const origin = request.headers.get('origin') || request.headers.get('referer');
      if (!origin || !ALLOWED_ORIGINS.includes(new URL(origin).origin)) return errorResponse('Forbidden origin', 403);
    } catch {
      return errorResponse('Forbidden origin', 403);
    }
    if (!url.searchParams.get('url')) return errorResponse('Missing url parameter', 400);

    const headers = new Headers({ 'User-Agent': 'AudioPlayer/1.0',
      'Icy-MetaData': url.searchParams.get('icy') === '1' ? '1' : '0' });
    if (request.headers.has('range')) headers.set('Range', request.headers.get('range'));
    let target;
    try {
      target = checkedURL(url.searchParams.get('url'));
      for (let redirects = 0; redirects <= 5; redirects++) {
        request.signal.throwIfAborted();
        let response;
        let transport = isIP(target.hostname.replace(/^\[|\]$/g, '')) ? 'tcp' : 'fetch';
        if (transport === 'fetch') {
          try {
            response = await nativeRequest(target, headers, request.signal);
          } catch (error) {
            if (request.signal.aborted || target.protocol !== 'http:') throw error;
          }
          // Legacy ICY produces a Cloudflare 520 response rather than throwing.
          if (target.protocol === 'http:' && (!response || response.status === 520)) {
            await response?.body?.cancel();
            transport = 'tcp';
          }
        }
        if (transport === 'tcp') response = await tcpRequest(target, headers, request.signal);

        if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.has('location')) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          target = checkedURL(new URL(location, target).href);
          continue;
        }
        const upstreamType = response.headers.get('content-type');
        if (BLOCKED_TYPES.includes(upstreamType?.split(';')[0].trim().toLowerCase())) {
          await response.body?.cancel();
          return errorResponse('Unsupported content type', 415);
        }
        const resultHeaders = new Headers({
          'Content-Type': contentType(upstreamType, target), 'Access-Control-Allow-Origin': '*',
          'X-Proxy-Transport': transport, 'Cache-Control': 'no-store'
        });
        for (const [key, value] of response.headers) {
          if (FORWARDED_HEADERS.includes(key) || key.startsWith('icy-') || key.startsWith('ice-')) {
            resultHeaders.set(key, value);
          }
        }
        resultHeaders.set('Access-Control-Expose-Headers', [...new Set([
          ...EXPOSE, ...[...resultHeaders.keys()].filter(key => key.startsWith('icy-') || key.startsWith('ice-'))
        ])].join(', '));
        console.log(JSON.stringify({ event: 'proxy', host: target.hostname, status: response.status,
          ct: upstreamType, transport, ip: request.headers.get('cf-connecting-ip') || 'unknown' }));
        return new Response(response.body, { status: response.status, headers: resultHeaders });
      }
      return errorResponse('Too many redirects', 502);
    } catch (error) {
      const status = error instanceof ForbiddenDestination ? 403 : 502;
      console.log(JSON.stringify({ event: 'proxy-error', host: target?.hostname, status, message: error.message }));
      return errorResponse(status === 403 ? 'Forbidden destination' : 'Upstream error', status);
    }
  }
};
