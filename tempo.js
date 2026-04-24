// tempo.js - BPM detection via spectral flux autocorrelation
// Dependencies: core.js (storage, aud, audioCtx, analyserNode)
// Heavy computation runs in tempo-worker.js (Web Worker) for
// reliable timing and to keep autocorrelation off the main thread.

const bpmDisplay = document.getElementById("bpmDisplay");

let tempoWorker = null;
let tempoWorkerGeneration = 0;
let tempoWatchdogInterval = null;
let tempoLastTickTs = 0;
const tempoDebug = {
    starts: 0,
    restarts: 0,
    lastStartAt: 0,
    lastRestartAt: 0,
    lastRestartReason: '',
    lastWatchdogAgeMs: 0,
    lastVisibilityResumeAt: 0,
};

function isTempoDebugEnabled() {
    return storage.getBool('tempoDebug', false);
}

function logTempoDebug(message, extra = null) {
    if (!isTempoDebugEnabled()) return;
    if (extra) {
        console.info('[tempo-debug]', message, extra);
    } else {
        console.info('[tempo-debug]', message);
    }
}

function renderTempoDebugTitle(baseTitle) {
    if (!isTempoDebugEnabled()) return baseTitle;
    const tickAge = tempoLastTickTs > 0 ? Math.round(performance.now() - tempoLastTickTs) : 0;
    const debugTitle = 'tempo dbg: starts=' + tempoDebug.starts
        + ' restarts=' + tempoDebug.restarts
        + ' tickAge=' + tickAge + 'ms'
        + (tempoDebug.lastRestartReason ? ' last=' + tempoDebug.lastRestartReason : '');
    return baseTitle ? baseTitle + ' | ' + debugTitle : debugTitle;
}

window.tempoDebugState = tempoDebug;

// Precomputed compression LUT for Uint8 frequency bins (0–255)
// Replaces per-sample Math.log1p with a table lookup
const compressLUT = new Float32Array(256);
for (let i = 0; i < 256; i++) compressLUT[i] = Math.log1p(i);

// Display/visualiser proxy — scalar fields updated from worker results,
// fluxBuf maintained locally for live visualiser display
const tempo = {
    sampleRate: 120,

    bufLen: 480,
    fluxBuf: new Float32Array(480),
    bufIdx: 0,
    bufFilled: 0,
    lastSpectrum: null,   // previous frame's compressed frequency data

    bpm: 0,
    rawBpm: 0,
    instantBpm: 0,
    stabilityCount: 0,
    fluxPeak: 1,          // slow-decay peak for flux display scaling (set by visualiser)
    lastCorrs: null,      // most recent smoothed autocorrelation array (from worker)
    lastCorrMax: 0,
    bestLag: 0,
    interpLag: 0,
    maxLag: 0,
    debugRefinedLag: 0,
    debugPeakCount: 0,
    debugTroughCount: 0,
    unfoldedBpm: 0,
    skipReason: '',
    topScores: [],       // top scored candidates [{lag, score}]

    // Compute spectral flux on main thread (needs analyserNode data)
    // Returns flux value to send to worker, or null on first frame
    computeFlux(freqData) {
        const len = freqData.length;
        if (!this.lastSpectrum) {
            this.lastSpectrum = new Float32Array(len);
            for (let i = 0; i < len; i++) this.lastSpectrum[i] = compressLUT[freqData[i]];
            return null;
        }
        let flux = 0;
        for (let i = 0; i < len; i++) {
            const compressed = compressLUT[freqData[i]];
            const delta = compressed - this.lastSpectrum[i];
            if (delta > 0) flux += delta;
            this.lastSpectrum[i] = compressed;
        }
        // Store locally for visualiser flux display
        this.fluxBuf[this.bufIdx] = flux;
        this.bufIdx = (this.bufIdx + 1) % this.bufLen;
        if (this.bufFilled < this.bufLen) this.bufFilled++;
        return flux;
    },

    reset() {
        this.fluxBuf = new Float32Array(this.bufLen);
        this.bufIdx = 0;
        this.bufFilled = 0;
        this.lastSpectrum = null;
        this.bpm = 0;
        this.rawBpm = 0;
        this.instantBpm = 0;
        this.stabilityCount = 0;
        this.fluxPeak = 1;
        this.lastCorrs = null;
        this.lastCorrMax = 0;
        this.bestLag = 0;
        this.interpLag = 0;
        this.maxLag = 0;
        this.debugRefinedLag = 0;
        this.sampleRate = 120;
    }
};

function startTempo() {
    if (tempoWorker) return;
    if (!storage.getBool('bpmEnabled', true)) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    tempoWorker = new Worker('tempo-worker.js');
    const workerGeneration = ++tempoWorkerGeneration;
    tempoLastTickTs = performance.now();
    tempoDebug.starts++;
    tempoDebug.lastStartAt = Date.now();
    logTempoDebug('worker started', { generation: workerGeneration, starts: tempoDebug.starts });
    const freqData = new Uint8Array(analyserNode.frequencyBinCount);

    tempoWorker.onmessage = function(e) {
        // Ignore stale worker messages after a restart.
        if (workerGeneration !== tempoWorkerGeneration || !tempoWorker) return;

        const msg = e.data;
        if (msg.type === 'tick') {
            tempoLastTickTs = performance.now();
            analyserNode.getByteFrequencyData(freqData);
            const flux = tempo.computeFlux(freqData);
            if (flux !== null) {
                tempoWorker.postMessage({ type: 'flux', flux });
            }
        } else if (msg.type === 'result') {
            tempo.bpm = msg.bpm;
            tempo.rawBpm = msg.rawBpm;
            tempo.instantBpm = msg.instantBpm;
            tempo.stabilityCount = msg.stabilityCount;
            tempo.bestLag = msg.bestLag;
            tempo.interpLag = msg.interpLag;
            tempo.maxLag = msg.maxLag;
            tempo.lastCorrMax = msg.lastCorrMax;
            tempo.debugRefinedLag = msg.debugRefinedLag;
            tempo.debugPeakCount = msg.debugPeakCount;
            tempo.debugTroughCount = msg.debugTroughCount;
            tempo.w4Weight = msg.w4Weight;
            tempo.unfoldedBpm = msg.unfoldedBpm;
            tempo.sampleRate = msg.sampleRate;
            tempo.skipReason = msg.skipReason || '';
            tempo.topScores = msg.topScores || [];
            tempo.peakLags = msg.peakLags || [];
            tempo.trackState = msg.trackState || 'locking';
            tempo.shsPeriod = msg.shsPeriod || 0;
            tempo.shsBpm = msg.shsBpm || 0;
            tempo.shsHalfPct = msg.shsHalfPct || 0;
            tempo.shsQtrPct = msg.shsQtrPct || 0;
            if (msg.smoothCorrs) {
                tempo.lastCorrs = msg.smoothCorrs;
            }

            // Log octave corrections with playback position
            if (tempo.skipReason.includes('Lock')) {
                const t = aud.currentTime;
                const mm = Math.floor(t / 60);
                const ss = Math.floor(t % 60).toString().padStart(2, '0');
                console.info('[tempo] ' + tempo.skipReason + ' at ' + mm + ':' + ss + ' → ' + tempo.bpm.toFixed(1) + ' BPM');
            }

            if (tempo.bpm > 0) {
                let bpmText = tempo.bpm.toFixed(1) + ' BPM';
                if (tempo.shsBpm > 0) {
                    bpmText += ' (' + tempo.shsBpm.toFixed(1) + ')';
                }
                bpmDisplay.textContent = bpmText;
                bpmDisplay.style.display = '';
            }
            // Latch: keep last non-empty skipReason for display title
            const displayReason = tempo.skipReason || bpmDisplay.title.split(' | ')[0] || '';
            bpmDisplay.title = renderTempoDebugTitle(displayReason);
            bpmDisplay.style.color = displayReason ? '#ffd740' : '';
        }
    };

    tempoWorker.postMessage({ type: 'start' });
    ensureTempoWatchdog();
}

function restartTempoWorker(reason = 'manual') {
    tempoDebug.restarts++;
    tempoDebug.lastRestartAt = Date.now();
    tempoDebug.lastRestartReason = reason;
    logTempoDebug('restarting worker', {
        reason,
        restarts: tempoDebug.restarts,
        tickAgeMs: tempoLastTickTs > 0 ? Math.round(performance.now() - tempoLastTickTs) : 0,
    });
    if (tempoWorker) {
        tempoWorker.postMessage({ type: 'stop' });
        tempoWorker.terminate();
        tempoWorker = null;
    }
    startTempo();
}

function ensureTempoWatchdog() {
    if (tempoWatchdogInterval) return;
    tempoWatchdogInterval = setInterval(() => {
        if (document.hidden) return;
        // Only enforce liveness while actively playing local audio and BPM is enabled.
        if (!tempoWorker || aud.paused || state.isStream || !storage.getBool('bpmEnabled', true)) return;

        const ageMs = performance.now() - tempoLastTickTs;
        if (ageMs > 3000) {
            tempoDebug.lastWatchdogAgeMs = Math.round(ageMs);
            restartTempoWorker('watchdog-no-tick');
        }
    }, 1000);
}

function stopTempoWatchdog() {
    if (!tempoWatchdogInterval) return;
    clearInterval(tempoWatchdogInterval);
    tempoWatchdogInterval = null;
}

let tempoPausedAt = null;

function pauseTempo() {
    if (tempoWorker) {
        tempoWorker.postMessage({ type: 'pause' });
    }
    tempoPausedAt = aud.currentTime;
}

function resumeTempo() {
    if (tempoPausedAt !== null && Math.abs(aud.currentTime - tempoPausedAt) > 1) {
        tempo.reset();
        if (tempoWorker) tempoWorker.postMessage({ type: 'reset' });
        bpmDisplay.style.display = 'none';
        bpmDisplay.textContent = '';
    }
    tempoPausedAt = null;
    if (tempoWorker) {
        tempoWorker.postMessage({ type: 'resume' });
    } else {
        startTempo();
    }
}

function stopTempo() {
    if (tempoWorker) {
        tempoWorker.postMessage({ type: 'stop' });
        tempoWorker.terminate();
        tempoWorker = null;
    }
    stopTempoWatchdog();
    tempoPausedAt = null;
    tempoLastTickTs = 0;
    tempo.reset();
    bpmDisplay.style.display = 'none';
    bpmDisplay.textContent = '';
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (!tempoWorker || aud.paused || state.isStream || !storage.getBool('bpmEnabled', true)) return;
    // Nudge the worker when returning to foreground after potential background throttling.
    tempoDebug.lastVisibilityResumeAt = Date.now();
    logTempoDebug('visibility resume nudge');
    tempoWorker.postMessage({ type: 'resume' });
});
