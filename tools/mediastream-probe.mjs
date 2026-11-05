// Standalone synthetic-audio diagnostic; no app scripts, server or real streams.
// Usage: node tools/mediastream-probe.mjs [output.json]
// PROBE_BROWSER selects one project for local investigation. CI runs all four.
// Natural attenuation is recorded, not made into a passing assertion: the
// existing application tests remain the verification gate. Harness errors and
// incorrect deliberate-loss controls fail this command. Partial results survive.
import { chromium, firefox, webkit, devices } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

const output = process.argv[2] || 'test-results/mediastream-probe.json';
const report = { startedAt: new Date().toISOString(), complete: false, browsers: {}, cases: [] };
const modes = ['direct', 'same-context', 'cross-context', 'cross-audio', 'cross-element', 'cross-initial', 'cross-pending'];
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : null);
const firefoxPath = process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE;
const engines = [
  ['chromium', chromium, chromiumPath ? { executablePath: chromiumPath } : {}, {}],
  ['firefox', firefox, firefoxPath ? { executablePath: firefoxPath } : {}, {}],
  ['webkit', webkit, {}, {}],
  ['webkit-iphone-13', webkit, {}, devices['iPhone 13']]
];
if (process.env.PROBE_BROWSER && !engines.some(([name]) => name === process.env.PROBE_BROWSER)) {
  throw new Error('Unknown PROBE_BROWSER project');
}
await mkdir(dirname(output), { recursive: true });

async function runCase({ mode, attenuation }) {
  const decoder = new AudioContext();
  const receiver = mode === 'direct' || mode === 'same-context' ? decoder : new AudioContext();
  const received = receiver.createAnalyser();
  received.connect(receiver.destination);
  const generated = decoder.createAnalyser();
  const audio = mode.startsWith('cross-') && mode !== 'cross-context' ? new Audio() : null;
  let elementSource;
  let streamSource;
  let initialPlayResult;
  let objectUrl;
  try {
    await Promise.all([decoder.resume(), receiver.resume()]);
    if (audio && mode !== 'cross-audio') {
      elementSource = receiver.createMediaElementSource(audio);
      elementSource.connect(received);
      const update = () => {
        if (!audio.srcObject || !streamSource) return;
        elementSource.disconnect();
        streamSource.disconnect();
        if (!audio.paused) streamSource.connect(received);
        audio.muted = true;
      };
      for (const event of ['loadstart', 'loadedmetadata', 'play', 'pause', 'emptied']) {
        audio.addEventListener(event, update);
      }
    }
    if (mode === 'cross-initial' || mode === 'cross-pending') {
      const wav = new ArrayBuffer(44 + 44100 * 8 * 2);
      const view = new DataView(wav);
      const text = (offset, value) => [...value].forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)));
      text(0, 'RIFF'); view.setUint32(4, wav.byteLength - 8, true); text(8, 'WAVE');
      text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, 1, true); view.setUint32(24, 44100, true);
      view.setUint32(28, 88200, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      text(36, 'data'); view.setUint32(40, wav.byteLength - 44, true);
      for (let i = 0; i < 44100 * 8; i++) {
        view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 330 * i / 44100) * 0.35 * 32767), true);
      }
      objectUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      audio.src = objectUrl;
      const initialPlay = audio.play().then(() => { initialPlayResult = 'resolved'; }, error => { initialPlayResult = error.name; });
      if (mode === 'cross-initial') await initialPlay;
    }
    const source = decoder.createOscillator();
    source.frequency.value = 440;
    const level = decoder.createGain();
    level.gain.value = 0.04;
    source.connect(level);
    level.connect(generated);
    source.start();
    if (mode === 'direct') {
      level.connect(received);
    } else {
      const destination = decoder.createMediaStreamDestination();
      const loss = decoder.createGain();
      loss.gain.value = attenuation;
      level.connect(loss).connect(destination);
      streamSource = receiver.createMediaStreamSource(destination.stream);
      if (!elementSource) streamSource.connect(received);
      if (audio) {
        if (!elementSource) audio.muted = true;
        audio.srcObject = destination.stream;
        await audio.play();
      }
    }
    const signal = probe => {
      const values = new Float32Array(probe.fftSize);
      probe.getFloatTimeDomainData(values);
      return {
        rms: Math.sqrt(values.reduce((sum, x) => sum + x * x, 0) / values.length),
        peak: values.reduce((peak, x) => Math.max(peak, Math.abs(x)), 0),
        zeroSamples: values.filter(x => x === 0).length,
        sampleCount: values.length
      };
    };
    const started = performance.now();
    const samples = [];
    for (const target of [250, 500, 1000, 2000]) {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, target - (performance.now() - started))));
      samples.push({
        ms: performance.now() - started,
        generated: signal(generated), received: signal(received),
        decoder: { state: decoder.state, rate: decoder.sampleRate, time: decoder.currentTime },
        receiver: { state: receiver.state, rate: receiver.sampleRate, time: receiver.currentTime },
        audio: audio ? { paused: audio.paused, muted: audio.muted, volume: audio.volume, time: audio.currentTime } : null
      });
    }
    return { samples, initialPlayResult };
  } finally {
    if (audio) { audio.pause(); audio.srcObject = null; audio.removeAttribute('src'); audio.load(); }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (receiver !== decoder) await receiver.close();
    await decoder.close();
  }
}

try {
  for (const [name, engine, launch, device] of engines) {
    if (process.env.PROBE_BROWSER && name !== process.env.PROBE_BROWSER) continue;
    const browser = await engine.launch({ headless: true, ...launch });
    report.browsers[name] = browser.version();
    try {
      const cases = Array.from({ length: 3 }, (_, repeat) => modes.map(mode => ({ repeat, mode, attenuation: 1 }))).flat();
      cases.push({ repeat: 0, mode: 'cross-context', attenuation: 0.5 });
      for (const specification of cases) {
        const row = { browser: name, ...specification };
        const context = await browser.newContext(device);
        try {
          const requests = [];
          await context.route('**/*', route => {
            if (route.request().url().startsWith('blob:')) return route.continue();
            requests.push(route.request().url());
            return route.abort();
          });
          const page = await context.newPage();
          await page.setContent('<button id="start">Start synthetic probe</button>');
          await page.evaluate(({ code, specification }) => {
            document.querySelector('#start').addEventListener('click', () => {
              window.result = new Function(`return (${code})`)()(specification);
            }, { once: true });
          }, { code: runCase.toString(), specification });
          await page.click('#start');
          Object.assign(row, await page.evaluate(() => Promise.race([
            window.result,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Probe exceeded 10 seconds')), 10000))
          ])), { networkRequests: requests.length });
          if (requests.length) throw new Error('Unexpected network request');
          if (specification.mode === 'cross-initial' && row.initialPlayResult !== 'resolved') {
            throw new Error('Initial synthetic WAV did not play: ' + row.initialPlayResult);
          }
          row.expectedRms = 0.04 / Math.sqrt(2) * specification.attenuation;
          row.finalWithinTolerance = Math.abs(row.samples.at(-1).received.rms - row.expectedRms) < 0.0005;
          if (specification.attenuation === 0.5 && !row.finalWithinTolerance) {
            throw new Error('Deliberate half-gain control did not match expected RMS');
          }
        } catch (error) {
          row.error = String(error);
          process.exitCode = 1;
        } finally {
          await context.close();
          report.cases.push(row);
          await writeFile(output, JSON.stringify(report, null, 2));
          console.log(JSON.stringify(row));
        }
      }
    } finally {
      await browser.close();
    }
  }
  report.complete = true;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2));
}
