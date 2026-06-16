import { expect, test } from '@playwright/test';

// Verifies the stale-proxy detection and repair helpers in livedata.js.
// Background: the Player current-stream and Play History persist fully-proxied
// URLs (https://<proxy-host>/?url=<endpoint>) to localStorage. When a proxy is
// removed from proxy-config.json those URLs reference a dead host and fail
// silently on restore. isProxyCurrent() detects that; refreshProxiedUrl()
// re-derives a working URL by re-probing the inner endpoint across the current
// proxies.

const PROXY_CONFIG = [
  { url: 'https://good-proxy.example', streams: 'all', note: 'test' }
];

const ENDPOINT = 'https://stream.example.com/live';
// Matches getProxyUrls() output: `${proxy}?url=<encoded>` (proxy URL has no path).
const wrap = (proxyUrl, endpoint) => `${proxyUrl}?url=${encodeURIComponent(endpoint)}`;

test.beforeEach(async ({ page }) => {
  // Serve a deterministic proxy config containing a single known proxy host.
  await page.route('**/streams/proxy-config.json', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(PROXY_CONFIG)
    });
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('streamsEverInitialized', 'true');
  });
  await page.goto('/player.html');
  await expect(page.locator('#playPauseBtn')).toBeVisible();
  // Ensure proxy config is loaded before exercising the helpers.
  await page.evaluate(() => loadProxyConfig());
});

test('unwrapProxiedUrl extracts the inner endpoint', async ({ page }) => {
  const result = await page.evaluate(
    ({ host, endpoint }) => unwrapProxiedUrl(`https://${host}/?url=${encodeURIComponent(endpoint)}`),
    { host: 'good-proxy.example', endpoint: ENDPOINT }
  );
  expect(result).toBe(ENDPOINT);
});

test('isProxyCurrent flags removed proxies but spares valid and non-wrapped URLs', async ({ page }) => {
  const results = await page.evaluate(({ good, dead, endpoint }) => ({
    configured: isProxyCurrent(`https://${good}/?url=${encodeURIComponent(endpoint)}`),
    removed: isProxyCurrent(`https://${dead}/?url=${encodeURIComponent(endpoint)}`),
    direct: isProxyCurrent(endpoint)
  }), { good: 'good-proxy.example', dead: 'deleted-proxy.example', endpoint: ENDPOINT });

  expect(results.configured).toBe(true);  // proxy still in config → leave it
  expect(results.removed).toBe(false);    // proxy gone → needs repair
  expect(results.direct).toBe(true);      // not a proxy wrapper → leave it
});

test('refreshProxiedUrl re-wraps the endpoint with a current proxy', async ({ page }) => {
  const fresh = await page.evaluate(async ({ dead, endpoint }) => {
    // Stub probeStream so the first candidate "succeeds" without real network.
    window.probeStream = async () => true;
    return refreshProxiedUrl(`https://${dead}/?url=${encodeURIComponent(endpoint)}`);
  }, { dead: 'deleted-proxy.example', endpoint: ENDPOINT });

  expect(fresh).toBe(wrap('https://good-proxy.example', ENDPOINT));
});

test('refreshProxiedUrl returns null when no proxy can reach the endpoint', async ({ page }) => {
  const fresh = await page.evaluate(async ({ dead, endpoint }) => {
    window.probeStream = async () => false;
    return refreshProxiedUrl(`https://${dead}/?url=${encodeURIComponent(endpoint)}`);
  }, { dead: 'deleted-proxy.example', endpoint: ENDPOINT });

  expect(fresh).toBeNull();
});

// Probing is async; if the user switched the right column to the Tracks/Art tab
// while a probe ran, the repaired URL must still be persisted but the (hidden)
// Recent pane must NOT be redisplayed — that would corrupt the layout.
test('refreshStaleProxies persists repair but skips redisplay when guard is false', async ({ page }) => {
  const result = await page.evaluate(async ({ dead, good, endpoint }) => {
    window.probeStream = async () => true;
    playHistory._entries = [{
      type: 'stream',
      streamUrl: `https://${dead}/?url=${encodeURIComponent(endpoint)}`,
      streamM3u: null,
      streamDisplayText: 'Stale Stream',
      position: null,
      timestamp: Date.now()
    }];
    playHistory._save();

    let displayCalls = 0;
    const realDisplay = playHistory.display.bind(playHistory);
    playHistory.display = () => { displayCalls++; };

    await playHistory.refreshStaleProxies({ shouldRedisplayAfterProbe: () => false });
    playHistory.display = realDisplay;

    return {
      displayCalls,
      memUrl: playHistory._entries[0].streamUrl,
      savedUrl: JSON.parse(localStorage.getItem('playHistory'))[0].streamUrl,
      expected: `https://${good}?url=${encodeURIComponent(endpoint)}`
    };
  }, { dead: 'deleted-proxy.example', good: 'good-proxy.example', endpoint: ENDPOINT });

  expect(result.displayCalls).toBe(0);           // hidden pane not redisplayed
  expect(result.memUrl).toBe(result.expected);   // in-memory entry repaired
  expect(result.savedUrl).toBe(result.expected); // persisted to localStorage
});

test('refreshStaleProxies redisplays when guard is true', async ({ page }) => {
  const displayCalls = await page.evaluate(async ({ dead, endpoint }) => {
    window.probeStream = async () => true;
    playHistory._entries = [{
      type: 'stream',
      streamUrl: `https://${dead}/?url=${encodeURIComponent(endpoint)}`,
      streamM3u: null,
      streamDisplayText: 'Stale Stream',
      position: null,
      timestamp: Date.now()
    }];
    playHistory._save();

    let calls = 0;
    playHistory.display = () => { calls++; };
    await playHistory.refreshStaleProxies({ shouldRedisplayAfterProbe: () => true });
    return calls;
  }, { dead: 'deleted-proxy.example', endpoint: ENDPOINT });

  expect(displayCalls).toBeGreaterThan(0);
});
