// tempo-worker.js - BPM detection worker thread
// Receives spectral flux values from main thread, runs autocorrelation
// and peak scoring, posts results back for display.

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

    bpm: 0,
    rawBpm: 0,
    instantBpm: 0,

    emaCorrs: null,
    emaCorrAlpha: 0.05,
    smoothCorrs: null,

    bestLag: 0,
    interpLag: 0,
    maxLag: 0,
    debugRefinedLag: 0,
    debugPeakCount: 0,
    debugTroughCount: 0,
    unfoldedBpm: 0,
    stabilityCount: 0,   // consecutive passes where winning lag agrees
    bpmTarget: 0,        // current smoothing target
    w4Low: false,        // true = low-tempo weight, false = high-tempo weight
    w4Weight: 0.0,       // current lag/4 weight
    w4LockCount: 0,      // passes remaining before weight can change
    w4LastFlipPass: 0,   // corrCount when w4Low last flipped
    skipReason: '',      // why estimation was skipped (empty = normal)
    topScores: [],       // top scored candidates [{lag, score}]

    // Tracking state machine: locking → locked → holding
    trackState: 'locking',
    lockLag: 0,          // lag we're locked to
    lockConfirm: 0,      // consecutive ordinal-confirmed passes
    holdRemaining: 0,    // passes remaining in holding before giving up
    altBetterCount: 0,   // consecutive passes where top scorer disagrees with lock
    altBetterLag: 0,     // the disagreeing lag being tracked
    octaveFixCount: 0,   // consecutive passes where half-BPM condition holds
    octaveCooldown: 0,   // passes remaining before another octave correction allowed
    lockingStallCount: 0, // consecutive locking passes with no confirmed candidate

    frameCount: 0,
    corrCount: 0,
    lastCorrTime: 0,
};

function reset() {
    s.fluxBuf = new Float32Array(s.bufLen);
    s.bufIdx = 0;
    s.bufFilled = 0;
    s.bpm = 0;
    s.rawBpm = 0;
    s.instantBpm = 0;
    s.emaCorrs = null;
    s.smoothCorrs = null;
    s.bestLag = 0;
    s.interpLag = 0;
    s.maxLag = 0;
    s.debugRefinedLag = 0;
    s.stabilityCount = 0;
    s.bpmTarget = 0;
    s.w4Low = false;
    s.w4Weight = 0.0;
    s.w4LockCount = 0;
    s.w4LastFlipPass = 0;
    s.skipReason = '';
    s.topScores = [];
    s.trackState = 'locking';
    s.lockLag = 0;
    s.lockConfirm = 0;
    s.holdRemaining = 0;
    s.altBetterCount = 0;
    s.altBetterLag = 0;
    s.octaveFixCount = 0;
    s.octaveCooldown = 0;
    s.lockingStallCount = 0;
    s.frameCount = 0;
    s.corrCount = 0;
    s.lastCorrTime = 0;
    s.sampleRate = 120;
}

// Update lag/4 weight regime based on current tempo estimate
function updateW4Weight() {
    if (s.bpmTarget <= 0) return;
    if (s.w4LockCount > 0) {
        s.w4LockCount--;
        return;
    }
    const shouldBeLow = s.bpmTarget < 100;
    if (shouldBeLow !== s.w4Low) {
        if (s.corrCount - s.w4LastFlipPass < 15) {
            s.w4LockCount = 30;
        } else {
            s.w4Low = shouldBeLow;
            s.w4Weight = s.w4Low ? 0.5 : 0.0;
            s.w4LastFlipPass = s.corrCount;
        }
    }
}

function postResult(lastCorrMax) {
    const msg = {
        type: 'result',
        bpm: s.bpm,
        rawBpm: s.rawBpm,
        instantBpm: s.instantBpm,
        stabilityCount: s.stabilityCount,
        bestLag: s.bestLag,
        interpLag: s.interpLag,
        maxLag: s.maxLag,
        lastCorrMax: lastCorrMax,
        debugRefinedLag: s.debugRefinedLag,
        debugPeakCount: s.debugPeakCount,
        debugTroughCount: s.debugTroughCount,
        w4Weight: s.w4Weight,
        unfoldedBpm: s.unfoldedBpm,
        sampleRate: s.sampleRate,
        skipReason: s.skipReason,
        topScores: s.topScores,
        peakLags: s.peakLags || [],
        trackState: s.trackState,
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
    // Sized for ~136 Hz sample rate (equivalent to 5-tap at 60 Hz)
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

    // Suppress lag=0 decay: find the first local minimum from single-pass
    // data (before the second FIR pass which can smooth it away).
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

    // Second FIR pass on the full lag range (same triangular kernel).
    // Uniform double-filtering eliminates amplitude mismatch between
    // halves and further cleans ripple artifacts from peak tops.
    // Wider peaks at long lags are barely affected (already wider than
    // the kernel), so no amplitude correction is needed.
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

    s.skipReason = '';

    try {
        // Skip update if no significant periodicity (hold last good estimate)
        if (energy <= 0 || globalMax < energy * 0.02) {
            s.skipReason = 'No periodicity (globalMax/energy=' + (energy > 0 ? (globalMax / energy).toFixed(3) : '0') + ')';
            s.peakLags = [];
            s.topScores = [];
            s.debugPeakCount = 0;
            s.debugTroughCount = 0;
            return;
        }

        const sc = s.smoothCorrs;

        // Precompute local maxima and minima with prominence
        const peaks = [];
        const troughs = [];
        for (let i = 4; i < maxLag; i++) {
            if (sc[i] > sc[i - 1] && sc[i] > sc[i + 1]) {
                peaks.push({ lag: i, prominence: 0 });
            } else if (sc[i] < sc[i - 1] && sc[i] < sc[i + 1]) {
                troughs.push({ lag: i });
            }
        }
        // Too many extrema = noisy autocorrelation, skip scoring
        if (peaks.length > 50) {
            s.skipReason = 'Too many peaks (' + peaks.length + ')';
            return;
        }

        // Minimum spacing: clumped extrema (< 10 samples apart) are noise.
        // Run BEFORE prominence so split-peak sub-peaks get consolidated
        // into one peak whose prominence is then computed against real troughs.
        // At ~136 Hz sample rate the shortest meaningful lag is ~41 (200 BPM),
        // so 10 samples is safe and catches wider split peaks.
        // Apply to peaks: keep tallest in each clump.
        for (let i = 0; i < peaks.length - 1;) {
            if (peaks[i + 1].lag - peaks[i].lag < 10) {
                if (sc[peaks[i].lag] >= sc[peaks[i + 1].lag]) {
                    peaks.splice(i + 1, 1);
                } else {
                    peaks.splice(i, 1);
                }
            } else {
                i++;
            }
        }
        // Apply to troughs: keep deepest in each clump, then remove
        // any peaks that were between the merged troughs.
        // Same 10-sample threshold as peaks so ripple troughs on peak
        // tops get merged, preventing them from poisoning prominence.
        for (let i = 0; i < troughs.length - 1;) {
            if (troughs[i + 1].lag - troughs[i].lag < 10) {
                const loIdx = troughs[i].lag;
                const hiIdx = troughs[i + 1].lag;
                if (sc[troughs[i].lag] <= sc[troughs[i + 1].lag]) {
                    troughs.splice(i + 1, 1);
                } else {
                    troughs.splice(i, 1);
                }
                // Remove any peak trapped between the merged troughs
                for (let j = peaks.length - 1; j >= 0; j--) {
                    if (peaks[j].lag > loIdx && peaks[j].lag < hiIdx) {
                        peaks.splice(j, 1);
                    }
                }
            } else {
                i++;
            }
        }

        // Compute prominence: peak height above the higher neighbouring trough.
        // For the first peak (no left trough), use the zeroed baseline as
        // reference so prominence reflects its rise from the suppressed zone.
        // Runs after spacing merge so consolidated peaks get correct prominence.
        for (const pk of peaks) {
            let leftTrough = null, rightTrough = null;
            for (let t = troughs.length - 1; t >= 0; t--) {
                if (troughs[t].lag < pk.lag) { leftTrough = sc[troughs[t].lag]; break; }
            }
            for (let t = 0; t < troughs.length; t++) {
                if (troughs[t].lag > pk.lag) { rightTrough = sc[troughs[t].lag]; break; }
            }
            if (leftTrough === null && rightTrough === null) {
                pk.prominence = sc[pk.lag];
            } else if (leftTrough === null) {
                // First peak: left side is the zeroed lag-0 region (baseline 0)
                pk.prominence = sc[pk.lag] - Math.min(0, rightTrough);
            } else if (rightTrough === null) {
                // Last peak: right side cut off at maxLag
                pk.prominence = sc[pk.lag] - Math.min(0, leftTrough);
            } else {
                pk.prominence = sc[pk.lag] - Math.max(leftTrough, rightTrough);
            }
        }

        // Remove noise peaks: prominence must exceed 5% of globalMax
        // This stabilises peak indices by eliminating flickering bumps
        const promThreshold = globalMax * 0.05;
        for (let i = peaks.length - 1; i >= 0; i--) {
            const pk = peaks[i];
            if (pk.prominence < promThreshold          // prominence too small
                || (sc[pk.lag] > 0 && pk.prominence / sc[pk.lag] < 0.10)) { // flank jaggy / slope ripple
                peaks.splice(i, 1);
            }
        }

        // Re-scan gaps between surviving peaks for major peaks that were
        // only represented by now-removed noise sub-peaks (split peaks)
        if (peaks.length > 0) {
            const gapPeaks = [];
            const boundaries = [firstMin + 1, ...peaks.map(p => p.lag), maxLag];
            for (let g = 0; g < boundaries.length - 1; g++) {
                const lo = boundaries[g] + 2;
                const hi = boundaries[g + 1] - 2;
                if (hi - lo < 2) continue;
                let bestIdx = -1, bestVal = -Infinity;
                for (let j = lo; j <= hi; j++) {
                    if (sc[j] > bestVal) { bestVal = sc[j]; bestIdx = j; }
                }
                if (bestIdx < 0) continue;
                // Prominence: find the trough on each side of the best
                // point (between it and each boundary peak) and measure
                // height above the higher trough — standard prominence.
                // Falls back to boundary peak value if no trough exists
                // (monotonic slope), preserving original conservative behavior.
                let leftMin = sc[boundaries[g]];
                for (let j = lo; j < bestIdx; j++) {
                    if (sc[j] < leftMin) leftMin = sc[j];
                }
                let rightMin = sc[boundaries[g + 1]];
                for (let j = bestIdx + 1; j <= hi; j++) {
                    if (sc[j] < rightMin) rightMin = sc[j];
                }
                const edgeProm = bestVal - Math.max(leftMin, rightMin);
                if (edgeProm >= promThreshold) {
                    gapPeaks.push({ lag: bestIdx, prominence: edgeProm });
                }
            }
            if (gapPeaks.length > 0) {
                peaks.push(...gapPeaks);
                peaks.sort((a, b) => a.lag - b.lag);
            }
        }

        // Also remove troughs not between surviving peaks
        if (peaks.length > 0) {
            const firstPeakIdx = peaks[0].lag;
            const lastPeakIdx = peaks[peaks.length - 1].lag;
            for (let i = troughs.length - 1; i >= 0; i--) {
                if (troughs[i].lag < firstPeakIdx || troughs[i].lag > lastPeakIdx) {
                    troughs.splice(i, 1);
                }
            }
        }

        s.debugPeakCount = peaks.length;
        s.debugTroughCount = troughs.length;

        // Windowed subdivision support: check if a fractional lag position
        // has a nearby peak (positive support) or trough (negative support)
        // within ±1.5 samples. Normalised by globalMax for readable scores.
        const norm = globalMax || 1;
        const subdivSupport = (target) => {
            if (target < 4) return 0;
            let bestPeak = 0, bestTrough = 0;
            for (const pk of peaks) {
                if (Math.abs(pk.lag - target) <= 1.5 && pk.prominence > bestPeak) {
                    bestPeak = pk.prominence;
                }
                if (pk.lag > target + 2) break;
            }
            for (const tr of troughs) {
                if (Math.abs(tr.lag - target) <= 1.5) {
                    const depth = Math.min(sc[tr.lag - 1], sc[tr.lag + 1]) - sc[tr.lag];
                    if (depth > bestTrough) bestTrough = depth;
                }
                if (tr.lag > target + 2) break;
            }
            // Concavity fallback: detect vestigial peaks that don't form
            // strict local maxima but show downward curvature (negative d2)
            if (bestPeak === 0) {
                const t = Math.round(target);
                if (t > 0 && t < sc.length - 1) {
                    const d2 = sc[t - 1] - 2 * sc[t] + sc[t + 1];
                    if (d2 < 0) bestPeak = -d2;
                }
            }
            return (bestPeak - bestTrough) / norm;
        };

        // Combined subdivision support: lag + half-lag + weighted quarter-lag
        const fullSupport = (lag) =>
            subdivSupport(lag)
            + subdivSupport(lag / 2)
            + s.w4Weight * Math.max(0, subdivSupport(lag / 4));

        const minLag = Math.round(s.sampleRate * 60 / BPM_MAX);
        const maxBpmLag = Math.round(s.sampleRate * 60 / BPM_MIN);
        s.peakLags = peaks.map(pk => pk.lag);

        // Helper: find nearest peak to a target lag within tolerance
        const findNearPeak = (target, tolerance) => {
            let best = null, bestDist = Infinity;
            for (const pk of peaks) {
                const dist = Math.abs(pk.lag - target);
                if (dist < bestDist && dist <= tolerance) {
                    best = pk;
                    bestDist = dist;
                }
            }
            return best;
        };

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

        // Helper: compute BPM from a refined lag and update state
        const applyLag = (lag) => {
            s.bestLag = lag;
            s.interpLag = lag;
            const refined = refineLag(lag);
            s.debugRefinedLag = refined;
            let detectedBpm = s.sampleRate * 60 / refined;
            s.unfoldedBpm = detectedBpm;
            while (detectedBpm < BPM_MIN) detectedBpm *= 2;
            while (detectedBpm > BPM_MAX) detectedBpm /= 2;
            s.instantBpm = detectedBpm;
            s.rawBpm = detectedBpm;
            s.bpmTarget = detectedBpm;
        };

        // ── Evaluate bestLag for all states except holding ──
        let bestLag = 0;
        let bestScore = -Infinity;
        const topN = [];

        if (s.trackState !== 'holding') {
            for (const pk of peaks) {
                if (pk.lag < minLag || pk.lag > maxBpmLag) continue;
                if (pk.prominence <= 0) continue;
                const support = fullSupport(pk.lag);
                // Peak ordinal bias
                let isOrdinalConfirmed = false;
                const myOrd = peaks.indexOf(pk) + 1;
                // Case 1: I'm ~4th, half-lag peak is ~2nd
                if (myOrd >= 3) {
                    const halfLag = pk.lag / 2;
                    for (let j = 0; j < peaks.length; j++) {
                        if (Math.abs(peaks[j].lag - halfLag) <= 1.5) {
                            const halfOrd = j + 1;
                            const k = 2 * halfOrd - myOrd;
                            if (k >= 0 && k <= 2 && halfOrd - k === 2) {
                                isOrdinalConfirmed = true;
                            }
                            break;
                        }
                    }
                }
                // Case 2: I'm ~4th, double-lag peak is ~8th
                if (!isOrdinalConfirmed && myOrd >= 3) {
                    const dblLag = pk.lag * 2;
                    for (let j = peaks.length - 1; j >= 0; j--) {
                        if (Math.abs(peaks[j].lag - dblLag) <= 1.5) {
                            const dblOrd = j + 1;
                            const k = 2 * myOrd - dblOrd;
                            if (k >= 0 && k <= 2 && myOrd - k === 4) {
                                isOrdinalConfirmed = true;
                            }
                            break;
                        }
                    }
                }
                // Case 3: periodicity-6 — I'm ~6th, half-lag peak is ~3rd
                if (!isOrdinalConfirmed && myOrd >= 4) {
                    const halfLag = pk.lag / 2;
                    for (let j = 0; j < peaks.length; j++) {
                        if (Math.abs(peaks[j].lag - halfLag) <= 1.5) {
                            const halfOrd = j + 1;
                            const k = 2 * halfOrd - myOrd;
                            if (k >= 0 && k <= 2 && halfOrd - k === 3) {
                                isOrdinalConfirmed = true;
                            }
                            break;
                        }
                    }
                }
                // Case 4: periodicity-6 — I'm ~6th, double-lag peak is ~12th
                if (!isOrdinalConfirmed && myOrd >= 4) {
                    const dblLag = pk.lag * 2;
                    for (let j = peaks.length - 1; j >= 0; j--) {
                        if (Math.abs(peaks[j].lag - dblLag) <= 1.5) {
                            const dblOrd = j + 1;
                            const k = 2 * myOrd - dblOrd;
                            if (k >= 0 && k <= 2 && myOrd - k === 6) {
                                isOrdinalConfirmed = true;
                            }
                            break;
                        }
                    }
                }
                let score = support;
                if (!isOrdinalConfirmed) score -= 0.75;
                if (isOrdinalConfirmed && score > bestScore) {
                    bestScore = score;
                    bestLag = pk.lag;
                }
                if (topN.length < 6 || score > topN[topN.length - 1].score) {
                    topN.push({ lag: pk.lag, score });
                    topN.sort((a, b) => b.score - a.score);
                    if (topN.length > 6) topN.length = 6;
                }
            }
            s.topScores = topN.filter(c => c.score >= 0);
            // If no confirmed candidate, or top scorer dominates at 2x,
            // use the top scorer as bestLag so downstream code doesn't
            // need to handle a separate fallback path.
            if (topN.length > 0) {
                if (bestLag === 0 || topN[0].score >= bestScore * 2) {
                    bestLag = topN[0].lag;
                    bestScore = topN[0].score;
                }
            }
        }

        // ── LOCKED state: track the locked peak, quality gate only ──
        if (s.trackState === 'locked') {
            const tolerance = Math.max(3, s.lockLag * 0.08);
            const tracked = findNearPeak(s.lockLag, tolerance);
            if (!tracked) {
                // Peak lost — transition to holding
                s.trackState = 'holding';
                s.holdRemaining = 5;
                s.skipReason = 'Holding (peak lost)';
            } else {
                const lockScore = fullSupport(tracked.lag);
                if (lockScore < 0.5) {
                    s.trackState = 'locking';
                    s.lockConfirm = 0;
                    s.stabilityCount = 0;
                    s.skipReason = 'Lock broken (score=' + lockScore.toFixed(2) + ')';
                } else {
                    s.lockLag = tracked.lag;
                    applyLag(tracked.lag);
                    // Half-BPM octave correction (see ACF-PEAKS.md).
                    // When odd-numbered peaks vanish, the locked peak's
                    // ordinal doubles (4→8, 6→12), detectable via the gap
                    // between it and its half-lag companion.
                    // Double-BPM correction is intentionally omitted: scoring
                    // never produces a double-BPM error (it requires odd peaks
                    // present, which always yields the correct octave).
                    if (s.octaveCooldown > 0) s.octaveCooldown--;
                    if (s.octaveCooldown === 0) {
                        const myOrdLock = peaks.indexOf(tracked) + 1;
                        let halfBpmDetected = false;
                        if (myOrdLock > 0) {
                            const halfTolOct = Math.max(2, tracked.lag * 0.04);
                            const halfPeakOct = findNearPeak(tracked.lag / 2, halfTolOct);
                            if (halfPeakOct) {
                                const halfOrdLock = peaks.indexOf(halfPeakOct) + 1;
                                if (halfOrdLock > 0) {
                                    const ordGap = myOrdLock - halfOrdLock;
                                    if ((ordGap === 4 && myOrdLock >= 7 && myOrdLock <= 9)
                                        || (ordGap === 6 && myOrdLock >= 11 && myOrdLock <= 13)) {
                                        if (Math.round(tracked.lag / 2) >= minLag) {
                                            halfBpmDetected = true;
                                        }
                                    }
                                }
                            }
                        }
                        // Hysteresis: 3 consecutive confirmations
                        if (halfBpmDetected) {
                            s.octaveFixCount++;
                        } else {
                            s.octaveFixCount = 0;
                        }
                        if (s.octaveFixCount >= 3) {
                            const halfTolOct = Math.max(2, tracked.lag * 0.04);
                            const halfPeakOct = findNearPeak(tracked.lag / 2, halfTolOct);
                            if (halfPeakOct) {
                                s.lockLag = halfPeakOct.lag;
                                applyLag(halfPeakOct.lag);
                                s.skipReason = 'Locked (half BPM fix)';
                            }
                            s.octaveFixCount = 0;
                            s.octaveCooldown = 15;
                        }
                    }
                    // Alternative lag monitoring: if the bestLag
                    // consistently disagrees with a poor lock, the BPM
                    // may have changed (e.g. 80→120 where peak 4 becomes
                    // peak 6 but still passes all lock checks).
                    if (bestLag > 0 && lockScore < 1) {
                        const lockTol = Math.max(3, s.lockLag * 0.08);
                        if (Math.abs(bestLag - s.lockLag) > lockTol) {
                            s.altBetterCount++;
                            s.altBetterLag = bestLag;
                        } else {
                            s.altBetterCount = 0;
                        }
                        if (s.altBetterCount >= 5) {
                            s.trackState = 'locking';
                            s.lockConfirm = 0;
                            s.stabilityCount = 0;
                            s.altBetterCount = 0;
                            s.skipReason = 'Lock broken (better alternative: '+
                                bestScore.toFixed(2)+' > '+lockScore.toFixed(2)+')';
                        }
                    } else {
                        s.altBetterCount = 0;
                    }
                    //if (!s.skipReason) s.skipReason = 'Locked (' + lockScore.toFixed(2) + ')';
                }
            }
            updateW4Weight();
        }

        // ── HOLDING state: wait for locked peak to reappear ──
        else if (s.trackState === 'holding') {
            const tolerance = Math.max(3, s.lockLag * 0.08);
            const tracked = findNearPeak(s.lockLag, tolerance);
            if (tracked) {
                s.lockLag = tracked.lag;
                s.trackState = 'locked';
                applyLag(tracked.lag);
                s.octaveFixCount = 0;
                s.octaveCooldown = 0;
                s.altBetterCount = 0;
                s.skipReason = 'Locked (reacquired)';
            } else {
                s.holdRemaining--;
                if (s.holdRemaining <= 0) {
                    s.trackState = 'locking';
                    s.lockConfirm = 0;
                    s.stabilityCount = 0;
                    s.skipReason = 'Hold expired → locking';
                } else {
                    s.skipReason = 'Holding (' + s.holdRemaining + ' left)';
                }
            }
            updateW4Weight();
        }

        // ── LOCKING state: use pre-computed bestLag ──
        else {
            s.lockingStallCount++;

            if (bestLag > 0) {
                applyLag(bestLag);
                s.lockConfirm++;
            } else {
                s.lockConfirm = 0;
            }

            if (bestLag > 0) {
                // Transition to locked after enough consecutive confirmations
                if (s.lockConfirm >= 3) {
                    s.trackState = 'locked';
                    s.lockLag = bestLag;
                    s.altBetterCount = 0;
                    s.octaveFixCount = 0;
                    s.octaveCooldown = 0;
                    s.lockingStallCount = 0;
                    s.skipReason = 'Locked';
                } else {
                    // Wait for a few passes before first estimate
                    if (s.bpm === 0 && s.corrCount < 4) {
                        s.skipReason = 'Waiting (' + s.corrCount + '/4 passes)';
                        return;
                    }
                    s.skipReason = 'Locking (' + s.lockConfirm + '/3)';
                }
            }

            updateW4Weight();
        }

        // Stability tracking: feeds display smoothing rate in all states
        if (s.rawBpm > 0 && s.bpmTarget > 0) {
            let compareBpm = s.rawBpm;
            while (compareBpm > s.bpmTarget * 1.41) compareBpm /= 2;
            while (compareBpm < s.bpmTarget * 0.71) compareBpm *= 2;
            const drift = Math.abs(compareBpm - s.bpmTarget) / s.bpmTarget;
            const threshold = 0.10 + 0.15 / (1 + s.stabilityCount / 5);
            if (drift < threshold) {
                s.stabilityCount = Math.min(30, s.stabilityCount + 1);
            } else {
                s.stabilityCount = 0;
            }
        }
    } finally {
        // Display smoothing: rate scales with stability.
        // Low stability = fast response (0.6), high stability = slow (0.15).
        if (s.bpmTarget > 0) {
            if (s.bpm === 0) {
                s.bpm = s.bpmTarget;
            } else {
                // Base rate: slow when stable (0.08), fast when unstable (0.50)
                const baseRate = 0.08 + 0.42 / (1 + s.stabilityCount / 3);
                // >1 BPM away: lock to 0.85 so octave jumps converge in
                // ~3 passes (70→10.5→1.6→0.2); ≤1 BPM: gentle baseRate
                const rate = Math.abs(s.bpmTarget - s.bpm) > 1 ? Math.max(baseRate, 0.85) : baseRate;
                s.bpm += (s.bpmTarget - s.bpm) * rate;
            }
        }
        postResult(lastCorrMax);
    }
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
