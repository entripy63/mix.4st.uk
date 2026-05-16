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

test('keyboard space toggles play and pause', async ({ page }) => {
  await page.evaluate(async () => {
    await playMix({
      name: 'Keyboard Mix',
      isLocal: true,
      audioSrc: '/tests/fake-mix.mp3'
    });
  });

  await expect(page.locator('#playPauseBtn')).toHaveClass(/playing/);
  await page.keyboard.press('Space');
  await expect(page.locator('#playPauseBtn')).toHaveClass(/paused/);
  await page.keyboard.press('Space');
  await expect(page.locator('#playPauseBtn')).toHaveClass(/playing/);
});

test('keyboard ctrl shortcuts switch mode and queue position', async ({ page }) => {
  await page.evaluate(async () => {
    state.queue = [
      { name: 'One', isLocal: true, queueId: 1 },
      { name: 'Two', isLocal: true, queueId: 2 },
      { name: 'Three', isLocal: true, queueId: 3 }
    ];
    state.currentQueueIndex = 0;
    displayQueue();
    await browserModes.switch('dj');
  });

  await page.keyboard.press('Control+ArrowDown');
  await page.waitForFunction(() => state.currentQueueIndex === 1);

  await page.keyboard.press('Control+ArrowUp');
  await page.waitForFunction(() => state.currentQueueIndex === 0);

  await page.keyboard.press('Control+KeyL');
  await expect(page.locator('.mode-btn.active[data-mode="live"]')).toBeVisible();

  await page.keyboard.press('Control+KeyD');
  await expect(page.locator('.mode-btn.active[data-mode="dj"]')).toBeVisible();
});

test('after mix ends: stop after current prevents queue advancement', async ({ page }) => {
  const result = await page.evaluate(async () => {
    storage.set('afterMixEnds', 'stop');
    state.isStream = false;
    state.queue = [
      { name: 'Queue A', isLocal: true, queueId: 11 },
      { name: 'Queue B', isLocal: true, queueId: 12 }
    ];
    state.currentQueueIndex = 0;

    window.__playFromQueueCalls = [];
    const originalPlayFromQueue = window.playFromQueue;
    window.playFromQueue = async (index) => {
      window.__playFromQueueCalls.push(index);
    };

    aud.dispatchEvent(new Event('ended'));
    await new Promise(resolve => setTimeout(resolve, 20));

    const outcome = {
      currentQueueIndex: state.currentQueueIndex,
      calls: [...window.__playFromQueueCalls]
    };

    window.playFromQueue = originalPlayFromQueue;
    delete window.__playFromQueueCalls;
    return outcome;
  });

  expect(result.currentQueueIndex).toBe(0);
  expect(result.calls).toEqual([]);
});

test('after mix ends: continue advances queue (default)', async ({ page }) => {
  const result = await page.evaluate(async () => {
    storage.remove('afterMixEnds');
    state.isStream = false;
    state.queue = [
      { name: 'Queue A', isLocal: true, queueId: 11 },
      { name: 'Queue B', isLocal: true, queueId: 12 }
    ];
    state.currentQueueIndex = 0;

    window.__playFromQueueCalls = [];
    const originalPlayFromQueue = window.playFromQueue;
    window.playFromQueue = async (index) => {
      window.__playFromQueueCalls.push(index);
    };

    aud.dispatchEvent(new Event('ended'));
    await new Promise(resolve => setTimeout(resolve, 20));

    const outcome = {
      currentQueueIndex: state.currentQueueIndex,
      calls: [...window.__playFromQueueCalls]
    };

    window.playFromQueue = originalPlayFromQueue;
    delete window.__playFromQueueCalls;
    return outcome;
  });

  expect(result.currentQueueIndex).toBe(1);
  expect(result.calls).toEqual([1]);
});

test('after mix ends: continue starts queue when not in queue', async ({ page }) => {
  const result = await page.evaluate(async () => {
    storage.remove('afterMixEnds');
    state.isStream = false;
    state.queue = [
      { name: 'Queue A', isLocal: true, queueId: 11 },
      { name: 'Queue B', isLocal: true, queueId: 12 }
    ];
    state.currentQueueIndex = -1;

    window.__playFromQueueCalls = [];
    const originalPlayFromQueue = window.playFromQueue;
    window.playFromQueue = async (index) => {
      window.__playFromQueueCalls.push(index);
    };

    aud.dispatchEvent(new Event('ended'));
    await new Promise(resolve => setTimeout(resolve, 20));

    const outcome = {
      currentQueueIndex: state.currentQueueIndex,
      calls: [...window.__playFromQueueCalls]
    };

    window.playFromQueue = originalPlayFromQueue;
    delete window.__playFromQueueCalls;
    return outcome;
  });

  expect(result.currentQueueIndex).toBe(0);
  expect(result.calls).toEqual([0]);
});

test('stop after current button toggles state', async ({ page }) => {
  const result = await page.evaluate(() => {
    storage.remove('afterMixEnds');
    toggleStopAfter();
    const afterFirst = storage.get('afterMixEnds');
    const btnActive = document.getElementById('stopAfterBtn').classList.contains('active');
    toggleStopAfter();
    const afterSecond = storage.get('afterMixEnds');
    return { afterFirst, btnActive, afterSecond };
  });

  expect(result.afterFirst).toBe('stop');
  expect(result.btnActive).toBe(true);
  expect(result.afterSecond).toBe('continue');
});
