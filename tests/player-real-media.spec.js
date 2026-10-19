import { expect, test } from '@playwright/test';

const icecastPlayerStub = `
class IcecastMetadataPlayer {
  constructor(url, options = {}) {
    this.url = url;
    this.options = options;
    this.audioElement = options.audioElement || null;
  }

  async play() {
    if (this.audioElement) {
      this.audioElement.src = this.url;
      this.audioElement.load();
      await this.audioElement.play();
    }
    if (typeof this.options.onPlay === 'function') {
      this.options.onPlay();
    }
  }

  async stop() {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.removeAttribute('src');
      this.audioElement.load();
    }
    if (typeof this.options.onStop === 'function') {
      this.options.onStop();
    }
  }

  detachAudioElement() {
    this.audioElement = null;
  }
}

window.IcecastMetadataPlayer = IcecastMetadataPlayer;
`;

function installRealMediaTestSetup() {
  localStorage.clear();
  localStorage.setItem('streamsEverInitialized', 'true');
  localStorage.setItem('bpmEnabled', 'false');
  localStorage.setItem('visualiserEnabled', 'false');

  const originalCreateMediaElementSource = AudioContext.prototype.createMediaElementSource;
  AudioContext.prototype.createMediaElementSource = function createMediaElementSource(audioElement) {
    try {
      return originalCreateMediaElementSource.call(this, audioElement);
    } catch {
      // Reusing the same media element source can happen in tests after switching modes.
      // For E2E signal checks we only need the playback path, not analyser output.
      return { connect() {} };
    }
  };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/vendor/icecast-metadata-player-1.17.13.main.min.js', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: icecastPlayerStub
    });
  });

  await page.addInitScript(installRealMediaTestSetup);
});

test('mix playback with real media increases current time', async ({ page }) => {
  await page.goto('/player.html');
  await page.evaluate(async () => {
    await playMix({
      name: 'Real Media Mix',
      isLocal: true,
      audioSrc: '/__test__/mix.wav'
    });
  });

  await page.waitForFunction(() => aud.currentTime > 0.1, null, { timeout: 10_000 });
  const samplePlayback = () => page.evaluate(() => ({
    currentTime: aud.currentTime,
    duration: aud.duration,
    paused: aud.paused,
    ended: aud.ended,
    readyState: aud.readyState,
    networkState: aud.networkState,
    bufferedEnd: aud.buffered.length ? aud.buffered.end(aud.buffered.length - 1) : null,
    contextState: audioCtx?.state,
    contextTime: audioCtx?.currentTime,
    error: aud.error?.message || null
  }));
  const start = await samplePlayback();
  await page.waitForTimeout(1500);
  const end = await samplePlayback();

  expect(end.currentTime, JSON.stringify({ start, end }, null, 2)).toBeGreaterThan(start.currentTime + 0.3);
  await expect(page.locator('#timeDisplay')).toContainText('/');
  await expect(page.locator('#playPauseBtn')).toHaveClass(/playing/);
});

test('stream playback with real media shows live state and advances', async ({ page }) => {
  await page.goto('/player.html');
  await page.evaluate(() => {
    playStream('/__test__/stream.wav', 'Test Real Stream', true);
  });

  await expect(page.locator('#timeDisplay')).toContainText('LIVE');
  await page.waitForFunction(() => aud.currentTime > 0.1, null, { timeout: 10_000 });
  const start = await page.evaluate(() => aud.currentTime);
  await page.waitForTimeout(1500);
  const end = await page.evaluate(() => aud.currentTime);

  expect(end).toBeGreaterThan(start + 0.3);

  await page.click('#playPauseBtn');
  await expect(page.locator('#timeDisplay')).toHaveText('PAUSED');

  await page.click('#playPauseBtn');
  await expect(page.locator('#timeDisplay')).toContainText('LIVE');
});

test('decoded MediaStream audio follows volume, mute, pause and source changes', async ({ page }) => {
  // Tap audio sent to Web Audio's output, rather than just checking gain values.
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
      const result = connect.call(this, destination, ...args);
      if (destination === this.context.destination) {
        const analyser = this.context.createAnalyser();
        connect.call(this, analyser);
        window.readOutputRms = () => {
          const samples = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(samples);
          return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
        };
      }
      return result;
    };
  });
  await page.goto('/player.html');
  await test.step('Resume the test decoder AudioContext from a user gesture', async () => {
    await page.evaluate(() => {
      document.addEventListener('click', () => {
        window.decoderContext = new AudioContext();
        window.decoderReady = decoderContext.resume();
      }, { once: true });
    });
    await page.mouse.click(1, 1);
    await page.evaluate(() => decoderReady);
  });
  await test.step('Start ordinary media playback', () => page.evaluate(async () => {
    await playMix({ name: 'Routing test', isLocal: true, audioSrc: '/__test__/mix.wav' });
  }));
  await test.step('Play the decoded MediaStream', () => page.evaluate(async () => {
    window.replaceDecodedStream = async () => {
      const source = decoderContext.createOscillator();
      const level = decoderContext.createGain();
      level.gain.value = 0.04;
      const destination = decoderContext.createMediaStreamDestination();
      source.connect(level).connect(destination);
      source.start();
      aud.srcObject = destination.stream;
      await aud.play();
    };
    await replaceDecodedStream();
  }));
  const output = () => page.evaluate(() => readOutputRms());
  await page.locator('#volumeSlider').fill('100');
  await expect.poll(output).toBeCloseTo(0.04 / Math.sqrt(2), 3);
  await page.locator('#volumeSlider').fill('20');
  await expect.poll(output).toBeCloseTo(0.04 / Math.sqrt(2) * 0.14, 4);
  await page.click('#muteBtn');
  await expect.poll(output).toBeLessThan(0.00001);
  await page.click('#muteBtn');
  await expect.poll(output).toBeCloseTo(0.04 / Math.sqrt(2) * 0.14, 4);
  await page.click('#playPauseBtn');
  await expect.poll(output).toBeLessThan(0.00001);
  await page.click('#playPauseBtn');
  await expect.poll(output).toBeCloseTo(0.04 / Math.sqrt(2) * 0.14, 4);
  await page.evaluate(() => replaceDecodedStream());
  await expect.poll(output).toBeCloseTo(0.04 / Math.sqrt(2) * 0.14, 4);
  await page.evaluate(async () => {
    aud.srcObject = null;
    await playMix({ name: 'Ordinary media again', isLocal: true, audioSrc: '/__test__/mix.wav' });
    await decoderContext.close();
  });
  await expect.poll(output).toBeGreaterThan(0.02);
  await page.click('#muteBtn');
  await expect.poll(output).toBeLessThan(0.00001);
});

for (const format of ['pls', 'm3u']) {
  test(`resolves a finite ${format} audio-MIME playlist without Content-Length`, async ({ page }) => {
    await page.route('**/streams/proxy-config.json', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{ url: '/__test__/playlist-proxy', streams: 'all' }])
    }));
    await page.goto('/player.html');
    const resolved = await page.evaluate(format =>
      resolveStreamPlaybackUrl(`https://station.example/live.${format}`), format);
    expect(resolved).toBe('/__test__/playlist-proxy?url=https%3A%2F%2Fstation.example%2Faudio');
  });
}

test('audio MIME normalization preserves codecs, other parameters and response bytes', async ({ page }) => {
  const cases = [
    ['audio/mpeg; charset=UTF-8', 'audio/mpeg'],
    ['audio/ogg; codecs=opus', 'audio/ogg; codecs="opus"'],
    ['audio/ogg; codecs="opus"; charset="UTF-8"', 'audio/ogg; codecs="opus"'],
    ['audio/ogg; codecs=opus,vorbis', 'audio/ogg; codecs="opus,vorbis"'],
    ['audio/ogg; CODECS = "opus"; Charset = UTF-8', 'audio/ogg; codecs="opus"'],
    ['audio/mp4; codecs="mp4a.40.2"; profile="a;charset=UTF-8"; CHARSET="UTF-8"',
      'audio/mp4; codecs="mp4a.40.2"; profile="a;charset=UTF-8"'],
    ['audio/x-scpls; charset=UTF-8', 'audio/x-scpls; charset=UTF-8'],
    ['audio/x-mpegurl; charset=UTF-8', 'audio/x-mpegurl; charset=UTF-8'],
    ['text/plain; charset=UTF-8', 'text/plain; charset=UTF-8']
  ];
  // Use real HTTP headers: WebKit's route.fulfill strips MIME parameters.
  await page.goto('/player.html');
  const results = await page.evaluate(async cases => {
    const results = [];
    for (const [type] of cases) {
      const response = await fetch(`/__test__/mime-response?type=${encodeURIComponent(type)}`);
      results.push({
        type: response.headers.get('content-type'),
        bytes: [...new Uint8Array(await response.arrayBuffer())]
      });
    }
    return results;
  }, cases);
  expect(results).toEqual(cases.map(([, type]) => ({ type, bytes: [0, 127, 128, 255] })));
});
