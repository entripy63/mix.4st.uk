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
      await this.audioElement.play();
    }
    if (typeof this.options.onPlay === 'function') {
      this.options.onPlay();
    }
  }

  async stop() {
    if (this.audioElement) {
      this.audioElement.pause();
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

function installMediaAndAudioContextMocks() {
  localStorage.clear();
  localStorage.setItem('streamsEverInitialized', 'true');
  localStorage.setItem('bpmEnabled', 'false');
  localStorage.setItem('visualiserEnabled', 'false');

  class MockAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = {};
    }

    createAnalyser() {
      return {
        fftSize: 128,
        smoothingTimeConstant: 0,
        frequencyBinCount: 64,
        getByteFrequencyData(arr) { arr.fill(0); },
        getByteTimeDomainData(arr) { arr.fill(128); },
        connect() {}
      };
    }

    createGain() {
      return {
        gain: {
          setTargetAtTime() {},
          cancelScheduledValues() {}
        },
        connect() {}
      };
    }

    createMediaElementSource() {
      return {
        connect() {}
      };
    }

    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
  }

  window.AudioContext = MockAudioContext;
  window.webkitAudioContext = MockAudioContext;

  const timers = new WeakMap();

  const applyMockState = (element) => {
    if (element.__mockAudioReady) return;
    element.__mockAudioReady = true;
    element.__mockPaused = true;
    element.__mockCurrentTime = 0;
    element.__mockDuration = 3600;

    Object.defineProperty(element, 'paused', {
      configurable: true,
      get() {
        return this.__mockPaused;
      }
    });

    Object.defineProperty(element, 'currentTime', {
      configurable: true,
      get() {
        return this.__mockCurrentTime;
      },
      set(value) {
        this.__mockCurrentTime = Number.isFinite(value) ? value : 0;
      }
    });

    Object.defineProperty(element, 'duration', {
      configurable: true,
      get() {
        return this.__mockDuration;
      },
      set(value) {
        this.__mockDuration = Number.isFinite(value) ? value : 0;
      }
    });

    Object.defineProperty(element, 'readyState', {
      configurable: true,
      get() {
        return 4;
      }
    });

    Object.defineProperty(element, 'networkState', {
      configurable: true,
      get() {
        return 1;
      }
    });

    Object.defineProperty(element, 'seekable', {
      configurable: true,
      get() {
        return {
          length: 1,
          start: () => 0,
          end: () => this.__mockDuration
        };
      }
    });

    Object.defineProperty(element, 'buffered', {
      configurable: true,
      get() {
        return {
          length: 1,
          start: () => 0,
          end: () => this.__mockDuration
        };
      }
    });
  };

  const stopTimer = (element) => {
    const timer = timers.get(element);
    if (timer) {
      clearInterval(timer);
      timers.delete(element);
    }
  };

  HTMLMediaElement.prototype.load = function load() {
    applyMockState(this);
    this.dispatchEvent(new Event('loadstart'));
    this.dispatchEvent(new Event('loadedmetadata'));
    this.dispatchEvent(new Event('durationchange'));
  };

  HTMLMediaElement.prototype.play = function play() {
    applyMockState(this);
    this.__mockPaused = false;
    this.dispatchEvent(new Event('play'));
    stopTimer(this);

    const timer = setInterval(() => {
      if (this.__mockPaused) return;
      this.__mockCurrentTime += 0.25;
      this.dispatchEvent(new Event('timeupdate'));
    }, 250);

    timers.set(this, timer);
    return Promise.resolve();
  };

  HTMLMediaElement.prototype.pause = function pause() {
    applyMockState(this);
    this.__mockPaused = true;
    stopTimer(this);
    this.dispatchEvent(new Event('pause'));
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

  await page.addInitScript(installMediaAndAudioContextMocks);
  await page.goto('/player.html');
  await expect(page.locator('#playPauseBtn')).toBeVisible();
});

test('mix playback advances play position over time', async ({ page }) => {
  await page.evaluate(async () => {
    await playMix({
      name: 'E2E Mix',
      isLocal: true,
      audioSrc: '/tests/fake-mix.mp3'
    });
  });

  const start = await page.evaluate(() => aud.currentTime);
  await page.waitForTimeout(1200);
  const end = await page.evaluate(() => aud.currentTime);

  expect(end).toBeGreaterThan(start + 0.75);
  await expect(page.locator('#timeDisplay')).toContainText('/');
  await expect(page.locator('#playPauseBtn')).toHaveClass(/playing/);
});

test('stream playback enters live mode and supports pause/resume', async ({ page }) => {
  await page.evaluate(() => {
    playStream('https://example.com/live', 'Test Stream', true);
  });

  await expect(page.locator('#timeDisplay')).toContainText('LIVE');

  const start = await page.evaluate(() => aud.currentTime);
  await page.waitForTimeout(1200);
  const end = await page.evaluate(() => aud.currentTime);
  expect(end).toBeGreaterThan(start + 0.75);

  await page.click('#playPauseBtn');
  await expect(page.locator('#timeDisplay')).toHaveText('PAUSED');

  await page.click('#playPauseBtn');
  await expect(page.locator('#timeDisplay')).toContainText('LIVE');
  await expect(page.locator('#playPauseBtn')).toHaveClass(/playing/);
});

test('search jungletrain stream uses proxy fallback and not direct http playback', async ({ page }) => {
  await page.route('**/mixes/search-index.json', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify([
        {
          dj: 'trip',
          file: 'jungletrain-01',
          name: 'Jungletrain Mix One',
          artist: 'Trip',
          genre: 'Jungle',
          comment: '',
          duration: '60:00'
        },
        {
          dj: 'haze',
          file: 'jungletrain-02',
          name: 'Jungletrain Mix Two',
          artist: 'Haze',
          genre: 'Drum & Bass',
          comment: '',
          duration: '58:00'
        }
      ])
    });
  });

  await page.route('**/streams/search-index.json', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify([
        {
          name: 'Jungletrain.net',
          genre: 'Jungle/Drum & Bass',
          url: 'https://jungletrain.net/static/256kbps.m3u',
          preset: 'Default',
          presetLabel: 'Default'
        }
      ])
    });
  });

  await page.evaluate(() => {
    const encodedStream = encodeURIComponent('http://123.45.67.89:8000/stream');
    window.__probeCalls = [];

    fetchPlaylist = async () => [{
      url: 'http://123.45.67.89:8000/stream',
      title: 'Jungletrain Source'
    }];

    let probeAttempt = 0;
    probeStream = async (url) => {
      window.__probeCalls.push(url);
      probeAttempt += 1;
      // First proxy fails, second succeeds
      return probeAttempt === 2;
    };

    window.__encodedStream = encodedStream;
  });

  await page.click('.mode-btn[data-mode="search"]');
  await page.fill('#searchInput', 'jungletrain');

  await expect(page.locator('#searchInfo')).toContainText('3 results');
  await expect(page.locator('#mixList .mix-item')).toHaveCount(3);

  const mixRows = page.locator('#mixList .mix-item');
  await expect(mixRows.nth(0).locator('.mix-name')).toContainText('Jungletrain Mix One');
  await expect(mixRows.nth(1).locator('.mix-name')).toContainText('Jungletrain Mix Two');
  await expect(mixRows.nth(2).locator('.mix-name')).toContainText('Jungletrain.net');

  await mixRows.nth(2).locator('[data-action="search-play-stream"]').click();

  await page.waitForFunction(() => state.isStream && !!state.streamUrl);

  const playbackState = await page.evaluate(() => ({
    isStream: state.isStream,
    streamUrl: state.streamUrl,
    streamM3u: state.streamM3u,
    probeCalls: window.__probeCalls,
    encodedStream: window.__encodedStream
  }));

  expect(playbackState.isStream).toBe(true);
  expect(playbackState.streamM3u).toBe('https://jungletrain.net/static/256kbps.m3u');
  expect(playbackState.probeCalls.length).toBeGreaterThanOrEqual(2);
  expect(playbackState.streamUrl).toBe(playbackState.probeCalls[1]);
  expect(playbackState.streamUrl).toContain(`url=${playbackState.encodedStream}`);
  expect(playbackState.streamUrl).not.toContain('http://123.45.67.89:8000/stream');
});
