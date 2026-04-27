// tempo-worker.js - BPM detection worker thread
// Receives spectral flux values from main thread, runs autocorrelation
// and subharmonic summation, posts results back for display.

const BPM_MIN = 50;
const BPM_MAX = 200;
const SAMPLE_RATE_MIN = 30;
const SAMPLE_RATE_MAX = 240;

const s = {
    sampleRate: 120,
    bufLen: 480,
    fluxBuf: new Float32Array(480),
    bufIdx: 0,
    bufFilled: 0,

    emaCorrs: null,
    emaCorrAlpha: 0.1,
    smoothCorrs: null,

    maxLag: 0,
    shsPeriod: 0,
    shsBpm: 0,
    shsDiv: 0,
    shsPer: 0,

    frameCount: 0,
    corrCount: 0,
    lastCorrTime: 0,
};

function reset() {
    s.fluxBuf = new Float32Array(s.bufLen);
    s.bufIdx = 0;
    s.bufFilled = 0;
    s.emaCorrs = null;
    s.smoothCorrs = null;
    s.maxLag = 0;
    s.shsPeriod = 0;
    s.shsBpm = 0;
    s.shsDiv = 0;
    s.shsPer = 0;
    s.frameCount = 0;
    s.corrCount = 0;
    s.lastCorrTime = 0;
    s.sampleRate = 120;
}

function postResult(lastCorrMax) {
    const msg = {
        type: 'result',
        bpm: s.shsBpm,
        maxLag: s.maxLag,
        lastCorrMax: lastCorrMax,
        sampleRate: s.sampleRate,
        shsPeriod: s.shsPeriod || 0,
        shsBpm: s.shsBpm || 0,
        shsDiv: s.shsDiv || 0,
        shsPer: s.shsPer || 0,
        promOdd: s.promOdd || 0,
        promRange: s.promRange || null,
        shsSR: s.shsSR,
    };
    if (s.smoothCorrs) {
        msg.smoothCorrs = new Float32Array(s.smoothCorrs);
    }
    self.postMessage(msg);
}

function processFlux(flux) {
    s.fluxBuf[s.bufIdx] = flux;
    s.bufIdx = (s.bufIdx + 1) % s.bufLen;
    if (s.bufFilled < s.bufLen) s.bufFilled++;

    // Run autocorrelation ~1x per second
    if (++s.frameCount < s.sampleRate || s.bufFilled < s.bufLen) return;

    // Measure sample rate over this interval
    const now = performance.now();
    if (s.lastCorrTime > 0) {
        const dt = (now - s.lastCorrTime) / 1000;
        if (dt > 0) {
            const instantRate = s.frameCount / dt;
            if (Number.isFinite(instantRate) && instantRate > 0) {
                const blended = 0.7 * s.sampleRate + 0.3 * instantRate;
                s.sampleRate = Math.max(SAMPLE_RATE_MIN, Math.min(SAMPLE_RATE_MAX, blended));
            }
        }
    }
    s.lastCorrTime = now;
    s.frameCount = 0;
    s.corrCount++;

    // Compute mean flux for normalisation
    let mean = 0;
    for (let i = 0; i < s.bufLen; i++) mean += s.fluxBuf[i];
    mean /= s.bufLen;

    // Autocorrelation from lag 3
    const maxLag = Math.min(Math.round(s.sampleRate * 60 / 35), s.bufLen - 1);
    if (maxLag > s.maxLag) s.maxLag = maxLag;
    const corrs = new Float32Array(s.bufLen);

    for (let lag = 3; lag <= maxLag; lag++) {
        let corr = 0;
        for (let i = 0; i < s.bufLen; i++) {
            const a = s.fluxBuf[(s.bufIdx + i) % s.bufLen] - mean;
            const b = s.fluxBuf[(s.bufIdx + i + lag) % s.bufLen] - mean;
            corr += a * b;
        }
        corrs[lag] = corr;
    }

    // Compute signal energy (zero-lag autocorrelation = variance)
    let energy = 0;
    for (let i = 0; i < s.bufLen; i++) {
        const a = s.fluxBuf[(s.bufIdx + i) % s.bufLen] - mean;
        energy += a * a;
    }

    // EMA-blend autocorrelation to sharpen peaks over time
    if (!s.emaCorrs) {
        s.emaCorrs = new Float32Array(s.bufLen);
    }
    const alpha = s.emaCorrAlpha;
    const beta = 1 - alpha;
    for (let i = 0; i < s.bufLen; i++) {
        s.emaCorrs[i] = alpha * corrs[i] + beta * s.emaCorrs[i];
    }

    // Symmetric FIR smoothing along lag axis (linear phase — no peak shift)
    // 11-tap triangular kernel [1,2,3,4,5,6,5,4,3,2,1]/36
    if (!s.smoothCorrs) {
        s.smoothCorrs = new Float32Array(s.bufLen);
    }
    const ec = s.emaCorrs;
    for (let i = 0; i < 5; i++) s.smoothCorrs[i] = ec[i];
    for (let i = s.bufLen - 5; i < s.bufLen; i++) s.smoothCorrs[i] = ec[i];
    for (let i = 5; i < s.bufLen - 5; i++) {
        s.smoothCorrs[i] = (
            ec[i - 5] + 2 * ec[i - 4] + 3 * ec[i - 3] + 4 * ec[i - 2] + 5 * ec[i - 1]
            + 6 * ec[i]
            + 5 * ec[i + 1] + 4 * ec[i + 2] + 3 * ec[i + 3] + 2 * ec[i + 4] + ec[i + 5]
        ) / 36;
    }

    // Suppress lag=0 decay: find the first local minimum
    let firstMin = 3;
    for (let i = 4; i < maxLag; i++) {
        if (s.smoothCorrs[i] <= s.smoothCorrs[i - 1] && s.smoothCorrs[i] <= s.smoothCorrs[i + 1]) {
            firstMin = i;
            break;
        }
    }
    for (let i = 0; i <= firstMin; i++) {
        s.smoothCorrs[i] = 0;
    }

    // Second FIR pass (same triangular kernel)
    const snap = new Float32Array(s.smoothCorrs);
    for (let i = 5; i < s.bufLen - 5; i++) {
        s.smoothCorrs[i] = (
            snap[i - 5] + 2 * snap[i - 4] + 3 * snap[i - 3] + 4 * snap[i - 2] + 5 * snap[i - 1]
            + 6 * snap[i]
            + 5 * snap[i + 1] + 4 * snap[i + 2] + 3 * snap[i + 3] + 2 * snap[i + 4] + snap[i + 5]
        ) / 36;
    }

    // Find peak of smoothed correlations for thresholding
    let globalMax = 0;
    for (let lag = firstMin + 1; lag <= maxLag; lag++) {
        if (s.smoothCorrs[lag] > globalMax) globalMax = s.smoothCorrs[lag];
    }

    const lastCorrMax = globalMax;

    // Skip update if no significant periodicity
    if (energy <= 0 || globalMax < energy * 0.02) {
        postResult(lastCorrMax);
        return;
    }

    const sc = s.smoothCorrs;

    // Helper: refine a lag to sub-sample precision
    const refineLag = (lag) => {
        if (lag <= 3 || lag >= sc.length - 1) return lag;
        const prev = sc[lag - 1], peak = sc[lag], next = sc[lag + 1];
        if (prev > 0 && peak > 0 && next > 0) {
            const lnPrev = Math.log(prev);
            const lnPeak = Math.log(peak);
            const lnNext = Math.log(next);
            const denom = 2 * (2 * lnPeak - lnPrev - lnNext);
            if (denom > 0) {
                const offset = (lnPrev - lnNext) / denom;
                return lag + Math.max(-0.5, Math.min(0.5, offset));
            }
        } else {
            const denom = 2 * (2 * peak - prev - next);
            if (denom > 0) {
                const offset = (prev - next) / denom;
                return lag + Math.max(-0.5, Math.min(0.5, offset));
            }
        }
        return lag;
    };

    // SHS scoring helper: prominence-weighted score for a candidate
    // period. Each harmonic h*t is compared to the midpoints between
    // harmonics at (h±0.5)*t — a second derivative at the scale of t.
    // Peaks score positive, troughs negative, regardless of sharpness
    // or absolute amplitude.
    const shsScore = (t) => {
        let sum = 0;
        const halfT = Math.round(t / 2);
        for (let h = 1; h * t <= maxLag; h++) {
            const idx = Math.round(h * t);
            if (idx < 1 || idx >= sc.length - 1) break;
            const left = idx - halfT;
            const right = idx + halfT;
            if (left < 0 || right >= sc.length) break;
            const prominence = sc[idx] - (sc[left] + sc[right]) / 2;
            sum += prominence;
        }
        return sum;
    };

    // Space ratio at a candidate period: peak width at zero
    // crossings vs gap width. See docs/SPACE-RATIO.md
    // Returns ratio or -1 if unmeasurable.
    const spaceRatioAt = (t, per = 4) => {
        // Use the first stable peak at t*per/2 (peak 2 for per=4,
        // peak 3 for per=6, peak 5 for per=10) rather than t*1
        // which is an odd-numbered peak and may be poorly formed.
        const tLag = Math.round(per / 2 * t);
        if (tLag < 2 || tLag >= sc.length - 1 || sc[tLag] <= 0) return -1;
        let left = tLag, right = tLag;
        while (left > 0 && sc[left] > 0) left--;
        while (right < sc.length - 1 && sc[right] > 0) right++;
        const peakWidth = right - left;
        if (peakWidth <= 0) return -1;
        return (t - peakWidth) / peakWidth;
    };

    // ── Subharmonic Summation: find fundamental period T ──
    let bestShsScore = -Infinity;
    let bestT = 0;
    const minT = firstMin + 1;
    const maxT = Math.floor(maxLag / 2);
    for (let t = minT; t <= maxT; t += 0.5) {
        const score = shsScore(t);
        if (score > bestShsScore) {
            bestShsScore = score;
            bestT = t;
        }
    }

    // Periodicity and division detection via prominence checks.
    // The SHS loop above finds N=1 directly with prominence scoring,
    // so we only need to determine periodicity (4/6/10) and detect
    // missing odd peaks (div=2) or missing peaks 1-3 (div=4).
    let div = 1;
    let periodicity = 4;
    if (bestT > 0 && bestShsScore > 0) {
        const halfT = Math.round(bestT / 2);
        const inBounds = (idx) => idx > halfT && idx + halfT < sc.length;
        const prom = (idx) => sc[idx] - (sc[idx - halfT] + sc[idx + halfT]) / 2;
        const isPeak = (idx) => idx > 0 && idx < sc.length - 1 && sc[idx] > sc[idx - 1] && sc[idx] > sc[idx + 1];
        // Snap a candidate index to the nearest local maximum within ±2
        const snapPeak = (idx) => {
            let best = idx;
            for (let i = Math.max(1, idx - 2); i <= Math.min(sc.length - 2, idx + 2); i++) {
                if (sc[i] > sc[i - 1] && sc[i] > sc[i + 1] && sc[i] > sc[best]) best = i;
            }
            return best;
        };
        const idx4 = snapPeak(Math.round(4 * bestT));
        const idx6 = snapPeak(Math.round(6 * bestT));
        const idx10 = snapPeak(Math.round(10 * bestT));

        // Periodicity: compare prominence at 6×T and 10×T vs 4×T
        if (inBounds(idx4)) {
            const prom4 = prom(idx4);
            if (inBounds(idx6) && isPeak(idx6) && prom(idx6) > 2 * prom4) {
                periodicity = 6;
            } else if (inBounds(idx10) && isPeak(idx10) && prom(idx10) > 2 * prom4) {
                periodicity = 10;
            }
        }

        // Div detection: check for prominence at 3T/2 (odd peak present)
        // Uses 3T/2 rather than T/2 to avoid lag=0 suppression artefacts.
        // Find actual troughs between even peaks at T and 2T rather than
        // using fixed offsets which may land on the skirts of broad peaks.
        const idxT = Math.round(bestT);
        let idx3Half = Math.round(3 * bestT / 2);
        const idx2T = Math.round(2 * bestT);
        s.promOdd = 0;
        s.promRange = [idxT, idx3Half, idx2T];
        if (idxT > 0 && idx2T < sc.length && periodicity === 4) {
            // Snap idx3Half to the nearest local maximum within ±2
            const snapLo = Math.max(idxT + 1, idx3Half - 2);
            const snapHi = Math.min(idx2T - 1, idx3Half + 2);
            for (let i = snapLo; i <= snapHi; i++) {
                if (sc[i] > sc[i - 1] && sc[i] > sc[i + 1] && sc[i] > sc[idx3Half]) {
                    idx3Half = i;
                }
            }
            let minL = sc[idx3Half], minR = sc[idx3Half];
            let minLIdx = idx3Half, minRIdx = idx3Half;
            for (let i = idxT + 1; i < idx3Half; i++) {
                if (sc[i] < minL) { minL = sc[i]; minLIdx = i; }
            }
            for (let i = idx3Half + 1; i < idx2T; i++) {
                if (sc[i] < minR) { minR = sc[i]; minRIdx = i; }
            }
            s.promRange = [minLIdx, idx3Half, minRIdx];
            s.promOdd = sc[idx3Half] - (minL + minR) / 2;
            if (s.promOdd > 0 && sc[idx3Half] > sc[idx3Half - 1] && sc[idx3Half] > sc[idx3Half + 1]) {
                // Odd peak exists — true fundamental is T/2
                bestT /= 2;
                div = 2;
            }
        }

        // Space ratio fallback for absent odd peaks that lack
        // even a hint of prominence at T/2.
        // Ratio > 2 means N=2, ratio > 5 means N=4.
        if (div === 1) {
            const sr = spaceRatioAt(bestT, periodicity);
            if (sr > 5) {
                bestT /= 4;
                div = 4;
            } else if (sr > 2) {
                bestT /= 2;
                div = 2;
            }
        }
    }

    s.shsDiv = div;
    s.shsPer = periodicity;

    // Debug: odd peak prominence (raw) and space ratio
    s.shsSR = spaceRatioAt(bestT * div, periodicity);

    // Refine T by finding the local maximum in sc[] nearest
    // to a known-strong harmonic, then dividing back.
    let refinedT = bestT;
    if (bestT > 0) {
        // Try 2× periodicity first (better precision), fall back to 1×
        for (const mult of [periodicity * 2, periodicity]) {
            const target = Math.round(mult * bestT);
            if (target < 2 || target >= sc.length - 1 || target > maxLag - mult) continue;
            const window = mult + 2;
            const lo = Math.max(1, target - window);
            const hi = Math.min(sc.length - 2, target + window);
            let peakIdx = -1, peakVal = -Infinity;
            for (let i = lo; i <= hi; i++) {
                if (sc[i] > sc[i - 1] && sc[i] > sc[i + 1] && sc[i] > peakVal) {
                    peakVal = sc[i];
                    peakIdx = i;
                }
            }
            if (peakIdx > 0) {
                refinedT = refineLag(peakIdx) / mult;
                break;
            }
        }
    }
    s.shsPeriod = refinedT;

    // Correct T into valid BPM range by octave-shifting
    if (refinedT > 0) {
        const maxTBpm = s.sampleRate * 60 / (periodicity * BPM_MIN);
        const minTBpm = s.sampleRate * 60 / (periodicity * BPM_MAX);
        while (refinedT > maxTBpm) refinedT /= 2;
        while (refinedT < minTBpm) refinedT *= 2;
    }
    s.shsPeriod = refinedT;

    // Derive BPM from the actual peak nearest periodicity*T
    s.shsBpm = 0;
    if (refinedT > 0) {
        const bpmLag = Math.round(periodicity * refinedT);
        const win = Math.max(3, periodicity);
        const lo = Math.max(1, bpmLag - win);
        const hi = Math.min(sc.length - 2, bpmLag + win);
        let peakIdx = -1, peakVal = -Infinity;
        for (let i = lo; i <= hi; i++) {
            if (sc[i] > sc[i - 1] && sc[i] > sc[i + 1] && sc[i] > peakVal) {
                peakVal = sc[i];
                peakIdx = i;
            }
        }
        if (peakIdx > 0) {
            s.shsBpm = s.sampleRate * 60 / refineLag(peakIdx);
        } else {
            s.shsBpm = s.sampleRate * 60 / (periodicity * refinedT);
        }
    }

    postResult(lastCorrMax);
}

let tickInterval = null;

self.onmessage = function (e) {
    switch (e.data.type) {
        case 'start':
            if (!tickInterval) {
                tickInterval = setInterval(() => {
                    self.postMessage({ type: 'tick' });
                }, 7);
            }
            break;
        case 'stop':
            if (tickInterval) {
                clearInterval(tickInterval);
                tickInterval = null;
            }
            reset();
            break;
        case 'pause':
            if (tickInterval) {
                clearInterval(tickInterval);
                tickInterval = null;
            }
            break;
        case 'resume':
            s.lastCorrTime = 0;
            if (!tickInterval) {
                tickInterval = setInterval(() => {
                    self.postMessage({ type: 'tick' });
                }, 7);
            }
            break;
        case 'reset':
            reset();
            break;
        case 'flux':
            processFlux(e.data.flux);
            break;
    }
};
