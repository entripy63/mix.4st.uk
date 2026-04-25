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
            sum += prominence / h;
        }
        return sum;
    };

    // Space ratio at a candidate period: peak width at zero
    // crossings vs gap width. See docs/SPACE-RATIO.md
    // Returns ratio or -1 if unmeasurable.
    const spaceRatioAt = (t) => {
        const tLag = Math.round(t);
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
    for (let t = minT; t <= maxT; t++) {
        const score = shsScore(t);
        if (score > bestShsScore) {
            bestShsScore = score;
            bestT = t;
        }
    }

    // Octave correction: cascading SHS division to find
    // true fundamental period T from N*T.
    // See docs/BPM-CORRECT.md for algorithm derivation.
    const threshold = 0.2 * bestShsScore;
    let div = 1;
    let periodicity = 4;
    if (bestT > 0 && bestShsScore > 0) {
        if (shsScore(bestT / 2) > threshold) {
            // Before dividing further: if space ratio at bestT/2
            // is ≤ 2, odd peaks are present and div=2 is correct.
            const sr = spaceRatioAt(bestT / 2);
            if (sr >= 0 && sr <= 2) {
                div = 2;
            } else if (shsScore(bestT / 4) > threshold) {
                if (shsScore(bestT / 8) > threshold) {
                    div = 8;
                } else {
                    div = 4;
                }
            } else if (shsScore(bestT / 6) > threshold) {
                div = 6;
                periodicity = 6;
            } else if (shsScore(bestT / 10) > threshold) {
                div = 10;
                periodicity = 10;
            } else {
                div = 2;
            }
        } else if (shsScore(bestT / 3) > threshold) {
            div = 3;
            periodicity = 6;
        } else if (shsScore(bestT / 5) > threshold) {
            div = 5;
            periodicity = 10;
        } else {
            // Fallback: if odd peaks fully formed, N=1;
            // check if periodicity-6 fits better than 4
            if (shsScore(3 * bestT) > shsScore(2 * bestT)) {
                periodicity = 6;
            }
        }
        bestT /= div;
    }
    // Space ratio post-check: detect absent odd peaks that
    // SHS can't see. Ratio > 2 means N=2.
    if (bestT > 0 && div === 1) {
        const sr = spaceRatioAt(bestT);
        if (sr > 2) {
            bestT /= 2;
            div *= 2;
        }
    }

    s.shsDiv = div;
    s.shsPer = periodicity;

    // Refine T by finding the local maximum in sc[] nearest
    // to a known-strong harmonic, then dividing back.
    let refinedT = bestT;
    if (bestT > 0) {
        // Try 2× periodicity first (better precision), fall back to 1×
        for (const mult of [periodicity * 2, periodicity]) {
            const target = Math.round(mult * bestT);
            if (target < 2 || target >= sc.length - 1) continue;
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
