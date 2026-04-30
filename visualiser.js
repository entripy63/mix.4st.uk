// visualiser.js - Live audio visualisation (spectrum/waveform/flux/autocorr)
// Dependencies: core.js (state, storage, audioCtx, analyserNode), tempo.js (tempo)
// Draws on a separate overlay canvas (#visualiserCanvas) above the peaks waveform.

const visCanvas = document.getElementById("visualiserCanvas");
const visModes = document.getElementById('visualiserModes');
const visCtx = visCanvas.getContext("2d");

let visualiserAnimId = null;
let visualiserMode = storage.get('visualiserMode', 'spectrum');

// Sync overlay canvas resolution to match the peaks canvas beneath it
function resizeVisualiserCanvas() {
    const wf = document.getElementById("waveform");
    const w = wf.width;
    const h = wf.height;
    if (visCanvas.width !== w) visCanvas.width = w;
    if (visCanvas.height !== h) visCanvas.height = h;
}

function startVisualiser() {
    if (visualiserAnimId) return;
    if (visualiserMode === 'off') return;
    if (!storage.getBool('visualiserEnabled', true)) {
        return;
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    resizeVisualiserCanvas();
    const freqData = new Uint8Array(analyserNode.frequencyBinCount);
    const timeData = new Uint8Array(analyserNode.fftSize);

    function drawVisualiser() {
        visualiserAnimId = requestAnimationFrame(drawVisualiser);

        const w = visCanvas.width;
        const h = visCanvas.height;
        visCtx.clearRect(0, 0, w, h);

        if (visualiserMode === 'spectrum') {
            analyserNode.getByteFrequencyData(freqData);
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
            const n = tempo.bufFilled;
            const sliceWidth = w / n;

            // Slow-decay peak scaling
            let bufPeak = 0;
            for (let i = 0; i < n; i++) {
                if (tempo.fluxBuf[i] > bufPeak) bufPeak = tempo.fluxBuf[i];
            }
            tempo.fluxPeak = Math.max(bufPeak, tempo.fluxPeak * 0.995);
            const scale = tempo.fluxPeak || 1;

            // Fixed reference line
            const refY = h - (10 / scale) * h * 0.9;
            visCtx.strokeStyle = '#ffffff30';
            visCtx.lineWidth = 1;
            visCtx.beginPath();
            visCtx.moveTo(0, refY);
            visCtx.lineTo(w, refY);
            visCtx.stroke();

            // Flux time series
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

            // Autocorrelation curve
            visCtx.strokeStyle = '#c5cae9';
            visCtx.lineWidth = 2;
            visCtx.beginPath();
            for (let i = 0; i < n; i++) {
                const val = corrs[i] / scale;
                const y = zeroY - val * zeroY * 0.85;
                const x = i * sliceWidth;
                if (i === 0) visCtx.moveTo(x, y);
                else visCtx.lineTo(x, y);
            }
            visCtx.stroke();

            // SHS score curve (cyan, secondary)
            if (tempo.shsScores && tempo.shsScores.length > 0) {
                const scores = tempo.shsScores;
                const sMinT = tempo.shsScoresMinT;
                const sStep = tempo.shsScoresStep;
                let sMax = 0;
                for (let i = 0; i < scores.length; i++) {
                    const abs = Math.abs(scores[i]);
                    if (abs > sMax) sMax = abs;
                }
                if (sMax > 0) {
                    visCtx.strokeStyle = '#00e5ff99';
                    visCtx.lineWidth = 1;
                    visCtx.beginPath();
                    let started = false;
                    for (let i = 0; i < scores.length; i++) {
                        const lag = sMinT + i * sStep;
                        if (lag > n) break;
                        const x = lag * sliceWidth;
                        const val = scores[i] / sMax;
                        const y = zeroY - val * zeroY * 0.7;
                        if (!started) { visCtx.moveTo(x, y); started = true; }
                        else visCtx.lineTo(x, y);
                    }
                    if (started) visCtx.stroke();
                }
            }

            // SHS fundamental period T: vertical lines at multiples of T
            if (tempo.shsPeriod > 0) {
                const bpmDbg = isTempoDebugEnabled();
                visCtx.strokeStyle = '#c7bf51';
                visCtx.lineWidth = 1;
                visCtx.setLineDash([2, 3]);
                const T = tempo.shsPeriod;
                const lineBottom = bpmDbg ? h - 14 : h;
                for (let m = 1; m * T < n; m++) {
                    const px = m * T * sliceWidth;
                    visCtx.beginPath();
                    visCtx.moveTo(px, 0);
                    visCtx.lineTo(px, lineBottom);
                    visCtx.stroke();
                }
                visCtx.setLineDash([]);

                // Downward arrow marking the periodicity peak (per×T)
                const bestPx = (tempo.shsPer || 4) * T * sliceWidth;
                if (bestPx > 0 && bestPx < w) {
                    visCtx.fillStyle = '#c7bf51';
                    visCtx.beginPath();
                    visCtx.moveTo(bestPx, 8);
                    visCtx.lineTo(bestPx - 4, 0);
                    visCtx.lineTo(bestPx + 4, 0);
                    visCtx.closePath();
                    visCtx.fill();
                }

                if (bpmDbg) {
                    visCtx.font = '10px monospace';
                    visCtx.textAlign = 'left';
                    visCtx.fillStyle = '#ff4081';
                    const pp = tempo.perProms;
                    visCtx.fillText('T=' + tempo.shsPeriod.toFixed(1)
                        + ' div=' + tempo.shsDiv + (tempo.divSrc ? '(' + tempo.divSrc + ')' : '')
                        + ' per=' + tempo.shsPer
                        + (pp ? ' 3h=' + pp[2].toFixed(2) + '/' + pp[3].toFixed(1) : '')
                        + ' dr=' + tempo.divRatio.toFixed(2)
                        + ' sr=' + (tempo.shsSR >= 0 ? tempo.shsSR.toFixed(1) : '-'), 4, h - 3);
                }
            }
        }
    }
    drawVisualiser();
}

function pauseVisualiser() {
    if (visualiserAnimId) {
        cancelAnimationFrame(visualiserAnimId);
        visualiserAnimId = null;
    }
    // Keep last frame visible (no clearRect)
}

function stopVisualiser() {
    if (visualiserAnimId) {
        cancelAnimationFrame(visualiserAnimId);
        visualiserAnimId = null;
    }
    visCtx.clearRect(0, 0, visCanvas.width, visCanvas.height);
}

// Mode button handling
function setVisualiserMode(mode) {
    visualiserMode = mode;
    storage.set('visualiserMode', mode);

    // Update button active states
    document.querySelectorAll('.vis-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.vis === mode);
    });

    if (mode === 'off') {
        stopVisualiser();
    } else if (audioCtx && !aud.paused) {
        // Restart if audio is playing but visualiser was stopped (e.g. was 'off')
        if (!visualiserAnimId) startVisualiser();
    }
}

// Update BPM-only button visibility and container visibility
function updateVisModeButtons() {
    const visEnabled = storage.getBool('visualiserEnabled', true);
    visModes.style.display = visEnabled ? '' : 'none';

    const bpmEnabled = storage.getBool('bpmEnabled', true);
    document.querySelectorAll('.vis-mode-btn.bpm-only').forEach(btn => {
        btn.hidden = !bpmEnabled;
    });
    // If current mode is a bpm-only mode and BPM was just disabled, fall back
    if (!bpmEnabled && (visualiserMode === 'flux' || visualiserMode === 'autocorr')) {
        setVisualiserMode('spectrum');
    }
}

// Initialise mode buttons
document.querySelectorAll('.vis-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setVisualiserMode(btn.dataset.vis));
});

// Set initial button states from persisted mode
document.querySelectorAll('.vis-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.vis === visualiserMode);
});
updateVisModeButtons();
