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
  const preserveStorage = sessionStorage.getItem('__e2ePreserveStorage') === '1';
  if (!preserveStorage) {
    localStorage.clear();
  }
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
    element.__mockSeekableEnd = 3600;

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
          end: () => this.__mockSeekableEnd
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

test('stream playback restores across refresh and keeps advancing', async ({ page }) => {
  await page.evaluate(() => {
    sessionStorage.setItem('__e2ePreserveStorage', '1');
    localStorage.setItem('streamUrl', 'https://example.com/live');
    localStorage.setItem('streamDisplayText', 'Restored Stream');
    localStorage.setItem('wasPlaying', 'true');
  });

  await page.reload();
  await page.evaluate(() => {
    sessionStorage.removeItem('__e2ePreserveStorage');
  });
  await expect(page.locator('#timeDisplay')).toContainText('LIVE');

  const start = await page.evaluate(() => aud.currentTime);
  await page.waitForTimeout(1200);
  const end = await page.evaluate(() => aud.currentTime);

  expect(end).toBeGreaterThan(start + 0.75);
});

test('waveform click seeks and clamps to seekable range', async ({ page }) => {
  await page.evaluate(() => {
    const canvas = document.getElementById('waveform');
    if (!canvas) throw new Error('waveform canvas not found');

    aud.load();
    state.currentPeaks = new Array(100).fill(0.5);
    aud.duration = 200;
    aud.currentTime = 0;
    aud.__mockSeekableEnd = 120;

    canvas.width = 500;
    canvas.height = 60;
    canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 500,
      bottom: 60,
      width: 500,
      height: 60,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });

    canvas.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 250,
      clientY: 20
    }));
  });

  const midSeek = await page.evaluate(() => aud.currentTime);
  expect(midSeek).toBeGreaterThanOrEqual(99);
  expect(midSeek).toBeLessThanOrEqual(101);

  await page.evaluate(() => {
    const canvas = document.getElementById('waveform');
    if (!canvas) throw new Error('waveform canvas not found');

    canvas.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 490,
      clientY: 20
    }));
  });

  const clampedSeek = await page.evaluate(() => aud.currentTime);
  expect(clampedSeek).toBe(120);
});
