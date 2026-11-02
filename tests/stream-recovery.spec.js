import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import http from 'node:http';

// Two encodings of identical synthetic audio force the real PCM handoff path.
// Tests exercise the shipped bundle, not an IcecastMetadataPlayer stub.
function frames(data) {
  const output = [];
  for (let offset = 0; offset + 4 < data.length;) {
    const header = data.readUInt32BE(offset);
    if (header >>> 21 !== 0x7ff) { offset++; continue; }
    const bitrate = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320][header >>> 12 & 15];
    const rate = [44100,48000,32000][header >>> 10 & 3];
    const size = Math.floor(144000 * bitrate / rate) + (header >>> 9 & 1);
    if (!size || offset + size > data.length) break;
    output.push(data.subarray(offset, offset + size));
    offset += size;
  }
  return output;
}
const count = seconds => Math.floor(seconds * 44100 / 1152);
let server, origin, wrapper;
const sessions = new Map();

test.beforeAll(async () => {
  const original = frames(await fs.readFile('tests/fixtures/recovery-128.mp3'));
  const alternate = frames(await fs.readFile('tests/fixtures/recovery-160.mp3'));
  const source = await fs.readFile('stream-player.js', 'utf8');
  wrapper = source.slice(0, source.indexOf('\nlet streamPlayer ='));
  const vendor = new Map(await Promise.all((await fs.readdir('vendor')).filter(name => name.endsWith('.js'))
    .map(async name => [name, await fs.readFile(`vendor/${name}`)])));
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const id = url.searchParams.get('id');
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<button id="start">Start</button>'); return;
    }
    if (url.pathname.startsWith('/vendor/')) {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(vendor.get(url.pathname.slice(8))); return;
    }
    if (url.pathname === '/break') {
      const session = sessions.get(id);
      if (url.searchParams.get('unavailable') === 'true') session.unavailable = true;
      session.response.end(); res.end(); return;
    }
    const previous = sessions.get(id);
    const kind = url.searchParams.get('kind');
    if (previous) previous.response = res;
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    if (!previous) {
      sessions.set(id, { response: res });
      res.write(Buffer.concat(original.slice(0, count(kind === 'outage' ? 2 : 12))));
    } else if (kind === 'outage' || previous.unavailable) {
      res.flushHeaders();
    } else {
      const data = kind === 'crc' ? original : alternate;
      let offset = count(8);
      res.write(Buffer.concat(data.slice(offset, offset + count(3))));
      offset += count(3);
      const timer = setInterval(() => {
        res.write(Buffer.concat(data.slice(offset, offset + count(1))));
        offset += count(1);
      }, 1000);
      res.on('close', () => clearInterval(timer));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

async function start(page, kind = 'pcm', holdPlay = false) {
  const id = `${Date.now()}-${kind}`;
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/')) return route.continue();
    return route.abort();
  });
  await page.goto(origin);
  await page.addScriptTag({ url: `${origin}/vendor/icecast-metadata-player-1.17.13.main.min.js` });
  await page.evaluate(() => { window.playbackDiagnostics = { requestAttempt: () => undefined }; });
  await page.addScriptTag({ content: wrapper });
  await page.evaluate(({ url, holdPlay }) => {
    window.audio = new Audio();
    window.events = [];
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    context.createMediaElementSource(audio).connect(analyser);
    const gain = context.createGain(); gain.gain.value = 0;
    analyser.connect(gain).connect(context.destination);
    window.rms = () => {
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
    };
    window.player = new IcecastMetadataPlayer(url, {
      audioElement: audio, metadataTypes: [], bufferLength: 0.25, retryTimeout: 1,
      onWarn: (...messages) => events.push({ type: 'sync', messages: messages.map(String), at: performance.now() }),
      onError: (...messages) => events.push({ type: 'error', messages: messages.map(String), at: performance.now() })
    });
    for (const type of ['playing', 'stopped', 'retrying', 'retrytimeout']) {
      player.addEventListener(type, () => events.push({ type, at: performance.now() }));
    }
    audio.addEventListener('waiting', () => events.push({ type: 'waiting', at: performance.now() }));
    if (holdPlay) {
      const play = audio.play.bind(audio);
      audio.play = () => {
        const result = play();
        // Delay JS settlement only after native decoding/playback has succeeded.
        return audio.src.startsWith('blob:')
          ? result.then(() => new Promise(resolve => { window.releasePlay = resolve; })) : result;
      };
    }
    document.querySelector('#start').onclick = () => { context.resume(); player.play(); };
  }, { url: `${origin}/stream?id=${id}&kind=${kind}`, holdPlay });
  await page.click('#start');
  await expect.poll(() => page.evaluate(() => audio.currentTime)).toBeGreaterThan(0.3);
  await expect.poll(() => page.evaluate(() => rms())).toBeGreaterThan(0.01);
  return (unavailable = false) => page.request.get(`${origin}/break?id=${id}&unavailable=${unavailable}`);
}

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium' && browserName !== 'firefox', 'Native recovery coverage is Chromium and Firefox');
});

test('delayed PCM handoff resumes decoded audio after the old retry deadline', async ({ page }) => {
  const disconnect = await start(page);
  const source = await page.evaluate(() => audio.src);
  await disconnect();
  await expect.poll(() => page.evaluate(() => {
    return events.some(e => e.type === 'sync' && e.messages.some(m => m.includes('% confidence')));
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => audio.src), { timeout: 15000 }).not.toBe(source);
  await expect.poll(() => page.evaluate(() => player.state)).toBe('playing');
  await expect.poll(() => page.evaluate(() => audio.currentTime)).toBeGreaterThan(0.7);
  await expect.poll(() => page.evaluate(() => rms())).toBeGreaterThan(0.01);
  expect(await page.evaluate(() => events.some(e => e.type === 'retrytimeout'))).toBe(false);
});

test('late successful play completion cannot revive an explicitly stopped player', async ({ page }) => {
  await start(page, 'pcm', true);
  await expect.poll(() => page.evaluate(() => Boolean(window.releasePlay))).toBe(true);
  await page.evaluate(async () => { await player.stop(); releasePlay(); });
  await expect.poll(() => page.evaluate(() => player.state)).toBe('stopped');
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => ({ state: player.state, paused: audio.paused, clock: audio.currentTime })))
    .toEqual({ state: 'stopped', paused: true, clock: 0 });
});

test('a real outage still times out once, one retry interval after audio waits', async ({ page }) => {
  const disconnect = await start(page, 'outage');
  await disconnect();
  await expect.poll(() => page.evaluate(() => player.state), { timeout: 7000 }).toBe('stopped');
  const result = await page.evaluate(() => {
    const retry = events.find(e => e.type === 'retrying');
    const waiting = events.find(e => e.type === 'waiting' && e.at > retry.at);
    const timeouts = events.filter(e => e.type === 'retrytimeout');
    return { count: timeouts.length, delay: timeouts[0].at - waiting.at, paused: audio.paused };
  });
  expect(result.count).toBe(1);
  expect(result.paused).toBe(true);
  expect(result.delay).toBeGreaterThanOrEqual(950);
  expect(result.delay).toBeLessThan(1800);
});

test('identical-frame reconnection continues without resetting the clock', async ({ page }) => {
  const disconnect = await start(page, 'crc');
  await expect.poll(() => page.evaluate(() => audio.currentTime)).toBeGreaterThan(2.5);
  const before = await page.evaluate(() => audio.currentTime);
  await disconnect();
  await expect.poll(() => page.evaluate(() => {
    return events.some(e => e.type === 'sync' && e.messages.some(m => m.includes('overlapping audio')));
  })).toBe(true);
  expect(await page.evaluate(() => audio.currentTime)).toBeGreaterThanOrEqual(before);
  await expect.poll(() => page.evaluate(() => audio.currentTime)).toBeGreaterThan(before + 0.5);
  expect(await page.evaluate(() => player.state)).toBe('playing');
  expect(await page.evaluate(() => events.some(e => e.type === 'retrytimeout'))).toBe(false);
  // A completed retry must not leave a waiting continuation which cuts short
  // the next retry. Seek near the buffered end to exercise this without a long wait.
  await disconnect(true);
  await expect.poll(() => page.evaluate(() => player.state)).toBe('retrying');
  await page.evaluate(() => { audio.currentTime = audio.buffered.end(audio.buffered.length - 1) - 0.2; });
  await expect.poll(() => page.evaluate(() => player.state)).toBe('stopped');
  const delay = await page.evaluate(() => {
    const retry = events.filter(e => e.type === 'retrying').at(-1);
    const waiting = events.find(e => e.type === 'waiting' && e.at > retry.at);
    return events.find(e => e.type === 'retrytimeout').at - waiting.at;
  });
  expect(delay).toBeGreaterThanOrEqual(950);
});
