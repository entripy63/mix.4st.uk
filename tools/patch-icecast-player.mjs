#!/usr/bin/env node
// Reproducible local modification of the checked-in 1.17.13 bundle.
// See docs/STREAM-RECOVERY.md. No downloads, build dependencies or deployment.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const upstreamHash = '56eebcf6564576a8fe312f0efbfcf08280d848131f615f5248e073dc021246dc';
const recoveryHash = '65e0f9685d3c5553be105ac06eda8c6d3197a06246a3c1a0442bffbf9f11f908';
const patchedHash = '88ee30a7b00056761ad6abcb90d50f90283dd2c4a95284c99efcedcf23bef352';
const hash = source => createHash('sha256').update(source).digest('hex');

function patchTiming(source) {
  const before = 'async t=>this.Gi(B(t.map(t=>t.data)))';
  assert.equal(source.split(before).length, 2, 'Raw append patch must match exactly once');
  // Ni's s = codec; Ii = MediaSource; Yi = waitForSourceBuffer;
  // Gi = appendSourceBuffer; B = concatBuffers. Other raw codecs stay unchanged.
  return source.replace(before, `(s === "mpeg" ? (() => {
  let sampleRate = 0, samples = 0, baseTime = 0;
  return async frames => {
    const start = baseTime + (sampleRate ? samples / sampleRate : 0);
    for (const frame of frames) {
      if (frame.header.sampleRate !== sampleRate) {
        baseTime += sampleRate ? samples / sampleRate : 0;
        sampleRate = frame.header.sampleRate;
        samples = 0;
      }
      samples += frame.samples;
    }
    await this.Yi();
    const buffer = this.Ii.sourceBuffers[0];
    // Anchor each append to the sample clock, not the rounded previous end.
    if (buffer) buffer.timestampOffset = start;
    await this.Gi(B(frames.map(frame => frame.data)));
  };
})() : async frames => this.Gi(B(frames.map(frame => frame.data))))`);
}

export function patchIcecastPlayer(source) {
  assert.equal(hash(source), upstreamHash, 'Expected the pristine checked-in IcecastMetadataPlayer 1.17.13 bundle');
  const replace = (before, after) => {
    assert.equal(source.split(before).length, 2, 'Patch must match exactly once');
    source = source.replace(before, after);
  };
  // Bundle symbols: s = instance WeakMap; i = states; R = abortController;
  // x = playerState; u = audioElement; ut = onPlayReady; dt = onAudioError.
  replace('[ut]:()=>{const t=s.get(this)[u];(this.state===i.LOADING||!t.loop&&this.state!==i.STOPPING&&this.state!==i.STOPPED)&&t.play().then(()=>{this[x]=i.PLAYING}).catch(t=>{s.get(this)[dt](t)})}', `[ut]: () => {
  const audio = s.get(this)[u];
  if (this.state === i.LOADING || (!audio.loop && this.state !== i.STOPPING && this.state !== i.STOPPED)) {
    const controller = s.get(this)[R];
    audio.play().then(() => {
      // Ignore a successful play completion from an aborted playback session.
      if (!controller.signal.aborted) this[x] = i.PLAYING;
    }).catch(error => s.get(this)[dt](error));
  }
}`);
  // h = first audio waiting promise; wt = retryTimeoutId; S = retryTimeout;
  // yt = onAudioWaiting; e = event names; P = fireEvent; pt = retryAttempt.
  replace('s.get(this)[wt]=setTimeout(()=>{h.then(()=>{s.get(this)[x]===i.RETRYING&&(this[P](e.RETRY_TIMEOUT),this.stop())})},1e3*s.get(this)[S]),s.get(this)[pt]=0', `(() => {
  // Do not spend the retry allowance playing old buffered audio. Start it at
  // the first wait, and never let a finished retry time out a subsequent one.
  let retryActive = true;
  const cancelRetry = () => {
    retryActive = false;
    clearTimeout(s.get(this)[wt]);
    this.removeEventListener(i.PLAYING, cancelRetry);
    this.removeEventListener(i.STOPPING, cancelRetry);
    s.get(this)[u].removeEventListener("waiting", s.get(this)[yt]);
  };
  this.addEventListener(i.PLAYING, cancelRetry, { once: true });
  this.addEventListener(i.STOPPING, cancelRetry, { once: true });
  h.then(() => {
    if (!retryActive) return;
    s.get(this)[wt] = setTimeout(() => {
      if (retryActive && s.get(this)[x] === i.RETRYING) {
        this[P](e.RETRY_TIMEOUT);
        this.stop();
      }
    }, 1000 * s.get(this)[S]);
  });
})(),s.get(this)[pt]=0`);
  // The upstream mapping no longer describes this modified file.
  source = source.replace(/\/\/# sourceMappingURL=icecast-metadata-player-1\.17\.13\.main\.min\.js\.map\s*$/, '');
  return patchTiming('// Local recovery patch: see tools/patch-icecast-player.mjs and docs/STREAM-RECOVERY.md\n' + source);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = new URL('../vendor/icecast-metadata-player-1.17.13.main.min.js', import.meta.url);
  const source = await readFile(file, 'utf8');
  if (hash(source) === patchedHash) {
    console.log('Icecast recovery patch verified; no changes');
  } else {
    assert.ok(!process.argv.includes('--check'), 'Bundle is not the reviewed patched version');
    const result = hash(source) === recoveryHash ? patchTiming(source) : patchIcecastPlayer(source);
    assert.equal(hash(result), patchedHash, 'Generated patch must match the reviewed bundle');
    await writeFile(file, result);
    console.log(`Patched IcecastMetadataPlayer: ${hash(result)}`);
  }
}
