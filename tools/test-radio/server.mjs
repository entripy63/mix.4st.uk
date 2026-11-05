// Isolated synthetic radio source. No changes to the application or live proxy.
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const frameSeconds = 1152 / 44100;
function frames(name) {
  const data = fs.readFileSync(root + name);
  const result = [];
  for (let offset = 0; offset + 4 <= data.length;) {
    const header = data.readUInt32BE(offset);
    // Generator supplies MPEG-1 Layer III, 128 kbps, 44100 Hz, no tags/reservoir.
    if ((header >>> 21) !== 0x7ff || (header >>> 17 & 15) !== 13
        || (header >>> 12 & 15) !== 9 || (header >>> 10 & 3) !== 0) {
      throw new Error(`Unexpected MP3 header in ${name} at ${offset}`);
    }
    const size = Math.floor(144000 * 128 / 44100) + (header >>> 9 & 1);
    if (offset + size > data.length) throw new Error(`Truncated MP3 in ${name}`);
    result.push(data.subarray(offset, offset + size));
    offset += size;
    if (offset === data.length) return result;
  }
  throw new Error(`Empty or trailing MP3 data in ${name}`);
}
const audio = { tone: frames('tone.mp3'), silence: frames('silence.mp3') };
let mode = 'off';
let expires = 0;
const clients = new Set();
function disable() {
  mode = 'off';
  expires = 0;
  for (const client of clients) client.destroy();
}
setInterval(() => { if (expires && Date.now() >= expires) disable(); }, 250).unref();

const stream = http.createServer((req, res) => {
  if (req.url !== '/test-radio/tone.mp3') { res.writeHead(404).end(); return; }
  const headers = {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-store, no-transform',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Icy-MetaData',
    'Access-Control-Expose-Headers': 'icy-metaint, icy-name',
    'icy-name': 'Controlled synthetic test radio'
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, headers).end(); return; }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
  if (mode === 'off' || Date.now() >= expires) {
    res.writeHead(503, { ...headers, 'Retry-After': '60' }).end(); return;
  }
  if (req.method === 'HEAD') { res.writeHead(200, headers).end(); return; }
  if (clients.size >= 4) { res.writeHead(503, headers).end(); return; }
  const icy = req.headers['icy-metadata'] === '1';
  if (icy) headers['icy-metaint'] = '16384';
  res.writeHead(200, headers);
  res.flushHeaders();
  clients.add(res);
  let index = 0;
  let metadataRemaining = 16384;
  let last = performance.now();
  let pending = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    const elapsed = (now - last) / 1000;
    last = now;
    // A hold sends no bytes and does not accumulate a catch-up burst.
    if (mode === 'hold' || mode === 'off') { pending = 0; return; }
    pending = Math.min(pending + elapsed, 0.25);
    while (pending >= frameSeconds) {
      pending -= frameSeconds;
      const source = audio[mode];
      let data = source[index++ % source.length];
      const chunks = [];
      if (icy) {
        while (data.length) {
          const size = Math.min(metadataRemaining, data.length);
          chunks.push(data.subarray(0, size));
          data = data.subarray(size);
          metadataRemaining -= size;
          if (!metadataRemaining) {
            chunks.push(Buffer.from([0]));
            metadataRemaining = 16384;
          }
        }
      } else chunks.push(data);
      // Disconnect slow clients instead of accumulating unlimited audio.
      if (!res.write(Buffer.concat(chunks))) { res.destroy(); return; }
    }
  }, 25);
  const limit = setTimeout(() => res.destroy(), 10 * 60 * 1000);
  res.on('close', () => { clearInterval(timer); clearTimeout(limit); clients.delete(res); });
});
stream.listen(8090, '127.0.0.1');

// Unix socket inside a mode-0700 systemd runtime directory: never reverse-proxied.
const control = http.createServer((req, res) => {
  const selected = /^\/mode\/(tone|silence|hold|off)$/.exec(req.url);
  if (req.method === 'POST' && selected) {
    if (selected[1] === 'off') disable();
    else { mode = selected[1]; expires = Date.now() + 15 * 60 * 1000; }
  } else if (req.method !== 'GET' || req.url !== '/status') {
    res.writeHead(404).end(); return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ mode, clients: clients.size,
    remainingSeconds: Math.max(0, Math.ceil((expires - Date.now()) / 1000)) }) + '\n');
});
const socket = process.env.CONTROL_SOCKET || '/run/test-radio/control.sock';
fs.rmSync(socket, { force: true });
control.listen(socket);
