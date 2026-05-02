#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();

function generateToneWavBuffer({
  durationSeconds = 6,
  sampleRate = 44100,
  frequencyHz = 440,
  amplitude = 0.35
} = {}) {
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(durationSeconds * sampleRate);
  const dataSize = frameCount * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(channels * bytesPerSample, 32); // block align
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < frameCount; i += 1) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequencyHz * t);
    const value = Math.max(-1, Math.min(1, sample * amplitude));
    const pcm = Math.round(value * 32767);
    buffer.writeInt16LE(pcm, 44 + i * bytesPerSample);
  }

  return buffer;
}

const testMixWav = generateToneWavBuffer({
  durationSeconds: 8,
  frequencyHz: 330
});

const testStreamWav = generateToneWavBuffer({
  durationSeconds: 20,
  frequencyHz: 220
});

function getPort() {
  const portFlag = process.argv.find(arg => arg.startsWith('--port='));
  if (portFlag) {
    return Number.parseInt(portFlag.slice('--port='.length), 10);
  }
  const portIndex = process.argv.indexOf('--port');
  if (portIndex >= 0 && process.argv[portIndex + 1]) {
    return Number.parseInt(process.argv[portIndex + 1], 10);
  }
  return 4173;
}

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.streams', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.mp3', 'audio/mpeg'],
  ['.m4a', 'audio/mp4'],
  ['.ogg', 'audio/ogg'],
  ['.wav', 'audio/wav']
]);

function safeResolvePath(requestPathname) {
  const decoded = decodeURIComponent(requestPathname);
  const normalized = path.normalize(decoded).replace(/^\/+/, '');
  const resolved = path.resolve(root, normalized);
  if (!resolved.startsWith(root)) {
    return null;
  }
  return resolved;
}

function sendTestWav(res, wavBuffer, reqMethod) {
  res.writeHead(200, {
    'Content-Type': 'audio/wav',
    'Content-Length': String(wavBuffer.length),
    'Cache-Control': 'no-store'
  });
  if (reqMethod === 'HEAD') {
    res.end();
    return;
  }
  res.end(wavBuffer);
}

function sendChunkedTestStream(res, wavBuffer, reqMethod) {
  res.writeHead(200, {
    'Content-Type': 'audio/wav',
    'Cache-Control': 'no-store'
  });

  if (reqMethod === 'HEAD') {
    res.end();
    return;
  }

  const chunkSize = 4096;
  let offset = 0;
  const interval = setInterval(() => {
    if (offset >= wavBuffer.length) {
      clearInterval(interval);
      res.end();
      return;
    }

    const end = Math.min(offset + chunkSize, wavBuffer.length);
    const chunk = wavBuffer.subarray(offset, end);
    offset = end;
    res.write(chunk);
  }, 10);

  res.on('close', () => {
    clearInterval(interval);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      res.writeHead(400);
      res.end('Bad Request');
      return;
    }

    const url = new URL(req.url, 'http://127.0.0.1');
    let pathname = url.pathname;
    if (pathname === '/') pathname = '/player.html';

    if (pathname === '/__test__/mix.wav') {
      sendTestWav(res, testMixWav, req.method || 'GET');
      return;
    }

    if (pathname === '/__test__/stream.wav') {
      sendChunkedTestStream(res, testStreamWav, req.method || 'GET');
      return;
    }

    const resolvedPath = safeResolvePath(pathname);
    if (!resolvedPath) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const stat = await fs.stat(resolvedPath).catch(() => null);
    if (!stat) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    let filePath = resolvedPath;
    if (stat.isDirectory()) {
      filePath = path.join(resolvedPath, 'index.html');
    }

    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = contentTypes.get(ext) || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store'
    });
    res.end(data);
  } catch (error) {
    res.writeHead(500);
    res.end(`Internal Server Error: ${error.message}`);
  }
});

const port = getPort();
server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`test-server listening on http://127.0.0.1:${port}`);
});
