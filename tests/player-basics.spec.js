import { expect, test } from '@playwright/test';

const icecastPlayerStub = `
class IcecastMetadataPlayer extends EventTarget {
  constructor(url, options = {}) {
    super();
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
  await page.route(/\/vendor\/icecast-metadata-player-1\.17\.13\.main\.min\.js(?:\?.*)?$/, route => {
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
  await expect(page.locator('#timeDisplay')).toHaveText(/^PAUSED\s+0:0[12]$/);

  await page.click('#playPauseBtn');
  await expect(page.locator('#timeDisplay')).toContainText('LIVE');
  await expect(page.locator('#playPauseBtn')).toHaveClass(/playing/);
});

test('listening time accumulates across clock resets, pauses and proxy changes, not stalls or placeholders', async ({ page }) => {
  await page.waitForFunction(() => liveProbeReady);
  await page.clock.install();
  await page.evaluate(() => {
    setCurrentStream('https://proxy.example/?url=https%3A%2F%2Fradio.example%2Flive', 'Station', 'https://radio.example/station.pls');
    playStream(state.streamUrl, 'Station', true);
  });
  await page.clock.runFor(6000);
  await expect(page.locator('#timeDisplay')).toHaveText('LIVE  0:06');
  await page.evaluate(() => {
    // A reconnect replaces the decoder timeline without changing the station.
    aud.currentTime = 0;
    aud.dispatchEvent(new Event('emptied'));
  });
  await page.clock.runFor(3250);
  await expect(page.locator('#timeDisplay')).toHaveText('LIVE  0:09');
  await page.click('#playPauseBtn');
  await page.clock.runFor(60000);
  await expect(page.locator('#timeDisplay')).toHaveText('PAUSED  0:09');
  await page.click('#playPauseBtn');
  await page.clock.runFor(2000);
  await expect(page.locator('#timeDisplay')).toHaveText('LIVE  0:11');

  await page.evaluate(() => {
    // Same playlist through another proxy is still the same listening session.
    setCurrentStream('https://other-proxy.example/?url=https%3A%2F%2Fradio.example%2Fnew-endpoint', 'Renamed station', 'https://radio.example/station.pls');
    playStream(state.streamUrl, 'Renamed station', true);
  });
  await page.clock.runFor(1000);
  await expect(page.locator('#timeDisplay')).toHaveText('LIVE  0:12');
  await page.evaluate(() => {
    // Real library startup loops a silent data URL. Its clock must not count.
    Object.defineProperty(aud, 'currentSrc', { configurable: true, value: 'data:audio/mpeg;base64,placeholder' });
  });
  await page.clock.runFor(10000);
  await expect(page.locator('#timeDisplay')).toHaveText('LIVE  0:12');
  await page.evaluate(() => {
    Object.defineProperty(aud, 'currentSrc', { configurable: true, value: 'blob:decoded-stream' });
    aud.currentTime = 0;
  });
  await page.clock.runFor(3250);
  await expect(page.locator('#timeDisplay')).toHaveText('LIVE  0:15');
  await page.evaluate(() => { aud.currentTime += 7200; });
  await page.clock.runFor(1000);
  await expect(page.locator('#timeDisplay')).toHaveText('LIVE  0:15');
  await page.evaluate(() => aud.pause()); // Unexpected stall, not user Pause.
  await page.clock.runFor(60000);
  await expect(page.locator('#timeDisplay')).toHaveText('LIVE  0:15');
  await page.evaluate(() => aud.play());
  await page.click('#muteBtn');
  await page.clock.runFor(2000);
  await expect(page.locator('#timeDisplay')).toHaveText('LIVE  0:17');

  await page.evaluate(() => {
    setCurrentStream('https://radio.example/second', 'Different station');
    playStream(state.streamUrl, 'Different station', true);
  });
  await page.clock.runFor(2000);
  await expect(page.locator('#timeDisplay')).toHaveText('LIVE  0:02');
  await page.evaluate(() => {
    setCurrentStream('https://radio.example/live', 'Original station', 'https://radio.example/station.pls');
    playStream(state.streamUrl, 'Original station', true);
  });
  await expect(page.locator('#timeDisplay')).toHaveText('LIVE  0:00');
  await page.clock.runFor(2000);
  await page.reload();
  await page.waitForFunction(() => liveProbeReady);
  await page.evaluate(() => playStream('https://radio.example/live', 'Original station', true));
  await expect(page.locator('#timeDisplay')).toHaveText('LIVE  0:00');
});

test('listening time shows days across midnight without overflowing into media timing', async ({ page }) => {
  await page.waitForFunction(() => liveProbeReady);
  await page.clock.install();
  await page.evaluate(() => playStream('https://radio.example/live', 'Long session', true));
  // Advance both independent inputs: elapsed wall time and decoded media time.
  // fastForward fires the mock's 250ms media timer once, not once per interval.
  await page.evaluate(() => { aud.currentTime = 86399 - 0.25; });
  await page.clock.fastForward(86399000);
  await expect(page.locator('#timeDisplay')).toHaveText('LIVE  23:59:59');
  await page.clock.runFor(1000);
  await expect(page.locator('#timeDisplay')).toHaveText('LIVE  1d 00:00:00');
  const total = 23 * 86400 + 17 * 3600 + 23 * 60 + 4;
  await page.evaluate(total => { aud.currentTime = total - 0.25; }, total);
  await page.clock.fastForward((total - 86400) * 1000);
  await expect(page.locator('#timeDisplay')).toHaveText('LIVE  23d 17:23:04');
  await page.click('#playPauseBtn');
  await expect(page.locator('#timeDisplay')).toHaveText('PAUSED  23d 17:23:04');
});

test('listening time reset requires confirmation and never restarts playback', async ({ page }) => {
  await page.waitForFunction(() => liveProbeReady);
  await page.clock.install();
  // Only explicit runFor calls should advance playback during UI interactions.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.evaluate(() => playStream('https://radio.example/live', 'Station', true));
  await page.clock.runFor(7000);
  const timer = page.locator('#timeDisplay');
  const dialog = page.getByRole('dialog', { name: 'Reset listening time?' });
  await expect(timer).toHaveAttribute('title', /click to reset\nhttps:\/\/radio.example\/live/);
  // Enter must open the dialog, not also confirm it in the same key event.
  await timer.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).press('Enter');
  await expect(timer).toHaveText('LIVE  0:07');
  await expect(timer).toBeFocused();
  await page.keyboard.press('Space');
  await page.clock.runFor(20); // Let the pause declick fade settle.
  await expect(dialog).toBeHidden();
  await expect(timer).toHaveText('PAUSED  0:07');
  await expect(page.locator('#playPauseBtn')).toHaveClass(/paused/);
  await expect(timer).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('#playPauseBtn')).toHaveClass(/playing/);
  await expect(dialog).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#playPauseBtn')).toHaveClass(/playing/);
  await dialog.getByRole('button', { name: 'Reset time' }).press('Space');
  await expect(dialog).toBeHidden();
  await expect(timer).toHaveText('LIVE  0:00');
  expect(await page.evaluate(() => aud.currentTime)).toBe(7);
  await expect(timer).toBeFocused();
  await page.keyboard.press('Space');
  await page.clock.runFor(20);
  await expect(timer).toHaveText('PAUSED  0:00');
  await expect(dialog).toBeHidden();
  await page.keyboard.press('Space');
  await page.clock.runFor(3000);
  await expect(timer).toHaveText('LIVE  0:03');
  expect(await page.evaluate(() => aud.currentTime)).toBe(10);
  await page.click('#playPauseBtn');
  await page.clock.runFor(20);
  await timer.click();
  await dialog.getByRole('button', { name: 'Reset time' }).click();
  await expect(timer).toHaveText('PAUSED  0:00');
  await page.clock.runFor(60000);
  await expect(timer).toHaveText('PAUSED  0:00');

  await page.click('#playPauseBtn');
  await page.clock.runFor(4000);
  await timer.click();
  await page.evaluate(() => {
    setCurrentStream('https://radio.example/new', 'New station');
    playStream(state.streamUrl, 'New station', true);
  });
  await page.clock.runFor(2000);
  await dialog.getByRole('button', { name: 'Reset time' }).click();
  await expect(timer).toHaveText('LIVE  0:02');
  await page.evaluate(async () => {
    await playMix({ name: 'Mix', isLocal: true, audioSrc: '/__test__/mix.wav' });
  });
  await page.clock.runFor(20); // Loading ordinary media also waits for declick.
  await expect(timer).not.toHaveAttribute('role');
  await timer.click();
  await expect(dialog).toBeHidden();
  await expect(timer).toContainText('/');
});

test('playback diagnostics retain a redacted fault through switching and reload, with explicit attachment', async ({ page }) => {
  const reports = [];
  await page.route('**/report.php', route => {
    reports.push(route.request().postDataJSON());
    return route.fulfill({ status: 204 });
  });
  await page.evaluate(() => {
    const upstream = 'https://alice:secret-password@radio.example/live?token=secret-token#secret-fragment';
    playStream(`/__test__/stream.wav?url=${encodeURIComponent(upstream)}&auth=secret-outer`, 'Station', true);
  });
  await expect(page.locator('#timeDisplay')).toContainText('LIVE');
  await page.evaluate(() => {
    const oldStreamError = streamPlayer.options.onError;
    oldStreamError('network error: secret-error-text', new TypeError('secret-error-text'));
    playStream('/__test__/mix.wav', 'Next station', true);
    // An old player's late callback must retain its own source identity.
    oldStreamError('network error: secret-error-text', new TypeError('secret-error-text'));
  });
  await page.reload();
  await page.evaluate(() => showReport());
  await expect(page.locator('#diagnosticsSummary')).toContainText('stream error');
  const diagnosticText = await page.locator('#diagnosticsText').inputValue();
  const diagnostics = JSON.parse(diagnosticText);
  expect(diagnostics.incident.category).toBe('network');
  expect(diagnostics.incident.source.upstream).toBe('https://radio.example/live');
  expect(diagnostics.incident.firstError.playback.requested.upstream).toBe('https://radio.example/live');
  expect(diagnostics.incident.errors[0].count).toBe(2);
  expect(diagnostics.incidents).toHaveLength(1);
  expect(diagnostics.incident.events.some(event => event.type === 'source-selected')).toBe(true);
  expect(diagnostics.recent.some(event => event.playback.requested?.address.endsWith('/__test__/mix.wav'))).toBe(true);
  expect(diagnosticText).not.toMatch(/alice|secret-/);
  expect(Buffer.byteLength(JSON.stringify(diagnostics))).toBeLessThanOrEqual(131072);
  await expect(page.locator('#autoPlaybackReports')).not.toBeChecked();
  await expect(page.locator('#reportIncludeDiagnostics')).not.toBeChecked();
  expect(reports).toHaveLength(0);

  // Clipboard denial must leave a usable manual-copy path.
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) }
  }));
  await page.getByRole('button', { name: 'Copy diagnostics' }).click();
  await expect(page.locator('#diagnosticsText')).toBeVisible();
  await expect(page.locator('#diagnosticsCopyStatus')).toContainText('Copy the selected text');

  await page.getByLabel('Issue or suggestion').fill('The stream stopped playing.');
  await page.getByRole('button', { name: 'Send report', exact: true }).click();
  await expect(page.locator('#reportStatus')).toContainText('your report was sent');
  expect(reports[0]).not.toHaveProperty('diagnostics');
  await page.getByLabel('Include diagnostics with this report').check();
  await page.getByLabel('Issue or suggestion').fill('Attaching the saved playback fault.');
  await page.getByRole('button', { name: 'Send report', exact: true }).click();
  await expect.poll(() => reports.length).toBe(2);
  expect(reports[1].diagnostics).toEqual(diagnostics);
  await page.getByRole('button', { name: 'Clear saved data' }).click();
  await expect(page.locator('#diagnosticsSummary')).toContainText('No saved playback problem');
  await page.reload();
  await page.evaluate(() => showReport());
  await expect(page.locator('#diagnosticsSummary')).toContainText('No saved playback problem');
});

test('diagnostics preserve separate HTTP failures and the first fault through placeholder seeks and retries', async ({ page }) => {
  await page.route('**/__test__/failure*', route => route.fulfill({
    status: route.request().url().includes('first') ? 503 : 415,
    contentType: 'text/plain', body: 'secret-response-body'
  }));
  await page.clock.install();
  await page.reload();
  await page.evaluate(async () => {
    // Unrelated failed requests must not be attributed to the playing station.
    await fetch('/__test__/failure-unrelated');
    showReport();
  });
  await expect(page.locator('#diagnosticsSummary')).toContainText('No saved playback problem');
  await page.evaluate(async () => {
    playStream('/__test__/failure-first?secret=hidden', 'First station');
    await streamPlay(state.streamUrl, 'First station');
    await fetch(new Request(streamPlayer.url));
    window.firstStreamError = streamPlayer.options.onError;
    aud.pause();
    Object.defineProperty(aud, 'currentSrc', { configurable: true, value: 'data:audio/mpeg;base64,secret-audio' });
  });
  // The real library loops a short silent placeholder during startup. Its seeks
  // must neither flood the report nor postpone detection of stalled playback.
  for (let i = 0; i < 7; i++) {
    await page.evaluate(round => {
      for (let j = 0; j < 100; j++) {
        aud.currentTime = j % 2 ? 0.01 : 0.04;
        aud.dispatchEvent(new Event('seeking'));
        aud.dispatchEvent(new Event('seeked'));
      }
      // A different position in the 52ms loop is not actual stream progress.
      aud.currentTime = round % 2 ? 0 : 0.052;
    }, i);
    await page.clock.runFor(5000);
  }
  await page.evaluate(() => showReport());
  await expect(page.locator('#diagnosticsSummary')).toContainText('stalled playback');
  const stalled = JSON.parse(await page.locator('#diagnosticsText').inputValue());
  expect(stalled.incident.firstError.httpStatus).toBe(503);
  expect(stalled.incident.events.some(event => event.type === 'source-selected')).toBe(true);
  expect(stalled.recent.filter(event => event.type === 'seek').length).toBeLessThanOrEqual(7);
  expect(stalled.recent.some(event => event.type === 'seek' && event.count >= 200)).toBe(true);

  await page.evaluate(async () => {
    playStream('/__test__/failure-second?secret=hidden', 'Second station');
    await streamPlay(state.streamUrl, 'Second station');
    const response = await fetch(new URL(streamPlayer.url, location.href));
    if (response.status !== 415 || await response.text() !== 'secret-response-body') throw new Error('Fetch behavior changed');
    firstStreamError('network error: secret-message', new TypeError('secret-message'));
    showReport();
  });
  await expect(page.locator('#diagnosticsSummary')).toContainText('2 saved problems');
  const separate = JSON.parse(await page.locator('#diagnosticsText').inputValue());
  expect(separate.incidents.map(item => item.firstError.httpStatus)).toEqual([503, 415]);
  expect(separate.incidents[0].errors.some(error => error.category === 'network')).toBe(true);
  expect(separate.incident.httpStatus).toBe(415);
  expect(separate.actions.filter(action => action.type === 'source-selected').map(action => action.source.address))
    .toEqual(['http://127.0.0.1:4173/__test__/failure-first', 'http://127.0.0.1:4173/__test__/failure-second']);

  await page.evaluate(async () => {
    for (let i = 0; i < 9; i++) {
      const path = `/__test__/failure-${'long-path-'.repeat(40)}${i}?secret=hidden`;
      playStream(path, 'Retry station');
      await streamPlay(state.streamUrl, 'Retry station');
      await fetch(streamPlayer.url);
    }
    // Model the real stream finally replacing the looping startup placeholder.
    Object.defineProperty(aud, 'currentSrc', { configurable: true, value: 'blob:recovered-stream' });
    aud.dispatchEvent(new Event('playing'));
  });
  // A report prepared two minutes after recovery must not lose that transition
  // just because twenty subsequent five-second samples have been collected.
  await page.clock.runFor(125000);
  await page.evaluate(() => showReport());
  const recovered = JSON.parse(await page.locator('#diagnosticsText').inputValue());
  expect(recovered.recent.some(event => event.type === 'playing' && event.playback.media.address === 'blob:')).toBe(true);
  expect(recovered.recent.filter(event => event.type === 'sample').length).toBeGreaterThan(20);
  await page.reload();
  await page.evaluate(() => showReport());
  const text = await page.locator('#diagnosticsText').inputValue();
  const retained = JSON.parse(text);
  expect(retained.incidents.length).toBeLessThanOrEqual(6);
  expect(retained.startups.length).toBeLessThanOrEqual(6);
  expect(retained.startups[0].source.address).toBe('http://127.0.0.1:4173/__test__/failure-first');
  expect(retained.incidents[0].firstError).toEqual(stalled.incident.firstError);
  expect(retained.incident.firstError.httpStatus).toBe(415);
  expect(retained.recent.some(event => event.type === 'playing' && event.playback.media.address === 'blob:')).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(retained))).toBeLessThanOrEqual(131072);
  expect(text).not.toMatch(/secret-|secret=/);
});

test('startup diagnostics distinguish delayed headers from delayed decoding and survive reload', async ({ page }) => {
  let pendingResponse;
  await page.route('**/__test__/startup*', route => { pendingResponse = route; });
  // Playwright's virtual clock replaces the Resource Timing API with empty lists.
  await page.evaluate(() => showReport());
  const initial = JSON.parse(await page.locator('#diagnosticsText').inputValue());
  expect(initial.playerResources.some(item => item.path.endsWith('.main.min.js'))).toBe(true);
  await page.clock.install();
  await page.reload();
  await page.evaluate(() => {
    window.decoderGate = new Promise(resolve => { window.releaseDecoder = resolve; });
    IcecastMetadataPlayer.prototype.play = async function() {
      window.startupCallbacks = this.options;
      this.options.onLoad();
      const response = await fetch(this.url);
      this.options.onStreamStart();
      window.startupBody = await response.text();
      this.options.onStream(new TextEncoder().encode(startupBody));
      this.options.onBuffer(1.25);
      window.fixtureBuffered = true;
      await decoderGate;
      await this.audioElement.play();
      this.options.onPlay();
    };
    playStream('/__test__/startup?token=secret-url', 'Delayed station', true);
  });
  await expect.poll(() => Boolean(pendingResponse)).toBe(true);
  await page.clock.runFor(40000);
  await page.evaluate(() => showReport());
  const waiting = JSON.parse(await page.locator('#diagnosticsText').inputValue());
  expect(waiting.incident.reason).toBe('stalled-playback');
  expect(waiting.startups[0].milestones.map(item => item.phase)).toContain('fetch-start');
  expect(waiting.startups[0].milestones.map(item => item.phase)).not.toContain('fetch-headers');

  await pendingResponse.fulfill({
    status: 200, headers: { 'Content-Type': 'audio/mpeg; private=secret-header', 'Content-Length': '17' },
    body: 'secret-audio-body'
  });
  await expect.poll(() => page.evaluate(() => window.fixtureBuffered)).toBe(true);
  expect(await page.evaluate(() => startupBody)).toBe('secret-audio-body');
  const buffering = JSON.parse(await page.locator('#diagnosticsText').inputValue());
  const phases = buffering.startups[0].milestones;
  const headers = phases.find(item => item.phase === 'fetch-headers');
  expect(headers).toMatchObject({ httpStatus: 200, mediaType: 'audio/mpeg' });
  expect(headers.elapsedMs - phases.find(item => item.phase === 'fetch-start').elapsedMs).toBeGreaterThanOrEqual(40000);
  expect(phases.find(item => item.phase === 'fetch-first-byte').elapsedMs).toBeGreaterThanOrEqual(headers.elapsedMs);
  expect(phases.find(item => item.phase === 'buffering').bufferSeconds).toBe(1.25);
  expect(phases.map(item => item.phase)).not.toContain('playback-start');

  await page.clock.runFor(20000);
  await page.evaluate(() => releaseDecoder());
  await expect.poll(async () => JSON.parse(await page.locator('#diagnosticsText').inputValue())
    .startups[0].milestones.some(item => item.phase === 'playback-start')).toBe(true);
  await page.evaluate(() => {
    playStream('/__test__/mix.wav', 'Next station');
    startupCallbacks.onRetry(); // Late callback still belongs to the first attempt.
    showReport();
  });
  const completed = JSON.parse(await page.locator('#diagnosticsText').inputValue());
  const startup = completed.startups[0];
  expect(startup.milestones.find(item => item.phase === 'playback-start').elapsedMs - headers.elapsedMs).toBeGreaterThanOrEqual(20000);
  expect(startup.milestones.map(item => item.phase)).toContain('retry');
  expect(completed.startups[1].milestones).toEqual([]);
  await page.reload();
  await page.evaluate(() => showReport());
  const text = await page.locator('#diagnosticsText').inputValue();
  expect(JSON.parse(text).startups[0]).toEqual(startup);
  expect(text).not.toMatch(/secret-|"clock"/);
});

test('diagnostics retain a later reconnection handoff through samples, event floods and reload', async ({ page }) => {
  await page.clock.install();
  await page.reload();
  await page.waitForFunction(() => liveProbeReady);
  await page.evaluate(async () => {
    playStream('https://radio.example/live?token=secret-url', 'Reconnecting station', true);
    await Promise.resolve();
    window.originalPlayer = streamPlayer;
    streamPlayer.state = 'playing';
    streamPlayer.playbackMethod = 'mediasource';
    streamPlayer.options.onError('network error', new Error('secret-error'));
    streamPlayer.dispatchEvent(new Event('retry'));
    streamPlayer.dispatchEvent(new CustomEvent('warn', { detail: [
      'Synchronized old and new request.', 'secret-warning'
    ] }));
    streamPlayer.dispatchEvent(new Event('playing'));
  });
  // A second reconnection hours later must not be discarded as a duplicate
  // startup milestone, or retain only the first network error's old context.
  await page.clock.fastForward(5 * 3600000);
  await page.evaluate(() => {
    streamPlayer.state = 'retrying';
    streamPlayer.dispatchEvent(new Event('retry'));
    streamPlayer.dispatchEvent(new Event('streamstart'));
    streamPlayer.dispatchEvent(new CustomEvent('warn', { detail: [
      'Reconnected successfully after retrying.',
      'Synchronized old and new request with 98.76% confidence.', 'secret-warning'
    ] }));
    // The real library may emit this without calling the application's onError.
    streamPlayer.dispatchEvent(new CustomEvent('playbackerror', { detail: ['secret-error'] }));
    streamPlayer.dispatchEvent(new Event('stopping'));
    streamPlayer.state = 'stopping';
    aud.pause();
    Object.defineProperty(aud, 'currentSrc', { configurable: true, value: 'data:audio/mpeg;base64,secret-audio' });
    streamPlayer.dispatchEvent(new Event('stop'));
    streamPlayer.dispatchEvent(new Event('stopped'));
    streamPlayer.state = 'stopped';
  });
  await page.clock.runFor(40000);
  await page.evaluate(() => showReport());
  const stalled = JSON.parse(await page.locator('#diagnosticsText').inputValue());
  expect(stalled.incident.reason).toBe('stalled-playback');
  expect(stalled.incident.firstError.reason).toBe('stream-error');
  expect(stalled.current).toMatchObject({ libraryState: 'stopped', playbackMethod: 'mediasource', userPaused: false });
  expect(stalled.transitions.filter(item => item.type === 'library:retry')).toHaveLength(2);
  expect(stalled.incident.recovery.find(item => item.sync === 'pcm')).toMatchObject({ confidence: 98.76 });
  expect(stalled.incident.recovery.map(item => item.type)).toEqual(expect.arrayContaining([
    'library:playbackerror', 'library:stopping', 'media:pause', 'library:stop', 'library:stopped'
  ]));
  const retries = stalled.transitions.filter(item => item.type === 'library:retry');
  expect(Date.parse(retries[1].at) - Date.parse(retries[0].at)).toBeGreaterThanOrEqual(5 * 3600000);
  expect(await page.evaluate(() => streamPlayer === originalPlayer && streamPlayer.state === 'stopped')).toBe(true);

  await page.clock.runFor(8 * 60000);
  await page.evaluate(async () => {
    for (let i = 0; i < 80; i++) originalPlayer.dispatchEvent(new CustomEvent('warn', { detail: ['secret-warning'] }));
    playStream('/__test__/stream.wav', 'Next station', true);
    await Promise.resolve();
    originalPlayer.dispatchEvent(new Event('retrytimeout')); // Late event belongs to the old player/attempt.
    showReport();
  });
  const later = JSON.parse(await page.locator('#diagnosticsText').inputValue());
  expect(later.incidents[0].recovery).toEqual(stalled.incident.recovery);
  expect(later.transitions.length).toBeLessThanOrEqual(48);
  const late = later.transitions.find(item => item.type === 'library:retrytimeout');
  expect(late.attempt).toBe(stalled.attempt);
  expect(late.playerId).toBe(retries[0].playerId);
  expect(later.attempt).toBeGreaterThan(late.attempt);
  await page.reload();
  await page.evaluate(() => showReport());
  const text = await page.locator('#diagnosticsText').inputValue();
  const restored = JSON.parse(text);
  expect(restored.incidents[0].recovery).toEqual(stalled.incident.recovery);
  expect(restored.transitions.some(item => item.type === 'library:retrytimeout')).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(restored))).toBeLessThanOrEqual(131072);
  expect(text).not.toMatch(/secret-/);
});

test('persistent playback diagnostics respect pause, opt-in and the automatic report cooldown', async ({ page }) => {
  const reports = [];
  await page.route('**/report.php', route => {
    reports.push(route.request().postDataJSON());
    // Failed uploads must also be throttled, without deleting the evidence.
    return route.fulfill({ status: 503 });
  });
  await page.clock.install();
  await page.reload();
  await page.evaluate(() => playStream('/__test__/stream.wav', 'Test stream', true));
  await page.click('#playPauseBtn');
  await page.clock.runFor(40000);
  await page.evaluate(() => showReport());
  await expect(page.locator('#diagnosticsSummary')).toContainText('No saved playback problem');
  await page.evaluate(() => hideReport());
  await page.click('#playPauseBtn');
  // Model an unexpected stop while the user still intends to listen.
  await page.evaluate(() => aud.pause());
  await page.clock.runFor(25000);
  await page.evaluate(() => showReport());
  await expect(page.locator('#diagnosticsSummary')).toContainText('No saved playback problem');
  await page.clock.runFor(10000);
  await expect(page.locator('#diagnosticsSummary')).toContainText('stalled playback');
  expect(reports).toHaveLength(0);
  await page.getByLabel('Automatically send persistent playback problems').check();
  await page.clock.runFor(5000);
  await expect.poll(() => reports.length).toBe(1);
  expect(reports[0].automatic).toBe(true);
  expect(reports[0].diagnostics.incident.reason).toBe('stalled-playback');
  await expect(page.locator('#diagnosticsAutoStatus')).toContainText('did not send');
  await page.clock.runFor(65000);
  expect(reports).toHaveLength(1);
  await page.getByLabel('Automatically send persistent playback problems').uncheck();
  await page.clock.fastForward(3600000);
  await page.clock.runFor(40000);
  expect(reports).toHaveLength(1);
  await expect(page.locator('#diagnosticsSummary')).toContainText('stalled playback');
});

test('silent-audio diagnostics are bounded, preserve the original fault and expire', async ({ page }) => {
  await page.clock.install();
  await page.reload();
  // Let initial restoration finish before selecting the test stream.
  await page.waitForFunction(() => liveProbeReady);
  await page.evaluate(() => {
    playStream('/__test__/stream.wav', 'Silent stream', true);
    // Only the diagnostic level probe is controlled; the media clock advances.
    window.testInputLevel = 0.02;
    analyserNode.getFloatTimeDomainData = samples => samples.fill(testInputLevel);
  });
  await page.clock.runFor(40000);
  await page.evaluate(() => showReport());
  await expect(page.locator('#diagnosticsSummary')).toContainText('No saved playback problem');
  await page.evaluate(() => { testInputLevel = 0; volume.mute(); });
  await page.clock.runFor(40000);
  await page.evaluate(() => showReport());
  await expect(page.locator('#diagnosticsSummary')).toContainText('No saved playback problem');
  await page.evaluate(() => volume.unmute());
  await page.clock.runFor(45000);
  await page.evaluate(() => {
    showReport();
    streamPlayer.options.onError('network error', new TypeError('fetch failed'));
  });
  await expect(page.locator('#diagnosticsSummary')).toContainText('silent audio');
  const initial = JSON.parse(await page.locator('#diagnosticsText').inputValue());
  expect(initial.incident.playback.currentTime).toBeGreaterThan(20);
  expect(initial.incident.playback.inputRms).toBe(0);
  // Plenty of subsequent events must not displace the saved fault or grow it without bound.
  await page.evaluate(() => {
    for (let i = 0; i < 100; i++) {
      playStream(`https://radio.example/${'long-path-'.repeat(50)}${i}?secret=hidden`, 'Station');
    }
    showReport();
  });
  const later = JSON.parse(await page.locator('#diagnosticsText').inputValue());
  expect(later.incident.at).toBe(initial.incident.at);
  expect(Buffer.byteLength(JSON.stringify(later))).toBeLessThanOrEqual(131072);
  expect(JSON.stringify(later)).not.toContain('secret=hidden');
  await page.clock.fastForward(24 * 3600000);
  await page.reload();
  await page.evaluate(() => showReport());
  await expect(page.locator('#diagnosticsSummary')).toContainText('No saved playback problem');
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

test('search estimulo mix playback falls back to remote mixes source', async ({ page }) => {
  const headAttempts = [];

  await page.route('**/mixes/mixes-config.json', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        mixesBaseUrls: [
          '/mixes/',
          'https://stream-proxy.round-bar-e93e.workers.dev/?url=https://mixes.4st.uk/mixes/',
          'https://m.4st.uk/'
        ]
      })
    });
  });

  await page.route('**/mixes/search-index.json', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify([
        {
          dj: 'moreDJs/estimulo',
          file: '2011-10-20-estimulo',
          name: '20 October 2011 estimulo',
          artist: 'estimulo',
          genre: 'Drum & Bass',
          comment: '',
          duration: '60:00',
          audioFile: '2011-10-20-estimulo.mp3'
        },
        {
          dj: 'moreDJs/estimulo',
          file: '2011-10-13-estimulo',
          name: '13 October 2011 estimulo',
          artist: 'estimulo',
          genre: 'Drum & Bass',
          comment: '',
          duration: '60:00',
          audioFile: '2011-10-13-estimulo.mp3'
        },
        {
          dj: 'moreDJs/estimulo',
          file: '2011-10-06-estimulo',
          name: '6 October 2011 estimulo',
          artist: 'estimulo',
          genre: 'Drum & Bass',
          comment: '',
          duration: '60:00',
          audioFile: '2011-10-06-estimulo.mp3'
        }
      ])
    });
  });

  await page.route('**/streams/search-index.json', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: '[]'
    });
  });

  await page.route('**/mixes/moreDJs/estimulo/*.mp3', route => {
    if (route.request().method() === 'HEAD') {
      headAttempts.push(route.request().url());
      route.fulfill({ status: 404 });
      return;
    }
    route.continue();
  });

  await page.route('https://stream-proxy.round-bar-e93e.workers.dev/**', route => {
    if (route.request().method() === 'HEAD') {
      headAttempts.push(route.request().url());
      route.fulfill({ status: 404 });
      return;
    }
    route.continue();
  });

  await page.route('https://m.4st.uk/**', route => {
    if (route.request().method() === 'HEAD') {
      headAttempts.push(route.request().url());
      route.fulfill({ status: 200 });
      return;
    }
    route.continue();
  });

  await page.evaluate(async () => {
    await loadMixesConfig();
  });

  await page.click('.mode-btn[data-mode="search"]');
  await page.fill('#searchInput', '20 October 2011 estimulo');

  await expect(page.locator('#searchInfo')).toContainText('3 results');

  const targetRow = page.locator('#mixList .mix-item').filter({ hasText: '20 October 2011 estimulo' }).first();
  await expect(targetRow).toBeVisible();
  await targetRow.locator('[data-action="search-play-now"]').click();

  await page.waitForFunction(() => state.currentMix?.name === '20 October 2011 estimulo' && !!aud.src);

  const playbackState = await page.evaluate(() => ({
    currentMixName: state.currentMix?.name,
    audioSrc: aud.src
  }));

  expect(playbackState.currentMixName).toBe('20 October 2011 estimulo');
  expect(playbackState.audioSrc).toContain('https://m.4st.uk/moreDJs/estimulo/2011-10-20-estimulo.mp3');
  expect(playbackState.audioSrc).not.toContain('/mixes/moreDJs/estimulo/2011-10-20-estimulo.mp3');
  expect(playbackState.audioSrc).not.toContain('stream-proxy.round-bar-e93e.workers.dev');

  expect(headAttempts.length).toBeGreaterThanOrEqual(3);
  expect(headAttempts[0]).toContain('/mixes/moreDJs/estimulo/2011-10-20-estimulo.mp3');
  expect(headAttempts[1]).toContain('stream-proxy.round-bar-e93e.workers.dev');
  expect(headAttempts[2]).toContain('https://m.4st.uk/moreDJs/estimulo/2011-10-20-estimulo.mp3');
});
