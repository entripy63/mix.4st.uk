// tempo-worker.js - BPM detection worker thread
// Receives spectral flux values from main thread, runs autocorrelation
// and peak scoring, posts results back for display.

const s = {
    sampleRate: 120,
    bufLen: 480,
    fluxBuf: new Float32Array(480),
    bufIdx: 0,
    bufFilled: 0,

    bpm: 0,
    rawBpm: 0,
    instantBpm: 0,
    bpmHistory: [],
    lastConfidence: 0,

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
    rejectCount: 0,      // consecutive outlier rejections
    bpmTarget: 0,        // last credible smoothing target
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
    s.bpmHistory = [];
    s.lastConfidence = 0;
    s.emaCorrs = null;
    s.smoothCorrs = null;
    s.bestLag = 0;
    s.interpLag = 0;
    s.maxLag = 0;
    s.debugRefinedLag = 0;
    s.rejectCount = 0;
    s.bpmTarget = 0;
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
        lastConfidence: s.lastConfidence,
        bestLag: s.bestLag,
        interpLag: s.interpLag,
        maxLag: s.maxLag,
        lastCorrMax: lastCorrMax,
        debugRefinedLag: s.debugRefinedLag,
        debugPeakCount: s.debugPeakCount,
        debugTroughCount: s.debugTroughCount,
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
        if (dt > 0.1) {
            const instantRate = s.frameCount / dt;
            s.sampleRate = 0.7 * s.sampleRate + 0.3 * instantRate;
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
    // Triangular kernel [1,2,3,2,1]/9
    if (!s.smoothCorrs) {
        s.smoothCorrs = new Float32Array(s.bufLen);
    }
    const ec = s.emaCorrs;
    s.smoothCorrs[0] = ec[0];
    s.smoothCorrs[1] = ec[1];
    s.smoothCorrs[s.bufLen - 1] = ec[s.bufLen - 1];
    s.smoothCorrs[s.bufLen - 2] = ec[s.bufLen - 2];
    for (let i = 2; i < s.bufLen - 2; i++) {
        s.smoothCorrs[i] = (ec[i-2] + 2*ec[i-1] + 3*ec[i] + 2*ec[i+1] + ec[i+2]) / 9;
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
        // within ±1.5 samples. Uses prominence to ignore noise peaks.
        // Normalised by globalMax so scores reflect structural support
        // (is the harmonic pattern there?) not absolute peak magnitude.
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

        // Score peaks by contiguous subdivision depth: count how many
        // binary subdivisions (lag/2, lag/4, lag/8) have peak support
        // without interruption. Short-circuits on first failure —
        // prevents trough candidates from accumulating partial scores
        // at higher subdivisions via phase-halving alignment.
        // Prominence tiebreaks within the same depth level.
        const minLag = Math.round(s.sampleRate * 60 / 200);

        // Prior bias: when stably locked, gently favour the current lag's
        // neighbourhood to resist transient noise. Lightweight alternative
        // to full Bayesian tracking — just a small additive bonus that
        // can't promote a candidate to the next depth level (depths are
        // integers), only break ties within the same level.
        const priorLag = s.bestLag;
        const hasPrior = priorLag > 0 && s.bpm > 0 && s.lastConfidence > 0.2;

        let bestLag = 0;
        let bestScore = -Infinity;
        const topN = [];  // top scored candidates for debug visualisation
        for (const pk of peaks) {
            if (pk.idx < minLag || pk.idx > maxLag) continue;
            if (pk.prominence <= 0) continue;
            // Contiguous binary subdivision chain: lag → lag/2 → lag/4 → lag/8
            // Each level halves the lag and requires a peak; short-circuits
            // on first failure. Depth 0 rejects troughs, 1 rejects odd peaks,
            // 2 rejects 6T, 3 rejects 12T, 4 accepts only 8T/16T.
            let depth = 0;
            if (subdivSupport(pk.idx) > 0) {
                depth = 1;
                if (subdivSupport(pk.idx / 2) > 0) {
                    depth = 2;
                    if (subdivSupport(pk.idx / 4) > 0) {
                        depth = 3;
                        if (pk.idx / 8 >= 4 && subdivSupport(pk.idx / 8) > 0) {
                            depth = 4;
                        }
                    }
                }
            }
            // Favour longer lags: same absolute estimation error gives
            // proportionally smaller BPM error at longer lags. Lag-length
            // bonus dominates tiebreak; prominence is minor insurance
            // against noise-floor candidates.
            let score = depth + 0.5 * pk.idx / maxLag
                              + 0.05 * pk.prominence / norm;
            if (hasPrior && Math.abs(pk.idx - priorLag) / priorLag < 0.1) {
                score += 0.15;
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
        s.topScores = topN;
        let bestCorr = bestLag > 0 ? Math.max(0, sc[bestLag]) : 0;

        if (bestLag > 0) {
            s.bestLag = bestLag;

            // Use lag/2 for interpolation — sharper than full lag but safe
            // from the ±0.5 sample limit of Gaussian interpolation.
            let interpLag = bestLag;
            const findSubPeak = (divLag) => {
                const est = Math.round(divLag);
                const lo = Math.max(4, est - 2);
                const hi = Math.min(sc.length - 2, est + 2);
                let best = 0, bestVal = 0;
                for (let q = lo; q <= hi; q++) {
                    if (sc[q] > bestVal && sc[q] > sc[q - 1] && sc[q] > sc[q + 1]) {
                        bestVal = sc[q];
                        best = q;
                    }
                }
                if (best > 0) {
                    const dip = Math.min(sc[best - 1], sc[best + 1]);
                    if (dip > bestVal * 0.95) return 0;  // plateau, not a peak
                }
                return best;
            };
            const q2 = findSubPeak(bestLag / 2);
            if (q2 > 0) interpLag = q2;
            s.interpLag = interpLag;

            // Sub-lag BPM precision: Gaussian interpolation when all three
            // points are positive, else parabolic (handles negative baselines)
            let refinedLag = interpLag;
            if (interpLag > 3 && interpLag < sc.length - 1) {
                const prev = sc[interpLag - 1];
                const peak = sc[interpLag];
                const next = sc[interpLag + 1];
                if (prev > 0 && peak > 0 && next > 0) {
                    const lnPrev = Math.log(prev);
                    const lnPeak = Math.log(peak);
                    const lnNext = Math.log(next);
                    const denom = 2 * (2 * lnPeak - lnPrev - lnNext);
                    if (denom > 0) {
                        const offset = (lnPrev - lnNext) / denom;
                        refinedLag = interpLag + Math.max(-0.5, Math.min(0.5, offset));
                    }
                } else {
                    const denom = 2 * (2 * peak - prev - next);
                    if (denom > 0) {
                        const offset = (prev - next) / denom;
                        refinedLag = interpLag + Math.max(-0.5, Math.min(0.5, offset));
                    }
                }
            }
            s.debugRefinedLag = refinedLag;
            let detectedBpm = s.sampleRate * 60 / refinedLag;
            s.unfoldedBpm = detectedBpm;
            while (detectedBpm < 90) detectedBpm *= 2;
            while (detectedBpm > 200) detectedBpm /= 2;
            s.instantBpm = detectedBpm;

            const confidence = Math.max(0, Math.min(1, bestCorr / (energy * 0.3)));
            s.lastConfidence = confidence;

            // Outlier rejection: skip flywheel when detectedBpm jumps >20%
            // from a stable estimate. Octave-normalize first so dithering
            // across a folding boundary (e.g. 90.6→89.4→178.8) doesn't
            // appear as a ~100% step change.
            // After 5 consecutive rejections, accept as genuine tempo change.
            // Compare to s.bpmTarget to avoid issues with s.bpm lagging
            let compareBpm = detectedBpm;
            while (compareBpm > s.bpmTarget * 1.41) compareBpm /= 2;
            while (compareBpm < s.bpmTarget * 0.71) compareBpm *= 2;
            if (s.bpmTarget > 0 && Math.abs(compareBpm - s.bpmTarget) / s.bpmTarget > 0.2) {
                s.rejectCount++;
                if (s.rejectCount >= 5) {
                    s.bpmTarget = detectedBpm;
                    s.rawBpm = detectedBpm;
                    s.bpmHistory = [];
                    s.rejectCount = 0;
                } else {
                    s.skipReason = 'Outlier rejected (' + s.rejectCount + '/5, detected=' + detectedBpm.toFixed(1) + ')';
                }
                return;
            }
            s.rejectCount = 0;

            // Confidence-weighted flywheel
            if (s.bpm > 0) {
                s.rawBpm = detectedBpm * confidence + s.bpm * (1 - confidence);
            } else {
                s.rawBpm = detectedBpm;
            }
        }

        // Update target from median-filtered flywheel output
        if (s.rawBpm > 0) {
            if (s.bpm === 0 && (s.corrCount < 8 || s.lastConfidence < 0.15)) {
                s.skipReason = 'Waiting (' + s.corrCount + '/8 passes, conf=' + s.lastConfidence.toFixed(3) + ')';
                return;
            }

            s.bpmHistory.push(s.rawBpm);
            if (s.bpmHistory.length > 9) s.bpmHistory.shift();
            const sorted = [...s.bpmHistory].sort((a, b) => a - b);
            s.bpmTarget = sorted[Math.floor(sorted.length / 2)];
        }
        s.skipReason = '';
    } finally {
        // Display smoothing: always continues toward last target,
        // even during outlier rejection or noisy passes
        if (s.bpmTarget > 0) {
            if (s.bpm === 0) {
                s.bpm = s.bpmTarget;
            } else {
                const a = Math.abs(s.bpmTarget - s.bpm) > 1 ? 0.6 : 0.2;
                s.bpm += (s.bpmTarget - s.bpm) * a;
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
