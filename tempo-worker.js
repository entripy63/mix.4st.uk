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
    shsBestT: 0,
    shsPrevPer: 4,

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
    s.shsScores = null;
    s.shsScoresMinT = 0;
    s.shsScoresStep = 0.5;
    s.shsBestT = 0;
    s.shsPrevPer = 4;
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
        divRatio: s.divRatio || 0,
        shsSR: s.shsSR,
        divSrc: s.divSrc || '',
        perProms: s.perProms || null,
        shsScoresMinT: s.shsScoresMinT || 0,
        shsScoresStep: s.shsScoresStep || 0.5,
    };
    if (s.smoothCorrs) {
        msg.smoothCorrs = new Float32Array(s.smoothCorrs);
    }
    if (s.shsScores) {
        msg.shsScores = new Float32Array(s.shsScores);
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

    // SHS scoring helper: normalised-prominence score for a candidate
    // period. Each harmonic h*t is compared to the midpoints between
    // harmonics at (h±0.5)*t — a second derivative at the scale of t.
    // Prominence is divided by globalMax so that broad/tall peaks at
    // high lags don't outscore sharper peaks at low lags.
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
            sum += prominence / globalMax;
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
    const minT = 4; //firstMin + 1;
    const maxT = Math.floor(maxLag / 2);
    const shsLen = maxT >= minT ? Math.floor((maxT - minT) / 0.5) + 1 : 0;
    const shsScores = new Float32Array(shsLen);
    for (let i = 0; i < shsLen; i++) {
        shsScores[i] = shsScore(minT + i * 0.5);
        if (shsScores[i] > bestShsScore) bestShsScore = shsScores[i];
    }
    s.shsScores = shsScores;
    s.shsScoresMinT = minT;
    s.shsScoresStep = 0.5;

    // Prefer the lowest-T significant peak in the SHS scores.
    // Harmonics at 2T, 4T etc. produce similar-height peaks;
    // scanning upward from minT picks the true fundamental.
    // Hysteresis: the incumbent T is retained at a lower threshold
    // (70%) than the acquisition threshold (85%) to prevent flicker
    // when two candidates have similar scores.
    if (bestShsScore > 0) {
        // Look up the incumbent's current score
        let incumbentScore = 0;
        if (s.shsBestT > 0) {
            const incIdx = Math.round((s.shsBestT - minT) / 0.5);
            if (incIdx >= 0 && incIdx < shsLen) {
                incumbentScore = shsScores[incIdx];
            }
        }

        // If incumbent is still strong, retain it
        if (incumbentScore >= bestShsScore * 0.70) {
            bestT = s.shsBestT;
        } else {
            // Acquire new: lowest-T peak above 85%
            const threshold = bestShsScore * 0.85;
            for (let i = 1; i < shsLen - 1; i++) {
                if (shsScores[i] >= threshold
                    && shsScores[i] >= shsScores[i - 1]
                    && shsScores[i] >= shsScores[i + 1]) {
                    bestT = minT + i * 0.5;
                    break;
                }
            }
        }
        s.shsBestT = bestT;
    }

    // Division and periodicity detection.
    // Div detection runs first so that periodicity detection operates
    // on the corrected T (not 2T or 4T from the SHS).
    let div = 1;
    s.divSrc = '';
    let periodicity = 4;
    if (bestT > 0 && bestShsScore > 0) {
        // ── Div detection via SHS scores ──
        // If T/2 scores well relative to T, the true fundamental is T/2.
        // Hysteresis: acquire div=2 at >60% and space ratio > 1.4, retain until <30%.
        // Periodicity-agnostic — works for any beat structure.
        // Look up peak SHS score near T and T/2, searching ±2 indices
        // to handle narrow peaks that a single-index lookup can miss.
        const shsPeak = (t) => {
            const centre = Math.round((t - minT) / 0.5);
            let best = 0;
            for (let i = Math.max(0, centre - 2); i <= Math.min(shsLen - 1, centre + 2); i++) {
                if (shsScores[i] > best) best = shsScores[i];
            }
            return best;
        };
        const tScore = shsPeak(bestT);
        const halfScore = shsPeak(bestT / 2);
        s.divRatio = tScore > 0 ? halfScore / tScore : 0;
        if (tScore > 0) {
            const ratio = halfScore / tScore;
            const wasDiv2 = s.shsDiv === 2;
            if (wasDiv2 ? ratio >= 0.3 : (ratio > 0.6 && s.shsSR > 1.4)) {
                bestT /= 2;
                div = 2;
                s.divSrc = 'shs';
            }
        }

        // ── Periodicity detection ──
        // Now runs on the corrected bestT after div adjustments.
        const halfT = Math.round(bestT / 2);
        const inBounds = (idx) => idx > halfT && idx + halfT < sc.length;
        const prom = (idx) => sc[idx] - (sc[idx - halfT] + sc[idx + halfT]) / 2;
        // Snap a candidate index to the nearest local maximum within ±win
        const snapPeak = (idx, win = 2) => {
            let best = idx;
            for (let i = Math.max(1, idx - win); i <= Math.min(sc.length - 2, idx + win); i++) {
                if (sc[i] > sc[i - 1] && sc[i] > sc[i + 1] && sc[i] > sc[best]) best = i;
            }
            return best;
        };
        // Wider snap windows for higher harmonics to account for
        // cumulative T error: ±2 for 4×T, ±4 for 6×T, ±6 for 10×T
        const idx4 = snapPeak(Math.round(4 * bestT), 2);
        const idx6 = snapPeak(Math.round(6 * bestT), 4);
        const idx10 = snapPeak(Math.round(10 * bestT), 6);

        // Compare prominence at 6×T and 10×T vs 4×T.
        // Hysteresis: switching away from 4 requires 2× prom4, but
        // retaining 6 or 10 only requires matching prom4 (factor 1).
        // Periodicity 10 must also beat 6 to prevent false 10 when
        // the track is in 6 and prom4 is incidentally low.
        if (inBounds(idx4)) {
            const prom4 = prom(idx4);
            const ib6 = inBounds(idx6), ib10 = inBounds(idx10);
            const prom6Val = ib6 ? prom(idx6) : 0;
            const prom10Val = ib10 ? prom(idx10) : 0;
            const thresh6 = s.shsPrevPer === 6 ? 1 : 3;
            const thresh10 = s.shsPrevPer === 10 ? 1 : 3;
            s.perProms = [prom4, prom6Val, prom10Val, thresh6, thresh10, ib6, ib10];
            if (prom6Val > thresh6 * prom4 && prom6Val >= prom10Val) {
                periodicity = 6;
            } else if (prom10Val > thresh10 * prom4 && prom10Val > prom6Val) {
                periodicity = 10;
            }
        }
        s.shsPrevPer = periodicity;
    }

    s.shsDiv = div;
    s.shsPer = periodicity;

    // Debug: pace ratio
    s.shsSR = spaceRatioAt(bestT * div, periodicity);

    // Refine T by finding the local maximum in sc[] nearest
    // to a known-strong harmonic, then dividing back.
    // Picks the peak closest to the target (not tallest) since the
    // SHS already determined the best T — refinement just sharpens it.
    let refinedT = bestT;
    if (bestT > 0) {
        // Use the periodicity peak for refinement — it's the strongest
        // and most reliable. Higher multiples risk malformed peaks.
        for (const mult of [periodicity]) {
            const target = Math.round(mult * bestT);
            if (target < 2 || target >= sc.length - 1 || target > maxLag - mult) continue;
            const window = mult + 2;
            const lo = Math.max(1, target - window);
            const hi = Math.min(sc.length - 2, target + window);
            let peakLag = -1, peakDist = Infinity;
            for (let i = lo; i <= hi; i++) {
                if (sc[i] > sc[i - 1] && sc[i] > sc[i + 1]) {
                    const dist = Math.abs(i - target);
                    if (dist < peakDist) {
                        peakDist = dist;
                        peakLag = i;
                    }
                }
            }
            if (peakLag > 0) {
                refinedT = refineLag(peakLag) / mult;
                break;
            }
        }
        
    }

    // Correct T into valid BPM range by octave-shifting
    if (refinedT > 0) {
        const maxTBpm = s.sampleRate * 60 / (periodicity * BPM_MIN);
        const minTBpm = s.sampleRate * 60 / (periodicity * BPM_MAX);
        while (refinedT > maxTBpm) refinedT /= 2;
        while (refinedT < minTBpm) refinedT *= 2;
    }
    s.shsPeriod = refinedT;

    // Derive BPM from the folded refinedT
    s.shsBpm = s.sampleRate * 60 / (periodicity * refinedT);

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
