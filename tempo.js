// tempo.js - BPM detection via spectral flux autocorrelation
// Dependencies: core.js (storage, aud, audioCtx, analyserNode)

const bpmDisplay = document.getElementById("bpmDisplay");

let tempoIntervalId = null;

// Precomputed compression LUT for Uint8 frequency bins (0–255)
// Replaces per-sample Math.log1p with a table lookup
const compressLUT = new Float32Array(256);
for (let i = 0; i < 256; i++) compressLUT[i] = Math.log1p(i);

const tempo = {
    // Fixed sample rate (Hz) — known constant, no estimation needed
    sampleRate: 60,

    // Flux history (circular buffer, ~4 seconds at sampleRate)
    bufLen: 240,
    fluxBuf: new Float32Array(240),
    bufIdx: 0,
    bufFilled: 0,        // frames written (capped at bufLen)
    lastSpectrum: null,   // previous frame's frequency data

    // Autocorrelation output
    bpm: 0,              // displayed BPM (smoothed)
    rawBpm: 0,           // latest autocorrelation result
    bpmHistory: [],      // recent estimates for median filtering
    lastConfidence: 0,   // confidence of last autocorrelation
    fluxPeak: 1,         // slow-decay peak for flux display scaling
    lastCorrs: null,     // most recent autocorrelation array for display
    lastCorrMax: 0,      // max correlation value for scaling
    emaCorrs: null,       // exponentially averaged autocorrelation
    emaCorrAlpha: 0.1,   // EMA blend factor (0=frozen, 1=no smoothing)
    bestLag: 0,          // best lag from last autocorrelation (for display)
    maxLag: 0,           // max lag computed in last autocorrelation

    // Timing
    frameCount: 0,       // frames since last autocorrelation
    totalFrames: 0,      // total frames since start (for rate measurement)
    startTime: 0,        // timestamp of first sample

    reset() {
        this.fluxBuf.fill(0);
        this.bufIdx = 0;
        this.bufFilled = 0;
        this.lastSpectrum = null;
        this.bpm = 0;
        this.rawBpm = 0;
        this.bpmHistory = [];
        this.lastConfidence = 0;
        this.fluxPeak = 1;
        this.lastCorrs = null;
        this.lastCorrMax = 0;
        this.emaCorrs = null;
        this.bestLag = 0;
        this.maxLag = 0;
        this.frameCount = 0;
        this.totalFrames = 0;
        this.startTime = 0;
    },

    update(freqData) {
        const len = freqData.length;

        // Initialise lastSpectrum on first frame
        if (!this.lastSpectrum) {
            this.lastSpectrum = new Float32Array(len);
            for (let i = 0; i < len; i++) this.lastSpectrum[i] = compressLUT[freqData[i]];
            return;
        }

        // Spectral flux on compressed magnitudes (LUT replaces Math.log1p)
        let flux = 0;
        for (let i = 0; i < len; i++) {
            const compressed = compressLUT[freqData[i]];
            const delta = compressed - this.lastSpectrum[i];
            if (delta > 0) flux += delta;
            this.lastSpectrum[i] = compressed;
        }

        this.fluxBuf[this.bufIdx] = flux;
        this.bufIdx = (this.bufIdx + 1) % this.bufLen;
        if (this.bufFilled < this.bufLen) this.bufFilled++;

        // Measure actual sample rate from real elapsed time
        if (!this.startTime) {
            this.startTime = performance.now();
        }
        this.totalFrames++;

        // Run autocorrelation ~1x per second
        if (++this.frameCount < this.sampleRate || this.bufFilled < this.bufLen) return;
        this.frameCount = 0;

        // Update measured sample rate (includes all real-world overhead)
        const elapsed = (performance.now() - this.startTime) / 1000;
        if (elapsed > 0) this.sampleRate = this.totalFrames / elapsed;

        // Compute mean flux for normalisation
        let mean = 0;
        for (let i = 0; i < this.bufLen; i++) mean += this.fluxBuf[i];
        mean /= this.bufLen;

        // Autocorrelation from lag 3
        // maxLag is fixed from sampleRate, array is always bufLen
        const maxLag = Math.min(Math.round(this.sampleRate * 60 / 35), this.bufLen - 1);
        if (maxLag > this.maxLag) this.maxLag = maxLag;
        const corrs = new Float32Array(this.bufLen);

        for (let lag = 3; lag <= maxLag; lag++) {
            let corr = 0;
            for (let i = 0; i < this.bufLen; i++) {
                const a = this.fluxBuf[(this.bufIdx + i) % this.bufLen] - mean;
                const b = this.fluxBuf[(this.bufIdx + i + lag) % this.bufLen] - mean;
                corr += a * b;
            }
            corrs[lag] = corr;
        }

        // Compute signal energy (zero-lag autocorrelation = variance)
        let energy = 0;
        for (let i = 0; i < this.bufLen; i++) {
            const a = this.fluxBuf[(this.bufIdx + i) % this.bufLen] - mean;
            energy += a * a;
        }

        // EMA-blend autocorrelation to sharpen peaks over time
        if (!this.emaCorrs) {
            this.emaCorrs = new Float32Array(this.bufLen);
        }
        const a = this.emaCorrAlpha;
        const b = 1 - a;
        for (let i = 0; i < this.bufLen; i++) {
            this.emaCorrs[i] = a * corrs[i] + b * this.emaCorrs[i];
        }

        // Find peak of smoothed correlations for thresholding
        let globalMax = 0;
        for (let lag = 3; lag <= maxLag; lag++) {
            if (this.emaCorrs[lag] > globalMax) globalMax = this.emaCorrs[lag];
        }

        this.lastCorrs = this.emaCorrs;
        this.lastCorrMax = globalMax;

        // Skip update if no significant periodicity (hold last good estimate)
        if (energy <= 0 || globalMax < energy * 0.05) return;

        // Interpolate smoothed correlation at fractional lag positions
        const sc = this.emaCorrs;
        const interpCorr = (exactLag) => {
            const lo = Math.floor(exactLag);
            const hi = lo + 1;
            if (lo < 3 || hi >= sc.length) return 0;
            const frac = exactLag - lo;
            return sc[lo] * (1 - frac) + sc[hi] * frac;
        };

        // Score each lag by own correlation + harmonic subdivision support
        // A true beat lag has strong correlation at lag/2, lag/4, lag/8 etc.
        const minLag = Math.round(this.sampleRate * 60 / 200);
        let bestLag = 0;
        let bestScore = 0;
        for (let lag = minLag; lag <= maxLag; lag++) {
            if (sc[lag] <= 0) continue;
            let score = sc[lag];
            for (let div = 2; div <= 16; div *= 2) {
                const subCorr = interpCorr(lag / div);
                if (subCorr > 0) score += subCorr;
            }
            if (score > bestScore) {
                bestScore = score;
                bestLag = lag;
            }
        }
        let bestCorr = bestLag > 0 ? sc[bestLag] : 0;

        if (bestLag > 0) {
            this.bestLag = bestLag;
            // Parabolic interpolation for sub-lag BPM precision
            let refinedLag = bestLag;
            if (bestLag > 3 && bestLag < maxLag) {
                const prev = sc[bestLag - 1];
                const next = sc[bestLag + 1];
                const denom = prev - 2 * bestCorr + next;
                if (denom < 0) {
                    const offset = Math.max(-0.5, Math.min(0.5, 0.5 * (prev - next) / denom));
                    refinedLag = bestLag + offset;
                }
            }
            let detectedBpm = this.sampleRate * 60 / refinedLag;
            while (detectedBpm < 90) detectedBpm *= 2;
            while (detectedBpm > 200) detectedBpm /= 2;

            // Confidence-weighted flywheel: strong periodicity trusts
            // autocorrelation, weak periodicity coasts on current estimate
            const confidence = Math.min(1, bestCorr / (energy * 0.3));
            this.lastConfidence = confidence;
            if (this.bpm > 0) {
                this.rawBpm = detectedBpm * confidence + this.bpm * (1 - confidence);
            } else {
                this.rawBpm = detectedBpm;
            }
        }

        // Median filter then smooth for display
        if (this.rawBpm > 0) {
            // Discard low-confidence estimates until we have a credible lock
            if (this.bpm === 0 && this.lastConfidence < 0.15) return;

            this.bpmHistory.push(this.rawBpm);
            if (this.bpmHistory.length > 9) this.bpmHistory.shift();
            const sorted = [...this.bpmHistory].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            if (this.bpm === 0) {
                this.bpm = this.rawBpm;
            } else {
                // Fast convergence when far off, stable when locked
                const alpha = Math.abs(median - this.bpm) > 2 ? 0.3 : 0.1;
                this.bpm += (median - this.bpm) * alpha;
            }
        }
    }
};

function startTempo() {
    if (tempoIntervalId) return;
    if (!storage.getBool('bpmEnabled', true)) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const freqData = new Uint8Array(analyserNode.frequencyBinCount);
    const intervalMs = Math.round(1000 / tempo.sampleRate);
    tempoIntervalId = setInterval(() => {
        analyserNode.getByteFrequencyData(freqData);
        tempo.update(freqData);
        if (tempo.bpm > 0) {
            bpmDisplay.textContent = tempo.bpm.toFixed(1) + ' BPM';
            bpmDisplay.style.display = '';
        }
    }, intervalMs);
}

function stopTempo() {
    if (tempoIntervalId) {
        clearInterval(tempoIntervalId);
        tempoIntervalId = null;
    }
    tempo.reset();
    bpmDisplay.style.display = 'none';
    bpmDisplay.textContent = '';
}
