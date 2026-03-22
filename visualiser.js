// visualiser.js - Live stream audio visualisation (spectrum/waveform)
// Dependencies: core.js (state, storage, aud)

const visCanvas = document.getElementById("waveform");
const visCtx = visCanvas.getContext("2d");
const bpmDisplay = document.getElementById("bpmDisplay");

let audioCtx = null;
let analyserNode = null;
let audioSourceNode = null;
let visualiserAnimId = null;
let visualiserMode = 'spectrum'; // 'spectrum' or 'waveform'

// ============================================
// TEMPO TRACKER (spectral flux autocorrelation)
// ============================================

const tempo = {
    // Flux history (circular buffer, ~4 seconds at 60fps)
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
    emaCorrs: null,      // exponentially averaged autocorrelation
    emaCorrAlpha: 0.1,   // EMA blend factor (0=frozen, 1=no smoothing)
    bestLag: 0,          // best lag from last autocorrelation (for display)
    maxLag: 0,           // max lag computed in last autocorrelation

    // Timing
    lastTime: 0,
    fps: 60,             // measured frame rate for lag→BPM conversion
    frameCount: 0,       // frames since last autocorrelation

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
        this.lastTime = 0;
        this.fps = 60;
        this.frameCount = 0;
    },

    update(freqData, now) {
        if (!this.lastTime) { this.lastTime = now; return; }
        const dt = now - this.lastTime;
        this.lastTime = now;
        if (dt <= 0 || dt > 0.5) return;

        // Track actual frame rate (smoothed)
        this.fps += 0.1 * (1 / dt - this.fps);

        const len = freqData.length;

        // Initialise lastSpectrum on first real frame
        const gamma = 1;
        if (!this.lastSpectrum) {
            this.lastSpectrum = new Float32Array(len);
            for (let i = 0; i < len; i++) this.lastSpectrum[i] = Math.log1p(gamma * freqData[i]);
            return;
        }

        // Spectral flux on log-compressed magnitudes (per literature)
        let flux = 0;
        for (let i = 0; i < len; i++) {
            const compressed = Math.log1p(gamma * freqData[i]);
            const delta = compressed - this.lastSpectrum[i];
            if (delta > 0) flux += delta;
            this.lastSpectrum[i] = compressed;
        }

        this.fluxBuf[this.bufIdx] = flux;
        this.bufIdx = (this.bufIdx + 1) % this.bufLen;
        if (this.bufFilled < this.bufLen) this.bufFilled++;

        // Run autocorrelation ~1x per second (every 60 frames)
        if (++this.frameCount < 60 || this.bufFilled < this.bufLen) return;
        this.frameCount = 0;

        // Compute mean flux for normalisation
        let mean = 0;
        for (let i = 0; i < this.bufLen; i++) mean += this.fluxBuf[i];
        mean /= this.bufLen;

        // Autocorrelation from lag 3 (need short lags for tick detection)
        // maxLag varies with fps but array is always bufLen to avoid
        // resizing the EMA buffer and causing display judder
        const maxLag = Math.min(Math.round(this.fps * 60 / 35), this.bufLen - 1);
        this.maxLag = maxLag;
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
        const minLag = Math.round(this.fps * 60 / 200);
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
            let detectedBpm = this.fps * 60 / refinedLag;
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

function ensureAudioContext() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.3;
    audioSourceNode = audioCtx.createMediaElementSource(aud);
    audioSourceNode.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);
}

function startVisualiser() {
    ensureAudioContext();
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    if (visualiserAnimId) return;
    const freqData = new Uint8Array(analyserNode.frequencyBinCount);
    const timeData = new Uint8Array(analyserNode.fftSize);
    const drawVis = storage.getBool('visualiserEnabled', true);

    let bpmFrameCount = 0;

    function drawVisualiser() {
        visualiserAnimId = requestAnimationFrame(drawVisualiser);

        // Always read frequency data for tempo tracking
        analyserNode.getByteFrequencyData(freqData);
        tempo.update(freqData, performance.now() / 1000);

        // Update BPM display ~4x per second
        if (++bpmFrameCount >= 15) {
            bpmFrameCount = 0;
            if (tempo.bpm > 0) {
                //const hist = tempo.bpmHistory.map(v => v.toFixed(1)).join(', ');
                //const conf = Math.min(1, tempo.lastConfidence).toFixed(2);
                bpmDisplay.textContent = tempo.bpm.toFixed(1) + ' BPM';
                //bpmDisplay.textContent = tempo.bpm.toFixed(1) + ' BPM [' + hist + '] ' + conf;
                bpmDisplay.style.display = '';
            }
        }

        if (!drawVis) return;

        const w = visCanvas.width;
        const h = visCanvas.height;
        visCtx.clearRect(0, 0, w, h);

        if (visualiserMode === 'spectrum') {
            const barCount = freqData.length;
            const barWidth = w / barCount;
            for (let i = 0; i < barCount; i++) {
                const val = freqData[i] / 255;
                const barHeight = val * h * 0.9;
                const x = i * barWidth;
                visCtx.fillStyle = val > 0.6 ? '#7986cb' : '#5c6bc0';
                visCtx.fillRect(x, h - barHeight, Math.max(1, barWidth - 1), barHeight);
            }
        } else if (visualiserMode === 'waveform') {
            analyserNode.getByteTimeDomainData(timeData);
            const sliceWidth = w / timeData.length;
            const midY = h / 2;
            visCtx.strokeStyle = '#5c6bc0';
            visCtx.lineWidth = 2;
            visCtx.beginPath();
            for (let i = 0; i < timeData.length; i++) {
                const val = (timeData[i] - 128) / 128;
                const y = midY - val * midY * 0.9;
                const x = i * sliceWidth;
                if (i === 0) visCtx.moveTo(x, y);
                else visCtx.lineTo(x, y);
            }
            visCtx.stroke();
        } else if (visualiserMode === 'flux' && tempo.bufFilled > 0) {
            // Draw spectral flux time series from circular buffer
            const n = tempo.bufFilled;
            const sliceWidth = w / n;

            // Slow-decay peak scaling (expands fast, contracts slowly)
            let bufPeak = 0;
            for (let i = 0; i < n; i++) {
                if (tempo.fluxBuf[i] > bufPeak) bufPeak = tempo.fluxBuf[i];
            }
            tempo.fluxPeak = Math.max(bufPeak, tempo.fluxPeak * 0.995);
            const scale = tempo.fluxPeak || 1;

            // Fixed reference line (shows scaling changes)
            const refY = h - (10 / scale) * h * 0.9;
            visCtx.strokeStyle = '#ffffff30';
            visCtx.lineWidth = 1;
            visCtx.beginPath();
            visCtx.moveTo(0, refY);
            visCtx.lineTo(w, refY);
            visCtx.stroke();

            // Flux time series (clipped at scale, not auto-scaled)
            visCtx.strokeStyle = '#5c6bc0';
            visCtx.lineWidth = 2;
            visCtx.beginPath();
            for (let i = 0; i < n; i++) {
                const idx = (tempo.bufIdx + i) % tempo.bufLen;
                const val = Math.min(1, tempo.fluxBuf[idx] / scale);
                const x = i * sliceWidth;
                const y = h - val * h * 0.9;
                if (i === 0) visCtx.moveTo(x, y);
                else visCtx.lineTo(x, y);
            }
            visCtx.stroke();
        } else if (visualiserMode === 'autocorr' && tempo.lastCorrs && tempo.maxLag > 0) {
            const corrs = tempo.lastCorrs;
            const n = tempo.maxLag + 1;
            const scale = tempo.lastCorrMax || 1;
            const sliceWidth = w / n;

            // Zero line
            const zeroY = h / 2;
            visCtx.strokeStyle = '#ffffff30';
            visCtx.lineWidth = 1;
            visCtx.beginPath();
            visCtx.moveTo(0, zeroY);
            visCtx.lineTo(w, zeroY);
            visCtx.stroke();

            // Autocorrelation curve (positive above centre, negative below)
            visCtx.strokeStyle = '#5c6bc0';
            visCtx.lineWidth = 2;
            visCtx.beginPath();
            for (let i = 0; i < n; i++) {
                const val = corrs[i] / scale; // -1..1 range roughly
                const y = zeroY - val * zeroY * 0.85;
                const x = i * sliceWidth;
                if (i === 0) visCtx.moveTo(x, y);
                else visCtx.lineTo(x, y);
            }
            visCtx.stroke();

            // Mark the best-lag peak
            if (tempo.bestLag > 0 && tempo.bestLag < n) {
                const px = tempo.bestLag * sliceWidth;
                visCtx.strokeStyle = '#7986cb';
                visCtx.lineWidth = 1;
                visCtx.setLineDash([4, 4]);
                visCtx.beginPath();
                visCtx.moveTo(px, 0);
                visCtx.lineTo(px, h);
                visCtx.stroke();
                visCtx.setLineDash([]);
            }
        }
    }
    drawVisualiser();
}

function stopVisualiser() {
    if (visualiserAnimId) {
        cancelAnimationFrame(visualiserAnimId);
        visualiserAnimId = null;
    }
    visCtx.clearRect(0, 0, visCanvas.width, visCanvas.height);
    tempo.reset();
    bpmDisplay.style.display = 'none';
    bpmDisplay.textContent = '';
}

// Click canvas to toggle between spectrum and waveform when live
visCanvas.addEventListener('click', (e) => {
    if (!state.isLive || !visualiserAnimId) return;
    e.preventDefault();
    e.stopPropagation();
    const modes = ['spectrum', 'waveform', 'flux', 'autocorr'];
    visualiserMode = modes[(modes.indexOf(visualiserMode) + 1) % modes.length];
});

aud.addEventListener('playing', () => {
    if (state.isLive) startVisualiser();
    else stopVisualiser();
});

aud.addEventListener('pause', () => {
    if (state.isLive) stopVisualiser();
});
