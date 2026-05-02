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
  await page.goto('/player.html');
  await expect(page.locator('#playPauseBtn')).toBeVisible();
});

test('mix playback with real media increases current time', async ({ page }) => {
  await page.evaluate(async () => {
    await playMix({
      name: 'Real Media Mix',
      isLocal: true,
      audioSrc: '/__test__/mix.wav'
    });
  });

  await page.waitForFunction(() => aud.currentTime > 0.1, null, { timeout: 10_000 });
  const start = await page.evaluate(() => aud.currentTime);
  await page.waitForTimeout(1500);
  const end = await page.evaluate(() => aud.currentTime);

  expect(end).toBeGreaterThan(start + 0.3);
  await expect(page.locator('#timeDisplay')).toContainText('/');
  await expect(page.locator('#playPauseBtn')).toHaveClass(/playing/);
});

test('stream playback with real media shows live state and advances', async ({ page }) => {
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
