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
    w4Low: true,        // true = low-tempo weight, false = high-tempo weight
    w4Weight: 0.5,       // current lag/4 weight
    w4LockCount: 0,      // passes remaining before weight can change
    w4LastFlipPass: 0,   // corrCount when w4Low last flipped
    skipReason: '',      // why estimation was skipped (empty = normal)
    topScores: [],       // top scored candidates [{lag, score}]

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
    s.w4Low = true;
    s.w4Weight = 0.5;
    s.w4LockCount = 0;
    s.w4LastFlipPass = 0;
    s.skipReason = '';
    s.topScores = [];
    s.frameCount = 0;
    s.corrCount = 0;
    s.lastCorrTime = 0;
    s.sampleRate = 120;
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
            ec[i-5] + 2*ec[i-4] + 3*ec[i-3] + 4*ec[i-2] + 5*ec[i-1]
            + 6*ec[i]
            + 5*ec[i+1] + 4*ec[i+2] + 3*ec[i+3] + 2*ec[i+4] + ec[i+5]
        ) / 36;
    }

    // Find peak of smoothed correlations for thresholding
    let globalMax = 0;
    for (let lag = 3; lag <= maxLag; lag++) {
        if (s.smoothCorrs[lag] > globalMax) globalMax = s.smoothCorrs[lag];
    }

    const lastCorrMax = globalMax;

    try {
        // Skip update if no significant periodicity (hold last good estimate)
        if (energy <= 0 || globalMax < energy * 0.02) {
            s.skipReason = 'No periodicity (globalMax/energy=' + (energy > 0 ? (globalMax/energy).toFixed(3) : '0') + ')';
            return;
        }

        const sc = s.smoothCorrs;

        // Precompute local maxima and minima with prominence
        const peaks = [];
        const troughs = [];
        for (let i = 4; i < maxLag; i++) {
            if (sc[i] > sc[i - 1] && sc[i] > sc[i + 1]) {
                peaks.push({ idx: i, prominence: 0 });
            } else if (sc[i] < sc[i - 1] && sc[i] < sc[i + 1]) {
                troughs.push({ idx: i });
            }
        }
        s.debugPeakCount = peaks.length;
        s.debugTroughCount = troughs.length;

        // Too many extrema = noisy autocorrelation, skip scoring
        if (peaks.length > 50) {
            s.skipReason = 'Too many peaks (' + peaks.length + ')';
            return;
        }

        // Compute prominence: peak height above the higher neighbouring trough
        for (const pk of peaks) {
            let leftTrough = -Infinity, rightTrough = -Infinity;
            for (let t = troughs.length - 1; t >= 0; t--) {
                if (troughs[t].idx < pk.idx) { leftTrough = sc[troughs[t].idx]; break; }
            }
            for (let t = 0; t < troughs.length; t++) {
                if (troughs[t].idx > pk.idx) { rightTrough = sc[troughs[t].idx]; break; }
            }
            pk.prominence = sc[pk.idx] - Math.max(leftTrough, rightTrough);
        }

        // Windowed subdivision support: check if a fractional lag position
        // has a nearby peak (positive support) or trough (negative support)
        // within ±1.5 samples. Normalised by globalMax for readable scores.
        const norm = globalMax || 1;
        const subdivSupport = (target) => {
            if (target < 4) return 0;
            let bestPeak = 0, bestTrough = 0;
            for (const pk of peaks) {
                if (Math.abs(pk.idx - target) <= 1.5 && pk.prominence > bestPeak) {
                    bestPeak = pk.prominence;
                }
                if (pk.idx > target + 2) break;
            }
            for (const tr of troughs) {
                if (Math.abs(tr.idx - target) <= 1.5) {
                    const depth = Math.min(sc[tr.idx - 1], sc[tr.idx + 1]) - sc[tr.idx];
                    if (depth > bestTrough) bestTrough = depth;
                }
                if (tr.idx > target + 2) break;
            }
            return (bestPeak - bestTrough) / norm;
        };

        const minLag = Math.round(s.sampleRate * 60 / BPM_MAX);
        const maxBpmLag = Math.round(s.sampleRate * 60 / BPM_MIN);

        let bestLag = 0;
        let bestScore = -Infinity;
        const topN = [];  // top scored candidates for debug visualisation
        for (const pk of peaks) {
            if (pk.idx < minLag || pk.idx > maxBpmLag) continue;
            if (pk.prominence <= 0) continue;
            // Cumulative binary subdivision support: lag + lag/2, with a
            // partial lag/4 contribution (clamped to zero) to gently bias
            // toward longer-lag candidates (4 8 over 2 4) without
            // penalising non-binary peaks (6, 10) whose lag/4 hits troughs.
            // Weight adapts to tempo regime: below 100 BPM only double-time
            // errors are possible, above only half-time — opposite
            // corrections needed either side of the boundary.
            const support = subdivSupport(pk.idx)
                          + subdivSupport(pk.idx / 2)
                          + s.w4Weight * Math.max(0, subdivSupport(pk.idx / 4));
            // Stability hysteresis: gently boost candidates near the current
            // bestLag to resist dithering. Grows with stability so fresh
            // estimates compete freely but locked ones resist transient noise.
            let score = support;
            if (s.bestLag > 0 && Math.abs(pk.idx - s.bestLag) / s.bestLag < 0.1) {
                score += 0.05 * Math.min(s.stabilityCount, 10) / 10;
            }
            if (score > bestScore) {
                bestScore = score;
                bestLag = pk.idx;
            }
            // Insert into top-N list (kept sorted descending by score)
            if (topN.length < 6 || score > topN[topN.length - 1].score) {
                topN.push({ lag: pk.idx, score });
                topN.sort((a, b) => b.score - a.score);
                if (topN.length > 6) topN.length = 6;
            }
        }
        s.topScores = topN.filter(c => c.score >= 1);

        if (bestLag > 0) {
            s.bestLag = bestLag;

            s.interpLag = bestLag;

            // Sub-sample BPM precision: Gaussian interpolation when all three
            // points are positive, else parabolic (handles negative baselines)
            let refinedLag = bestLag;
            if (bestLag > 3 && bestLag < sc.length - 1) {
                const prev = sc[bestLag - 1];
                const peak = sc[bestLag];
                const next = sc[bestLag + 1];
                if (prev > 0 && peak > 0 && next > 0) {
                    const lnPrev = Math.log(prev);
                    const lnPeak = Math.log(peak);
                    const lnNext = Math.log(next);
                    const denom = 2 * (2 * lnPeak - lnPrev - lnNext);
                    if (denom > 0) {
                        const offset = (lnPrev - lnNext) / denom;
                        refinedLag = bestLag + Math.max(-0.5, Math.min(0.5, offset));
                    }
                } else {
                    const denom = 2 * (2 * peak - prev - next);
                    if (denom > 0) {
                        const offset = (prev - next) / denom;
                        refinedLag = bestLag + Math.max(-0.5, Math.min(0.5, offset));
                    }
                }
            }
            s.debugRefinedLag = refinedLag;
            let detectedBpm = s.sampleRate * 60 / refinedLag;
            s.unfoldedBpm = detectedBpm;
            while (detectedBpm < BPM_MIN) detectedBpm *= 2;
            while (detectedBpm > BPM_MAX) detectedBpm /= 2;
            s.instantBpm = detectedBpm;
            s.rawBpm = detectedBpm;
        }

        // Stability-aware target update
        if (s.rawBpm > 0) {
            // Wait for a few passes before first estimate
            if (s.bpm === 0 && s.corrCount < 4) {
                s.skipReason = 'Waiting (' + s.corrCount + '/4 passes)';
                return;
            }

            if (s.bpmTarget > 0) {
                // Detect octave jump from raw ratio BEFORE normalisation.
                // Octave jumps (ratio ≈ 2.0 or 0.5) are almost always
                // estimation errors — lock the weight to prevent
                // reinforcing the error. Non-octave changes are genuine
                // tempo changes — allow weight to adapt quickly.
                const ratio = s.rawBpm / s.bpmTarget;
                const isOctave = (ratio > 1.85 && ratio < 2.15)
                              || (ratio > 0.46 && ratio < 0.54);
                if (isOctave) {
                    s.w4LockCount = 60;
                } else if (Math.abs(ratio - 1) > 0.1) {
                    // Non-octave jump — release octave locks quickly but
                    // don't undercut oscillation locks (≤30 passes)
                    if (s.w4LockCount > 30) s.w4LockCount = 3;
                }

                // Octave-normalise for stability comparison
                let compareBpm = s.rawBpm;
                while (compareBpm > s.bpmTarget * 1.41) compareBpm /= 2;
                while (compareBpm < s.bpmTarget * 0.71) compareBpm *= 2;

                const drift = Math.abs(compareBpm - s.bpmTarget) / s.bpmTarget;
                // Threshold scales with stability: starts at 25%, narrows
                // to 10% after many stable passes (capped at 30)
                const threshold = 0.10 + 0.15 / (1 + s.stabilityCount / 5);
                if (drift < threshold) {
                    s.stabilityCount = Math.min(30, s.stabilityCount + 1);
                } else {
                    s.stabilityCount = 0;
                }
                s.bpmTarget = s.rawBpm;
            } else {
                s.bpmTarget = s.rawBpm;
            }

            // Update weight regime when unlocked
            if (s.w4LockCount > 0) {
                s.w4LockCount--;
            } else {
                const shouldBeLow = s.bpmTarget < 100;
                if (shouldBeLow !== s.w4Low) {
                    if (s.corrCount - s.w4LastFlipPass < 15) {
                        // Second flip within 15 passes = oscillation — lock
                        s.w4LockCount = 30;
                    } else {
                        s.w4Low = shouldBeLow;
                        s.w4Weight = s.w4Low ? 0.5 : 0.0;
                        s.w4LastFlipPass = s.corrCount;
                    }
                }
            }
        }
        s.skipReason = '';
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

self.onmessage = function(e) {
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
