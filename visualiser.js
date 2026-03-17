// visualiser.js - Live stream audio visualisation (spectrum/waveform)
// Dependencies: core.js (state, storage, aud)

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
    audioSourceNode = audioCtx.createMediaElementSource(aud);
    audioSourceNode.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);
}

function startVisualiser() {
    if (!storage.getBool('visualiserEnabled', true)) return;
    ensureAudioContext();
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    if (visualiserAnimId) return;
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
        } else {
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
}

// Click canvas to toggle between spectrum and waveform when live
visCanvas.addEventListener('click', (e) => {
    if (!state.isLive || !visualiserAnimId) return;
    e.preventDefault();
    e.stopPropagation();
    visualiserMode = visualiserMode === 'spectrum' ? 'waveform' : 'spectrum';
});

aud.addEventListener('playing', () => {
    if (state.isLive) startVisualiser();
    else stopVisualiser();
});

aud.addEventListener('pause', () => {
    if (state.isLive) stopVisualiser();
});
