import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const stateFile = resolve(process.env.XDG_STATE_HOME || `${homedir()}/.local/state`, 'stream-health/state.json');
const dayMs = 86400000;
const origin = 'https://m.4st.uk';
const proxies = [
  'https://stream-proxy-candidate.round-bar-e93e.workers.dev/',
  'https://h.proxy.4st.uk/',
  'https://d.proxy.4st.uk/'
];
const dailyStation = /sleepbot|deepvibes|jungletrain|monkey\s*radio/i;
const sleep = ms => new Promise(done => setTimeout(done, ms));
const day = date => Math.floor(date.getTime() / dayMs);

export function excluded(url, name = '') {
  if (dailyStation.test(name)) return true;
  const parsed = new URL(url);
  return /(^|\.)(sleepbot\.com|jungletrain\.net)$/.test(parsed.hostname)
    || parsed.hostname === '88.208.218.19'
    || (['178.128.128.44', '107.181.231.154'].includes(parsed.hostname) && parsed.pathname === '/seb')
    || (parsed.hostname === 'streaming.live365.com' && parsed.pathname === '/a52904');
}

export async function inventory(directory) {
  const stations = new Map();
  const skipped = new Set();
  for (const file of (await readdir(directory)).filter(f => f.endsWith('.streams')).sort()) {
    const preset = JSON.parse(await readFile(resolve(directory, file), 'utf8'));
    if (!Array.isArray(preset.streams)) throw new Error(`Invalid preset: ${file}`);
    for (const stream of preset.streams) {
      const url = stream.m3u;
      if (!/^https?:$/.test(new URL(url).protocol)) throw new Error(`Invalid stream URL in ${file}`);
      if (excluded(url, stream.name)) skipped.add(url);
      if (!stations.has(url)) stations.set(url, { url, entries: [] });
      stations.get(url).entries.push({ file, name: stream.name });
    }
  }
  for (const url of skipped) stations.delete(url);
  if (!stations.size) throw new Error('No eligible streams found');
  return { stations: [...stations.values()], excluded: skipped.size };
}

export async function loadState(file) {
  try {
    const state = JSON.parse(await readFile(file, 'utf8'));
    if (state.version !== 1 || !state.streams) throw new Error('Unrecognised stream-health state');
    return state;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { version: 1, streams: {} };
  }
}

export function seed(state, stations, firstDay) {
  const present = new Set(stations.map(station => station.url));
  for (const url of Object.keys(state.streams)) if (!present.has(url)) delete state.streams[url];
  for (const { url } of stations) {
    state.streams[url] ??= {
      due: firstDay + createHash('sha256').update(url).digest().readUInt32BE(0) % 7,
      failures: 0,
      reported: false
    };
  }
}

async function saveState(file, state) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file + '.tmp', JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  await rename(file + '.tmp', file);
}

export async function openDecoder() {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
  try {
    const page = await browser.newPage();
    // Samples are decoded as blobs. The browser must never fetch a stream URL.
    await page.route('**/*', route => route.abort());
    return {
      close: () => browser.close(),
      decode: (bytes, mime) => page.evaluate(({ bytes, mime }) => new Promise(resolve => {
        const audio = new Audio();
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime.split(';')[0] }));
        const finish = working => {
          clearTimeout(timer);
          audio.oncanplay = audio.onerror = null;
          audio.removeAttribute('src');
          audio.load();
          URL.revokeObjectURL(url);
          resolve(working);
        };
        const timer = setTimeout(() => finish(false), 5000);
        audio.oncanplay = () => finish(true);
        audio.onerror = () => finish(false);
        audio.preload = 'auto';
        audio.src = url;
      }), { bytes: [...bytes], mime })
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export async function probeStream(url, proxy, decode, { request = fetch, pause = sleep } = {}) {
  const deadline = AbortSignal.timeout(45000);
  const visited = new Set();
  async function visit(target, depth) {
    if (excluded(target)) return { status: 'skipped', reason: 'Daily-use endpoint excluded' };
    if (!/^https?:$/.test(new URL(target).protocol)) return { status: 'failed', reason: 'Non-HTTP playlist entry' };
    if (visited.has(target) || depth > 3) return { status: 'failed', reason: 'Playlist loop/depth limit' };
    visited.add(target);
    await pause(2000);
    deadline.throwIfAborted();
    const controller = new AbortController();
    const signal = AbortSignal.any([deadline, AbortSignal.timeout(15000), controller.signal]);
    const endpoint = new URL(proxy);
    endpoint.searchParams.set('url', target);
    endpoint.searchParams.set('icy', '0');
    let bytes, mime;
    try {
      const response = await request(endpoint, { headers: { Origin: origin }, signal, redirect: 'error' });
      if (!response.ok) return { status: 'failed', reason: `HTTP ${response.status}`, url: target };
      mime = response.headers.get('content-type') || '';
      if (!response.body) return { status: 'failed', reason: 'Empty response', url: target };
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      let sampleComplete = false;
      const sampleTimer = setTimeout(() => {
        sampleComplete = true;
        controller.abort();
      }, 5000);
      try {
        while (size < 192 * 1024) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const part = chunk.value.subarray(0, 192 * 1024 - size);
          chunks.push(part);
          size += part.length;
        }
      } catch (error) {
        // A low-bitrate stream need not fill the byte limit to be decodable.
        if (!sampleComplete || !size) throw error;
      } finally {
        clearTimeout(sampleTimer);
      }
      bytes = Buffer.concat(chunks, size);
    } finally {
      // Close the relay before decoding or trying another playlist alternative.
      controller.abort();
    }
    const text = bytes.toString('utf8').replace(/^\uFEFF/, '').trim();
    const pls = /^\[playlist\]/i.test(text);
    const m3u = /^#EXTM3U/i.test(text) || /mpegurl/i.test(mime) || /\.m3u8?(?:[?#]|$)/i.test(target);
    if (pls || m3u || /scpls/i.test(mime) || /\.pls(?:[?#]|$)/i.test(target)) {
      if (/#EXT-X-/i.test(text)) return { status: 'failed', reason: 'HLS playlist not supported by sample checker', url: target };
      const entries = pls
        ? [...text.matchAll(/^File\d+\s*=\s*(.+)$/gmi)].map(match => match[1].trim())
        : text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
      if (!entries.length) return { status: 'failed', reason: 'Empty playlist', url: target };
      const failures = [];
      let skipped = false;
      for (const entry of [...new Set(entries)].slice(0, 3)) {
        try {
          const result = await visit(new URL(entry, target).href, depth + 1);
          if (result.status === 'working') return result;
          if (result.status === 'skipped') skipped = true;
          failures.push(result.reason);
        } catch (error) {
          if (error.scannerFailure) throw error;
          failures.push(error.message);
        }
      }
      return { status: skipped ? 'skipped' : 'failed', reason: failures.join('; ').slice(0, 500), url: target };
    }
    if (!bytes.length) return { status: 'failed', reason: 'Empty audio sample', url: target };
    let working;
    try { working = await decode(bytes, mime); }
    catch (error) { error.scannerFailure = true; throw error; }
    return { status: working ? 'working' : 'failed', reason: working ? 'Sample decoded (canplay)' : 'Sample did not decode', url: target, mime, sampleBytes: bytes.length };
  }
  try { return await visit(url, 0); }
  catch (error) {
    if (error.scannerFailure) throw error;
    return { status: 'failed', reason: error.message.slice(0, 500), url };
  }
}

export async function mail(subject, body) {
  await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/mail', ['-S', 'sendwait', '-s', subject, 'st'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.on('error', () => {});
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`mail exited ${code}: ${stderr}`)));
    child.stdin.end(body);
  }).catch(error => { error.mailError = true; throw error; });
}

export async function scan({ stations, file = stateFile, now = new Date(), probe, sendMail = mail }) {
  const today = day(now);
  const state = await loadState(file);
  seed(state, stations, today);
  if (state.lastRunDay === today) return { checked: 0, reason: 'Already scanned today' };
  const due = stations.filter(station => state.streams[station.url].due <= today)
    .sort((a, b) => state.streams[a.url].due - state.streams[b.url].due || a.url.localeCompare(b.url)).slice(0, 30);
  const alerts = [];
  for (const station of due) {
    const previous = state.streams[station.url];
    const paths = [];
    for (const proxy of proxies) {
      const result = await probe(station.url, proxy);
      paths.push({ proxy, ...result });
      if (result.status === 'working' || result.status === 'skipped') break;
    }
    const working = paths.some(path => path.status === 'working');
    const skipped = paths.some(path => path.status === 'skipped');
    previous.lastCheck = now.toISOString();
    previous.paths = paths;
    previous.due = today + (working || skipped ? 7 : 1);
    if (working || skipped) {
      previous.failures = 0;
      previous.reported = false;
      delete previous.firstFailure;
    } else {
      previous.failures++;
      previous.firstFailure ??= now.toISOString();
      if (previous.failures >= 2 && !previous.reported) alerts.push(station);
    }
    // Preserve progress if the job is interrupted during a later station.
    await saveState(file, state);
  }
  state.lastRunDay = today;
  await saveState(file, state);
  if (alerts.length) {
    const report = ['Streams requiring examination', '',
      'These URLs failed short sample checks on at least two separate scan nights through every tested proxy.',
      'This is not proof that a station has closed. No presets have been changed.', '',
      ...alerts.flatMap(station => {
        const record = state.streams[station.url];
        return [station.entries.map(entry => `${entry.name} (${entry.file})`).join(', '), station.url,
          `First failure: ${record.firstFailure}; checks failed: ${record.failures}`,
          ...record.paths.map(path => `  ${path.proxy}: ${path.reason}`), ''];
      }), 'Healthy streams are checked roughly weekly; failures are retried nightly.',
      'Unchanged failures are reported once per episode. Details: ' + file, ''].join('\n');
    await sendMail(`[Stream health] ${alerts.length} stream${alerts.length === 1 ? '' : 's'} need examination`, report);
    for (const { url } of alerts) state.streams[url].reported = true;
    await saveState(file, state);
  }
  return { checked: due.length, reported: alerts.length, eligible: stations.length };
}

async function main() {
  const { stations, excluded: skipped } = await inventory(resolve(root, 'streams'));
  const state = await loadState(stateFile);
  if (process.argv.includes('--init')) {
    seed(state, stations, day(new Date()) + 1);
    await saveState(stateFile, state);
    console.log(`Initialised ${stations.length} URLs, staggered over the next seven nights; ${skipped} daily-use URLs excluded. No probes or email.`);
    return;
  }
  if (process.argv.includes('--plan')) {
    seed(state, stations, day(new Date()) + 1);
    const days = {};
    for (const record of Object.values(state.streams)) {
      const date = new Date(record.due * dayMs).toISOString().slice(0, 10);
      days[date] = (days[date] || 0) + 1;
    }
    console.log(JSON.stringify({ eligible: stations.length, excluded: skipped, due: days, proxies, stateFile }, null, 2));
    return;
  }
  const hour = new Date().getHours();
  if (hour < 3 || hour >= 7) {
    console.log('Outside 03:00–07:00: no probes, catch-up or email.');
    return;
  }
  const decoder = await openDecoder();
  try {
    const result = await scan({ stations, probe: (url, proxy) => probeStream(url, proxy, decoder.decode) });
    console.log(JSON.stringify(result));
  } finally { await decoder.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async error => {
    console.error(error);
    if (!error.mailError && !process.argv.includes('--plan') && !process.argv.includes('--init')) {
      try { await mail('[Stream health] Scanner needs attention', `The stream-health scan failed:\n\n${error.stack}\n`); }
      catch (mailError) { console.error(mailError); }
    }
    process.exitCode = 1;
  });
}
