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

function installBaseMediaMocks() {
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

function installFrozenCurrentTimeFault() {
  HTMLMediaElement.prototype.play = function playFrozen() {
    this.__mockPaused = false;
    this.__mockCurrentTime = 0;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  };
}

function installPlayNoopFault() {
  HTMLMediaElement.prototype.play = function playNoop() {
    this.__mockPaused = true;
    this.dispatchEvent(new Event('pause'));
    return Promise.resolve();
  };
}

async function gotoWithInitScripts(page, extraInitScript) {
  await page.route('**/vendor/icecast-metadata-player-1.17.13.main.min.js', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: icecastPlayerStub
    });
  });

  await page.addInitScript(installBaseMediaMocks);
  if (extraInitScript) {
    await page.addInitScript(extraInitScript);
  }
  await page.goto('/player.html');
  await expect(page.locator('#playPauseBtn')).toBeVisible();
}

test.describe('Sensitivity Checks', () => {
  test('baseline invariant would fail when playback time is frozen', async ({ page }) => {
    await gotoWithInitScripts(page, installFrozenCurrentTimeFault);

    await page.evaluate(async () => {
      await playMix({
        name: 'Sensitivity Mix',
        isLocal: true,
        audioSrc: '/tests/fake-mix.mp3'
      });
    });

    const start = await page.evaluate(() => aud.currentTime);
    await page.waitForTimeout(1200);
    const end = await page.evaluate(() => aud.currentTime);

    // We expect invariant failure here: time should NOT have advanced meaningfully.
    expect(end).toBeLessThanOrEqual(start + 0.25);
  });

  test('baseline stream invariant would fail when play is a no-op', async ({ page }) => {
    await gotoWithInitScripts(page, installPlayNoopFault);

    await page.evaluate(() => {
      playStream('https://example.com/live', 'Sensitivity Stream', true);
    });

    const start = await page.evaluate(() => aud.currentTime);
    await page.waitForTimeout(1200);
    const end = await page.evaluate(() => aud.currentTime);

    // We expect invariant failure here: stream mode may claim LIVE, but media time should stay stuck.
    expect(end).toBeLessThanOrEqual(start + 0.1);
  });
});
