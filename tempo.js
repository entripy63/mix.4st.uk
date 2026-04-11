// tempo.js - BPM detection via spectral flux autocorrelation
// Dependencies: core.js (storage, aud, audioCtx, analyserNode)
// Heavy computation runs in tempo-worker.js (Web Worker) for
// reliable timing and to keep autocorrelation off the main thread.

const bpmDisplay = document.getElementById("bpmDisplay");

let tempoWorker = null;

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
    const freqData = new Uint8Array(analyserNode.frequencyBinCount);

    tempoWorker.onmessage = function(e) {
        const msg = e.data;
        if (msg.type === 'tick') {
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
            if (msg.smoothCorrs) {
                tempo.lastCorrs = msg.smoothCorrs;
            }

            if (tempo.bpm > 0) {
                bpmDisplay.textContent = tempo.bpm.toFixed(1) + ' BPM';
                bpmDisplay.style.display = '';
            }
            bpmDisplay.title = tempo.skipReason;
            bpmDisplay.style.color = tempo.skipReason ? '#ffd740' : '';
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
