import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import test from 'node:test';
import vm from 'node:vm';

// Exercise both independent deployments against the same transport contract.
const variant = process.env.STREAM_PROXY_VARIANT || 'candidate';
assert.ok(['candidate', 'v2'].includes(variant), 'Unknown STREAM_PROXY_VARIANT');
const permanent = variant === 'v2';
const code = await readFile(new URL(permanent ? '../cloudflare-v2/worker.js' : './worker.js', import.meta.url), 'utf8');
const encoder = new TextEncoder();
const origin = 'https://m.4st.uk';
const ipURL = 'http://93.184.216.34:8000/live?station=7';

// Model the external socket boundary, including independently fragmented bytes
// and a server that can remain open after its response. Tests use only fetch().
async function worker({ replies = [], nativeFetch, addresses = ['93.184.216.34'], timeout = 15000 } = {}) {
  const connections = [];
  const context = vm.createContext({
    URL, Headers, Request, Response, ReadableStream, WritableStream, TextEncoder,
    TextDecoder, AbortController, AbortSignal, Uint8Array,
    IdentityTransformStream: TransformStream,
    console: { log() {} }, clearTimeout,
    setTimeout: (fn, ms) => setTimeout(fn, ms === 15000 ? timeout : ms),
    fetch: nativeFetch || (async () => { throw new TypeError('HTTP parser rejected ICY'); })
  });
  const sockets = new vm.SyntheticModule(['connect'], function () {
    this.setExport('connect', (address, options) => {
      const reply = replies.shift();
      assert.ok(reply, 'unexpected upstream connection');
      let controller;
      let index = 0;
      const connection = { address, options, request: '', closed: false, reads: 0 };
      connections.push(connection);
      const chunks = reply.chunks || [encoder.encode(reply.text)];
      return {
        opened: reply.neverOpen ? new Promise(() => {}) : Promise.resolve({ remoteAddress: address.hostname }),
        closed: new Promise(() => {}),
        writable: new WritableStream({ write(chunk) { connection.request += new TextDecoder().decode(chunk); } }),
        readable: new ReadableStream({
          start(c) { controller = c; },
          pull(c) {
            connection.reads++;
            if (index < chunks.length) c.enqueue(chunks[index++]);
            else if (reply.fail) c.error(new Error('upstream disconnected'));
            else if (!reply.stayOpen) c.close();
          }
        }, { highWaterMark: 0 }),
        close() {
          connection.closed = true;
          try { controller.error(new Error('upstream socket closed')); } catch { /* already ended */ }
          return Promise.resolve();
        }
      };
    });
  }, { context });
  const dns = new vm.SyntheticModule(['resolve4', 'resolve6'], function () {
    this.setExport('resolve4', async () => addresses);
    this.setExport('resolve6', async () => []);
  }, { context });
  const net = new vm.SyntheticModule(['isIP'], function () { this.setExport('isIP', isIP); }, { context });
  const module = new vm.SourceTextModule(code, { context });
  await module.link(name => ({ 'cloudflare:sockets': sockets, 'node:dns/promises': dns, 'node:net': net })[name]);
  await module.evaluate();
  return {
    connections,
    request: request => module.namespace.default.fetch(request),
    fetch(target = ipURL, { headers = {}, signal, method = 'GET', icy = true } = {}) {
      const request = new Request(`https://candidate.example/?url=${encodeURIComponent(target)}${icy ? '&icy=1' : ''}`, {
        method, signal, headers: { Origin: origin, ...headers }
      });
      return module.namespace.default.fetch(request);
    }
  };
}

test('ICY preserves binary bytes, metadata headers and request path across arbitrary fragmentation', async () => {
  const prefix = encoder.encode('ICY 200 OK\r\nContent-Type: audio/mpeg\r\nIcy-MetaInt: 3\r\n\r\n');
  const audio = new Uint8Array([255, 0, 128, 1, ...encoder.encode("StreamTitle='x';"), 0, 17, 254, 13]);
  const wire = new Uint8Array([...prefix, ...audio]);
  for (const chunks of [Array.from(wire, byte => new Uint8Array([byte])), [wire]]) {
    const app = await worker({ replies: [{ chunks }] });
    const response = await app.fetch();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('icy-metaint'), '3');
    assert.match(response.headers.get('access-control-expose-headers'), /icy-metaint/i);
    assert.equal(response.headers.get('x-proxy-transport'), 'tcp');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), audio);
    assert.match(app.connections[0].request, /^GET \/live\?station=7 HTTP\/1.0\r\n/);
    assert.match(app.connections[0].request, /Icy-MetaData: 1\r\n/);
    assert.equal(app.connections[0].closed, true);
  }
});

test('TCP forwards Range and preserves a finite 206 body without waiting for server close', async () => {
  const app = await worker({ replies: [{ stayOpen: true,
    text: 'HTTP/1.1 206 Partial Content\r\nContent-Type: audio/mpeg\r\nContent-Length: 3\r\nContent-Range: bytes 2-4/9\r\n\r\nxyzEXTRA' }] });
  const response = await app.fetch(ipURL, { headers: { Range: 'bytes=2-4' }, icy: false });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 2-4/9');
  assert.equal(await response.text(), 'xyz');
  assert.match(app.connections[0].request, /Range: bytes=2-4\r\n/);
  assert.match(app.connections[0].request, /Icy-MetaData: 0\r\n/);
  assert.equal(app.connections[0].closed, true);
});

test('chunked TCP bodies are de-framed, including extensions, trailers and split delimiters', async () => {
  const wire = 'HTTP/1.1 200 OK\r\nContent-Type: audio/mpeg\r\nTransfer-Encoding: chunked\r\nContent-Length: 999\r\n\r\n3;foo=bar\r\nabc\r\n5\r\n12345\r\n0\r\nX-End: yes\r\n\r\n';
  const app = await worker({ replies: [{ stayOpen: true,
    chunks: Array.from(encoder.encode(wire), b => new Uint8Array([b])) }] });
  const response = await app.fetch();
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(response.headers.get('transfer-encoding'), null);
  assert.equal(await response.text(), 'abc12345');
  assert.equal(app.connections[0].closed, true);
});

test('relative redirects can cross from fetch to raw IP without rejecting redirect HTML', async () => {
  const app = await worker({ nativeFetch: async () => new Response('redirect page', {
    status: 302, headers: { Location: '//93.184.216.34:8000/next', 'Content-Type': 'text/html' }
  }), replies: [
    { text: 'HTTP/1.0 307 Temporary Redirect\r\nLocation: /final.mp3\r\nContent-Type: text/html\r\n\r\n' },
    { text: 'ICY 200 OK\r\nContent-Length: 4\r\n\r\nLAST' }
  ] });
  const response = await app.fetch('https://radio.example/playlist');
  assert.equal(await response.text(), 'LAST');
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.match(app.connections[1].request, /^GET \/final.mp3 /);
  assert.equal(app.connections[0].closed, true);
});

test('standard named streams keep fetch, but ICY 520 uses a pinned TCP destination', async () => {
  const standard = await worker({ nativeFetch: async () => new Response('normal', { headers: {
    'Content-Type': 'audio/aac', 'Icy-Name': 'Station'
  } }) });
  const normal = await standard.fetch('https://radio.example/live');
  assert.equal(normal.headers.get('x-proxy-transport'), 'fetch');
  assert.equal(normal.headers.get('icy-name'), 'Station');
  assert.equal(await normal.text(), 'normal');
  const legacy = await worker({ nativeFetch: async () => new Response('error code: 520', { status: 520 }),
    addresses: ['relay.example.', '93.184.216.34'],
    replies: [{ text: 'ICY 200 OK\r\nContent-Length: 6\r\n\r\nlegacy' }] });
  assert.equal(await (await legacy.fetch('http://radio.example/live')).text(), 'legacy');
  assert.equal(legacy.connections[0].address.hostname, '93.184.216.34');
});

test('private destinations, mapped IPv6, credentials, unsafe protocols and redirect/DNS rebinding targets are denied with CORS', async () => {
  for (const target of ['http://127.1/', 'http://10.2.3.4/', 'http://100.64.0.1/',
    'http://169.254.169.254/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/',
    'http://[fd00::1]/', 'http://[fe80::1]/', 'http://user:pass@radio.example/', 'ftp://radio.example/']) {
    const app = await worker();
    const response = await app.fetch(target);
    assert.equal(response.status, 403, target);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
  }
  const redirect = await worker({ nativeFetch: async () => new Response(null, {
    status: 302, headers: { Location: 'http://192.168.8.9/' }
  }) });
  assert.equal((await redirect.fetch('https://radio.example/live')).status, 403);
  const dns = await worker({ addresses: ['93.184.216.34', '192.168.8.9'] });
  assert.equal((await dns.fetch('http://radio.example/live')).status, 403);
});

test('origin checks and content-type denial apply to errors and both transports', async () => {
  const app = await worker();
  for (const Origin of [...(permanent ? [] : ['https://mixes.4st.uk', 'https://player.4st.uk']),
    'https://evil4st.uk', 'https://m.4st.uk.evil.example',
    'https://player.4st.uk.evil.example', 'https://player.4st.uk:444',
    'http://m.4st.uk', 'http://player.4st.uk', 'http://4st.uk', 'http://mixes.4st.uk',
    'https://toot.org.uk', 'not a URL', '', 'null']) {
    assert.equal((await app.fetch(ipURL, { headers: { Origin } })).status, 403);
  }
  const allowedOrigins = permanent
    ? ['https://m.4st.uk', 'https://player.4st.uk', 'https://mixes.4st.uk', 'https://4st.uk',
      'https://future.deep.4st.uk', 'https://PLAYER.4ST.UK:443']
    : ['https://m.4st.uk'];
  for (const Origin of allowedOrigins) {
    for (const headers of [{ Origin }, { Origin: '', Referer: `${Origin}/player.html` }]) {
      for (const tcp of [false, true]) {
        const allowed = await worker({
          nativeFetch: async () => new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } }),
          replies: [{ text: 'ICY 200 OK\r\nContent-Length: 5\r\n\r\naudio' }]
        });
        const response = await allowed.fetch(tcp ? ipURL : 'https://radio.example/live', { headers });
        assert.equal(response.status, 200);
        assert.equal(await response.text(), 'audio');
      }
    }
  }
  assert.equal((await app.fetch(ipURL, { headers: {
    Origin: 'https://evil.example', Referer: 'https://player.4st.uk/player.html'
  } })).status, 403);
  for (const Referer of ['http://m.4st.uk/player.html', 'https://m.4st.uk.evil.example/player.html']) {
    assert.equal((await app.fetch(ipURL, { headers: { Origin: '', Referer } })).status, 403);
  }
  assert.equal((await app.fetch(ipURL, { method: 'POST' })).status, 405);
  assert.equal((await app.fetch(ipURL, { headers: { 'X-Forwarded-Proto': 'http' } })).status, 403);
  for (const tcp of [false, true]) {
    const blocked = await worker({ nativeFetch: async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
      replies: [{ stayOpen: true, text: 'ICY 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\nunwanted HTML' }] });
    const response = await blocked.fetch(tcp ? ipURL : 'https://radio.example/live');
    assert.equal(response.status, 415);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    await new Promise(resolve => setImmediate(resolve));
    if (tcp) assert.equal(blocked.connections[0].closed, true);
  }
});

test('permanent Worker requires HTTPS on streams, preflight and public status', { skip: !permanent }, async () => {
  const app = await worker();
  for (const method of ['GET', 'OPTIONS']) {
    for (const path of ['/', '/status']) {
      for (const proto of [null, 'https']) {
        const headers = { Origin: origin };
        if (proto) headers['X-Forwarded-Proto'] = proto;
        const response = await app.request(new Request(`http://worker.example${path}`, { method, headers }));
        assert.equal(response.status, 403);
        assert.equal(response.headers.get('access-control-allow-origin'), '*');
      }
    }
  }
  const preflight = await app.request(new Request('https://worker.example/', { method: 'OPTIONS' }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  const status = await app.request(new Request('https://worker.example/status'));
  assert.equal(status.status, 200);
  assert.equal((await status.json()).type, 'cloudflare-tcp-v2');
  // /status must not bypass origin checks when it also requests an upstream.
  assert.equal((await app.request(new Request(`https://worker.example/status?url=${encodeURIComponent(ipURL)}`))).status, 403);
  assert.equal(app.connections.length, 0);
});

test('TCP is demand-driven, and both body cancellation and client abort close the upstream', async () => {
  for (const [abort, buffered] of [[false, false], [false, true], [true, false], [true, true]]) {
    const app = await worker({ replies: [{ stayOpen: true, chunks: [
      encoder.encode('ICY 200 OK\r\nContent-Type: audio/mpeg\r\n\r\n' + (buffered ? 'audio' : '')),
      ...(buffered ? [] : [encoder.encode('audio')]), encoder.encode('more audio')
    ] }] });
    const controller = new AbortController();
    const response = await app.fetch(ipURL, { signal: controller.signal });
    // Native piping can prefetch one body chunk, but must not drain the source.
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(app.connections[0].reads <= 2);
    if (abort) {
      const reader = response.body.getReader();
      assert.equal(new TextDecoder().decode((await reader.read()).value), 'audio');
      assert.equal(new TextDecoder().decode((await reader.read()).value), 'more audio');
      const pending = reader.read();
      controller.abort();
      await assert.rejects(pending);
    } else await response.body.cancel();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.connections[0].closed, true);
  }
});

test('bad or oversized headers and connection timeout fail closed; truncated bodies error', async () => {
  for (const text of ['not HTTP\r\n\r\n', 'ICY 200 OK\r\nX-Large: ' + 'a'.repeat(32768) + '\r\n\r\n',
    'ICY 200 OK\r\nContent-Type: audio/mpeg\r\n']) {
    const app = await worker({ timeout: 10, replies: [{ text, stayOpen: true }] });
    assert.equal((await app.fetch()).status, 502);
    assert.equal(app.connections[0].closed, true);
  }
  const timed = await worker({ timeout: 10, replies: [{ text: '', neverOpen: true }] });
  assert.equal((await timed.fetch()).status, 502);
  assert.equal(timed.connections[0].closed, true);
  for (const text of ['HTTP/1.0 200 OK\r\nContent-Length: 8\r\n\r\nshort',
    'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\na']) {
    const app = await worker({ replies: [{ text }] });
    await assert.rejects((await app.fetch()).arrayBuffer(), /Truncated/);
    assert.equal(app.connections[0].closed, true);
  }
  const broken = await worker({ replies: [{ fail: true,
    text: 'ICY 200 OK\r\nContent-Type: audio/mpeg\r\n\r\naudio' }] });
  await assert.rejects((await broken.fetch()).arrayBuffer(), /upstream disconnected/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(broken.connections[0].closed, true);
});
