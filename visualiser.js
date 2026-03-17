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
// TEMPO TRACKER (PLL-based beat detection)
// ============================================

const tempo = {
    // PLL state
    phase: 0,           // 0..1 cycle position
    freq: 2.1,          // beats per second (initial guess ~126 BPM)
    lastTime: 0,        // last frame timestamp (seconds)
    bpm: 0,             // displayed BPM (smoothed)

    // Onset detector: fast/slow envelope comparison
    fastEnv: 0,         // fast-attack envelope (tracks transients)
    slowEnv: 0,         // slow envelope (tracks average level)
    wasAbove: false,    // edge detection: were we above threshold last frame?
    peakCooldown: 0,    // minimum frames between detected beats

    // PLL tuning
    phaseGain: 0.15,    // how strongly beats correct phase
    freqGain: 0.008,    // how strongly beats correct frequency

    reset() {
        this.phase = 0;
        this.freq = 2.1;
        this.lastTime = 0;
        this.bpm = 0;
        this.fastEnv = 0;
        this.slowEnv = 0;
        this.wasAbove = false;
        this.peakCooldown = 0;
    },

    update(freqData, now) {
        if (!this.lastTime) { this.lastTime = now; return; }
        const dt = now - this.lastTime;
        this.lastTime = now;
        if (dt <= 0 || dt > 0.5) return; // skip glitches

        // Use lowest 2 bins only (kick fundamental, up to ~344Hz)
        const raw = (freqData[0] + freqData[1]) / (2 * 255);

        // Fast envelope (attack ~20ms, release ~50ms at 60fps)
        const fastUp = 0.6, fastDown = 0.15;
        this.fastEnv += (raw > this.fastEnv ? fastUp : fastDown) * (raw - this.fastEnv);

        // Slow envelope (tracks average level, ~500ms time constant)
        this.slowEnv += 0.02 * (raw - this.slowEnv);

        // Advance PLL phase
        this.phase += this.freq * dt;
        if (this.phase >= 1) this.phase -= 1;

        // Onset: fast envelope crosses above slow envelope + margin
        const threshold = this.slowEnv + 0.08;
        const isAbove = this.fastEnv > threshold && raw > 0.1;

        if (this.peakCooldown > 0) {
            this.peakCooldown--;
        } else if (isAbove && !this.wasAbove) {
            // Rising edge — beat detected
            let phaseError = -this.phase;
            if (phaseError < -0.5) phaseError += 1;
            if (phaseError > 0.5) phaseError -= 1;

            // Correct PLL
            this.phase += phaseError * this.phaseGain;
            if (this.phase < 0) this.phase += 1;
            if (this.phase >= 1) this.phase -= 1;
            this.freq += phaseError * this.freqGain;

            // Clamp to reasonable BPM range (70-200 BPM)
            this.freq = Math.max(70 / 60, Math.min(200 / 60, this.freq));

            // Cooldown: ~60% of current beat period
            this.peakCooldown = Math.round(0.6 / this.freq * 60);
        }
        this.wasAbove = isAbove;

        // Update display BPM
        const instantBpm = this.freq * 60;
        if (this.bpm === 0) {
            this.bpm = instantBpm;
        } else {
            this.bpm += (instantBpm - this.bpm) * 0.02;
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
                bpmDisplay.textContent = tempo.bpm.toFixed(1) + ' BPM';
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
    tempo.reset();
    bpmDisplay.style.display = 'none';
    bpmDisplay.textContent = '';
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
