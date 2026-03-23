// visualiser.js - Live stream audio visualisation (spectrum/waveform)
// Dependencies: core.js (state, storage, aud), tempo.js (tempo)

const visCanvas = document.getElementById("waveform");
const visCtx = visCanvas.getContext("2d");

let audioCtx = null;
let analyserNode = null;
let audioSourceNode = null;
let visualiserAnimId = null;
let visualiserMode = 'spectrum'; // 'spectrum' or 'waveform'

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
    if (visualiserAnimId) return;
    if (!storage.getBool('visualiserEnabled', true)) return;
    ensureAudioContext();
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    visCanvas.style.cursor = 'pointer';
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
    visCanvas.style.cursor = '';
}

// Click canvas to toggle between spectrum and waveform when live
visCanvas.addEventListener('click', (e) => {
    if (!state.isLive || !visualiserAnimId) return;
    e.preventDefault();
    e.stopPropagation();
    const modes = storage.getBool('bpmEnabled', true)
        ? ['spectrum', 'waveform', 'flux', 'autocorr']
        : ['spectrum', 'waveform'];
    const idx = modes.indexOf(visualiserMode);
    visualiserMode = modes[((idx === -1 ? 0 : idx) + 1) % modes.length];
});
