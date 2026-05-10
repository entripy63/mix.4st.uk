// tempo.js - BPM detection via spectral flux autocorrelation
// Dependencies: core.js (storage, aud, audioCtx, analyserNode)
// Heavy computation runs in tempo-worker.js (Web Worker) for
// reliable timing and to keep autocorrelation off the main thread.

const bpmDisplay = document.getElementById("bpmDisplay");

let tempoWorker = null;
let tempoWorkerGeneration = 0;

function isTempoDebugEnabled() {
    return storage.getBool('tempoDebug', false);
}

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
    fluxPeak: 1,          // slow-decay peak for flux display scaling (set by visualiser)
    lastCorrs: null,      // most recent smoothed autocorrelation array (from worker)
    lastCorrMax: 0,
    maxLag: 0,
    shsPeriod: 0,
    shsBpm: 0,
    shsDiv: 0,
    shsPer: 0,
    divRatio: 0,
    shsSR: -1,
    divSrc: '',
    perProms: null,
    shsScores: null,
    shsScoresMinT: 0,
    shsScoresStep: 0.5,

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
        this.fluxPeak = 1;
        this.lastCorrs = null;
        this.lastCorrMax = 0;
        this.maxLag = 0;
        this.shsPeriod = 0;
        this.shsBpm = 0;
        this.shsDiv = 0;
        this.shsPer = 0;
        this.divRatio = 0;
        this.shsSR = -1;
        this.divSrc = '';
        this.perProms = null;
        this.shsScores = null;
        this.shsScoresMinT = 0;
        this.shsScoresStep = 0.5;
        this.sampleRate = 120;
    }
};

function startTempo() {
    if (tempoWorker) return;
    if (!storage.getBool('bpmEnabled', true)) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    tempoWorker = new Worker('tempo-worker.js');
    const workerGeneration = ++tempoWorkerGeneration;
    const freqData = new Uint8Array(analyserNode.frequencyBinCount);

    tempoWorker.onmessage = function(e) {
        // Ignore stale worker messages after a restart.
        if (workerGeneration !== tempoWorkerGeneration || !tempoWorker) return;

        const msg = e.data;
        if (msg.type === 'tick') {
            analyserNode.getByteFrequencyData(freqData);
            const flux = tempo.computeFlux(freqData);
            if (flux !== null) {
                tempoWorker.postMessage({ type: 'flux', flux });
            }
        } else if (msg.type === 'result') {
            tempo.bpm = msg.bpm;
            tempo.maxLag = msg.maxLag;
            tempo.lastCorrMax = msg.lastCorrMax;
            tempo.sampleRate = msg.sampleRate;
            tempo.shsPeriod = msg.shsPeriod || 0;
            tempo.shsBpm = msg.shsBpm || 0;
            tempo.shsDiv = msg.shsDiv || 0;
            tempo.shsPer = msg.shsPer || 0;
            tempo.divRatio = msg.divRatio || 0;
            tempo.shsSR = msg.shsSR != null ? msg.shsSR : -1;
            tempo.divSrc = msg.divSrc || '';
            tempo.perProms = msg.perProms || null;
            tempo.shsScoresMinT = msg.shsScoresMinT || 0;
            tempo.shsScoresStep = msg.shsScoresStep || 0.5;
            if (msg.shsScores) {
                tempo.shsScores = msg.shsScores;
            }
            if (msg.smoothCorrs) {
                tempo.lastCorrs = msg.smoothCorrs;
            }

            if (tempo.bpm > 0) {
                bpmDisplay.textContent = tempo.bpm.toFixed(1) + ' BPM';
                bpmDisplay.style.display = '';
            }
        }
    };

    tempoWorker.postMessage({ type: 'start' });
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
    tempoPausedAt = null;
    tempo.reset();
    bpmDisplay.style.display = 'none';
    bpmDisplay.textContent = '';
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (!tempoWorker || aud.paused || state.isStream || !storage.getBool('bpmEnabled', true)) return;
    // Nudge the worker when returning to foreground after potential background throttling.
    tempoWorker.postMessage({ type: 'resume' });
});
