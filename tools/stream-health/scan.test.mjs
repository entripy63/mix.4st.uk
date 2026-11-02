import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inventory, loadState, openDecoder, probeStream, scan, seed } from './scan.mjs';

const start = new Date('2026-10-20T03:30:00Z');
const onNight = n => new Date(start.getTime() + n * 86400000);
const station = { url: 'https://radio.example/listen.pls', entries: [{ name: 'Example radio', file: 'Jazz.streams' }] };
const working = { status: 'working', reason: 'Sample decoded (canplay)' };
const failed = { status: 'failed', reason: 'HTTP 503' };

async function fixture(t, stations = [station]) {
  const dir = await mkdtemp(join(tmpdir(), 'stream-health-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'state.json');
  const state = { version: 1, streams: {} };
  seed(state, stations, Math.floor(start.getTime() / 86400000));
  for (const record of Object.values(state.streams)) record.due = Math.floor(start.getTime() / 86400000);
  await writeFile(file, JSON.stringify(state));
  return { dir, file, stations };
}

test('inventory deduplicates presets and excludes daily stations even under another saved name', async t => {
  const { dir } = await fixture(t);
  await writeFile(join(dir, 'One.streams'), JSON.stringify({ streams: [
    { name: 'Example', m3u: station.url },
    { name: 'Monkey Radio', m3u: 'https://station.example/daily' },
    { name: 'Unknown name', m3u: 'http://178.128.128.44:8096/seb' }
  ] }));
  await writeFile(join(dir, 'Two.streams'), JSON.stringify({ streams: [
    { name: 'Same endpoint', m3u: station.url },
    { name: 'Alias', m3u: 'https://station.example/daily' }
  ] }));
  const result = await inventory(dir);
  assert.equal(result.stations.length, 1);
  assert.equal(result.stations[0].entries.length, 2);
  assert.equal(result.excluded, 2);
});

test('healthy fallback is quiet and is not checked again before seven days', async t => {
  const f = await fixture(t);
  const messages = [];
  const options = { ...f, probe: async (_url, proxy) => proxy.includes('candidate') ? failed : working,
    sendMail: async (...args) => messages.push(args) };
  assert.equal((await scan({ ...options, now: onNight(0) })).checked, 1);
  const record = (await loadState(f.file)).streams[station.url];
  assert.equal(record.paths.at(-1).status, 'working');
  assert.equal(record.failures, 0);
  assert.equal((await scan({ ...options, now: onNight(6) })).checked, 0);
  assert.equal((await scan({ ...options, now: onNight(7) })).checked, 1);
  assert.equal(messages.length, 0);
});

test('reports after two failed nights, not twice in one day, and rearms only after recovery', async t => {
  const f = await fixture(t);
  const messages = [];
  let result = failed;
  const run = n => scan({ ...f, now: onNight(n), probe: async () => result,
    sendMail: async (subject, body) => messages.push({ subject, body }) });
  await run(0);
  assert.equal(messages.length, 0);
  assert.equal((await run(0)).checked, 0);
  await run(1);
  assert.equal(messages.length, 1);
  assert.match(messages[0].body, /Example radio \(Jazz.streams\)/);
  assert.match(messages[0].body, /HTTP 503/);
  assert.equal((await loadState(f.file)).streams[station.url].paths.length, 3);
  await run(2);
  assert.equal(messages.length, 1);
  result = working;
  await run(3);
  assert.equal((await loadState(f.file)).streams[station.url].failures, 0);
  result = failed;
  await run(9);
  assert.equal(messages.length, 1);
  await run(10);
  assert.equal(messages.length, 1);
  await run(11);
  assert.equal(messages.length, 2);
});

test('unsent reports remain eligible after a mail failure', async t => {
  const f = await fixture(t);
  const options = { ...f, probe: async () => failed };
  await scan({ ...options, now: onNight(0), sendMail: async () => assert.fail('too early') });
  await assert.rejects(scan({ ...options, now: onNight(1), sendMail: async () => { throw new Error('mail unavailable'); } }), /mail unavailable/);
  assert.equal((await loadState(f.file)).streams[station.url].reported, false);
  const messages = [];
  await scan({ ...options, now: onNight(2), sendMail: async (...args) => messages.push(args) });
  assert.equal(messages.length, 1);
  assert.equal((await loadState(f.file)).streams[station.url].reported, true);
});

test('initial schedule spreads URLs across a week and a backlog is limited to 30 per run', async t => {
  const stations = Array.from({ length: 103 }, (_, i) => ({ url: `https://radio.example/${i}`, entries: station.entries }));
  const state = { streams: {} };
  seed(state, stations, 20000);
  const dates = new Set(Object.values(state.streams).map(record => record.due));
  assert.equal(dates.size, 7);
  assert.equal(Math.min(...dates), 20000);
  assert.equal(Math.max(...dates), 20006);
  const f = await fixture(t, stations);
  assert.equal((await scan({ ...f, now: start, probe: async () => working })).checked, 30);
  assert.equal((await scan({ ...f, now: onNight(1), probe: async () => working })).checked, 30);
});

test('PLS alternatives and nested M3U use only proxy URLs; daily endpoints are not fetched', async () => {
  const result = await probeStream(station.url, 'https://proxy.example/', async bytes => bytes.toString() === 'audio', {
    pause: async () => {},
    request: async (url, { headers, signal, redirect }) => {
      assert.equal(url.origin, 'https://proxy.example');
      assert.equal(headers.Origin, 'https://m.4st.uk');
      assert.equal(redirect, 'error');
      signal.throwIfAborted();
      switch (url.searchParams.get('url')) {
        case station.url: return new Response('[playlist]\nFile1=http://178.128.128.44:8096/seb\nFile2=bad\nFile3=nested.m3u\n', { headers: { 'Content-Type': 'audio/x-scpls' } });
        case 'https://radio.example/bad': return new Response('', { status: 415 });
        case 'https://radio.example/nested.m3u': return new Response('#EXTM3U\n/live\n', { headers: { 'Content-Type': 'audio/x-mpegurl' } });
        case 'https://radio.example/live': return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } });
        default: assert.fail('Unexpected target: ' + url.searchParams.get('url'));
      }
    }
  });
  assert.equal(result.status, 'working');
  assert.equal(result.url, 'https://radio.example/live');
});

test('audio sampling is bounded and aborts the relay; decoder infrastructure errors are not station failures', async () => {
  let aborted = false;
  const result = await probeStream(station.url.replace('.pls', '.mp3'), 'https://proxy.example/', async bytes => bytes.length === 192 * 1024, {
    pause: async () => {},
    request: async (_url, { signal }) => {
      signal.addEventListener('abort', () => { aborted = true; });
      return new Response(new Uint8Array(300000), { headers: { 'Content-Type': 'audio/mpeg' } });
    }
  });
  assert.equal(result.status, 'working');
  assert.equal(result.sampleBytes, 192 * 1024);
  assert.equal(aborted, true);
  await assert.rejects(probeStream('https://radio.example/live', 'https://proxy.example/', async () => { throw new Error('browser crashed'); }, {
    pause: async () => {}, request: async () => new Response('bytes')
  }), /browser crashed/);
});

test('real Chromium accepts audio samples and rejects error pages', async () => {
  const decoder = await openDecoder();
  try {
    const wav = Buffer.alloc(44 + 16000);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
    assert.equal(await decoder.decode(wav, 'audio/wav'), true);
    assert.equal(await decoder.decode(Buffer.from('<html>Unavailable</html>'), 'audio/mpeg'), false);
    const result = await probeStream('https://radio.example/slow', 'https://proxy.example/', decoder.decode, {
      pause: async () => {},
      request: async (_url, { signal }) => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(wav);
          // Stay open below the byte cap, like an endless low-bitrate stream.
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        }
      }), { headers: { 'Content-Type': 'audio/wav' } })
    });
    assert.equal(result.status, 'working');
    assert.equal(result.sampleBytes, wav.length);
    const broken = await probeStream('https://radio.example/broken', 'https://proxy.example/', decoder.decode, {
      pause: async () => {},
      request: async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(wav); },
        pull(controller) { controller.error(new Error('connection reset')); }
      }))
    });
    assert.equal(broken.status, 'failed');
    assert.match(broken.reason, /connection reset/);
  } finally { await decoder.close(); }
});
