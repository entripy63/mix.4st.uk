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
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
      res.end(); return;
    }
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
    if (url.pathname === '/timing') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      // Many small appends expose cumulative rounding, unlike one large file.
      // Skip the encoder's metadata frame and keep the response open at the end.
      let sent = 0;
      const timer = setInterval(() => {
        res.write(original[1 + sent % (original.length - 1)]);
        if (++sent === 1960) clearInterval(timer);
      }, 2);
      res.on('close', () => clearInterval(timer));
      return;
    }
    const previous = sessions.get(id);
    const kind = url.searchParams.get('kind');
    if (previous) previous.response = res;
    // The full app requests ICY metadata. Supply valid empty metadata blocks,
    // rather than leaving its detector waiting for more bytes indefinitely.
    const icy = id.includes('-app-');
    let untilMetadata = 16384;
    const write = data => {
      if (!icy) return res.write(data);
      while (data.length) {
        const size = Math.min(untilMetadata, data.length);
        res.write(data.subarray(0, size));
        data = data.subarray(size);
        untilMetadata -= size;
        if (!untilMetadata) {
          res.write(Buffer.from([0]));
          untilMetadata = 16384;
        }
      }
    };
    if (icy) {
      res.setHeader('icy-metaint', '16384');
      res.setHeader('Access-Control-Expose-Headers', 'icy-metaint');
    }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Access-Control-Allow-Origin': '*' });
    if (!previous) {
      sessions.set(id, { response: res });
      write(Buffer.concat(original.slice(0, count(kind === 'outage' ? 2 : 12))));
    } else if (kind === 'outage' || previous.unavailable) {
      res.flushHeaders();
    } else {
      const data = kind === 'crc' ? original : alternate;
      let offset = count(8);
      write(Buffer.concat(data.slice(offset, offset + count(3))));
      offset += count(3);
      const timer = setInterval(() => {
        write(Buffer.concat(data.slice(offset, offset + count(1))));
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

test('MP3 append boundaries do not accumulate timestamp drift', async ({ page }) => {
  await page.route('**/*', route => route.request().url().startsWith(origin + '/')
    && !route.request().url().endsWith('/favicon.ico') ? route.continue() : route.abort());
  await page.goto(origin);
  await page.evaluate(() => {
    window.appended = [];
    const append = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function(data) {
      // Observe the actual bytes passed to native MSE; do not fake its timing.
      appended.push(Array.from(new Uint8Array(data)));
      return append.call(this, data);
    };
  });
  await page.addScriptTag({ url: `${origin}/vendor/icecast-metadata-player-1.17.13.main.min.js` });
  await page.evaluate(url => {
    window.audio = new Audio(); audio.muted = true;
    window.player = new IcecastMetadataPlayer(url, { audioElement: audio, metadataTypes: [] });
    document.querySelector('#start').onclick = () => player.play();
  }, `${origin}/timing`);
  await page.click('#start');
  await expect.poll(() => page.evaluate(() => audio.buffered.length ? audio.buffered.end(0) : 0),
    { timeout: 15000 }).toBeGreaterThan(51);
  // Finish the last few writes before comparing the completed append sequence.
  await page.waitForTimeout(250);
  // The parser may retain its last frames awaiting more input. Count samples
  // actually appended, independently of the browser's reported timestamps.
  const chunks = (await page.evaluate(() => appended)).map(data => Buffer.from(data));
  function samples(data) {
    if (!data.length) return 0;
    if (data.readUInt32BE(0) >>> 21 === 0x7ff) return frames(data).length * 1152;
    let count = 0;
    for (let offset = 0; offset + 8 <= data.length;) {
      const size = data.readUInt32BE(offset);
      const type = data.toString('ascii', offset + 4, offset + 8);
      if (size < 8 || offset + size > data.length) throw new Error('Invalid MP4 box');
      if (type === 'moof' || type === 'traf') count += samples(data.subarray(offset + 8, offset + size));
      if (type === 'trun') count += data.readUInt32BE(offset + 12) * 1152;
      offset += size;
    }
    return count;
  }
  const expected = chunks.reduce((total, data) => total + samples(data), 0) / 44100;
  const actual = await page.evaluate(() => audio.buffered.end(audio.buffered.length - 1));
  expect(expected).toBeGreaterThan(51);
  expect(Math.abs(actual - expected)).toBeLessThan(0.00001);
  await expect.poll(() => page.evaluate(() => audio.currentTime)).toBeGreaterThan(1);
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

for (const kind of ['pcm', 'crc']) {
  test(`app listening time survives a real ${kind} reconnection`, async ({ page, baseURL }) => {
    test.setTimeout(45000);
    const id = `${Date.now()}-app-${kind}`;
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('streamsEverInitialized', 'true');
      localStorage.setItem('bpmEnabled', 'false');
      localStorage.setItem('visualiserEnabled', 'false');
    });
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/') || url.startsWith(baseURL + '/')) return route.continue();
      return route.abort();
    });
    await page.goto('/player.html');
    await page.waitForFunction(() => liveProbeReady);
    // Mute output, not decoding: this uses the real app, library and media stack.
    await page.mouse.click(1, 1);
    await page.evaluate(async url => {
      volume.mute();
      playStream(url, 'Synthetic recovery station', true);
      await Promise.resolve();
      window.handoffs = [];
      streamPlayer.addEventListener('warn', event => handoffs.push(event.detail.map(String).join(' ')));
    }, `${origin}/stream?id=${id}&kind=${kind}`);
    await expect.poll(() => page.evaluate(() => aud.currentTime), { timeout: 15000 }).toBeGreaterThan(4);
    const before = await page.evaluate(() => ({ source: aud.currentSrc, clock: aud.currentTime }));
    await expect(page.locator('#timeDisplay')).toHaveText(/LIVE\s+0:0[34]/);
    await page.request.get(`${origin}/break?id=${id}`);
    await expect.poll(() => page.evaluate(kind => handoffs.some(message =>
      message.includes(kind === 'pcm' ? '% confidence' : 'overlapping audio')), kind), { timeout: 15000 }).toBe(true);
    if (kind === 'pcm') {
      await expect.poll(() => page.evaluate(() => aud.currentSrc), { timeout: 15000 }).not.toBe(before.source);
      await expect.poll(() => page.evaluate(() => aud.currentTime)).toBeGreaterThan(0.7);
      expect(await page.evaluate(() => aud.currentTime)).toBeLessThan(before.clock);
    }
    // The old media clock would now show under 4s after PCM replacement.
    // The session clock must preserve at least the original four seconds.
    const displayed = await page.locator('#timeDisplay').innerText();
    expect(Number(displayed.match(/0:(\d+)/)[1])).toBeGreaterThanOrEqual(3);
    const current = await page.evaluate(() => aud.currentTime);
    await expect.poll(() => page.evaluate(() => aud.currentTime)).toBeGreaterThan(current + 1.2);
    await expect(page.locator('#timeDisplay')).not.toHaveText(displayed);
  });
}
