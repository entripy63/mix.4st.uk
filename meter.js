// meter.js - EBU R128 output level meter (post volume control)
// Dependencies: core.js (audioCtx, gainNode, storage)
// Draws a horizontal loudness bar on #meterCanvas, positioned below the waveform.

const meterCanvas = document.getElementById('meterCanvas');
const meterCtx = meterCanvas.getContext('2d');

let meterNode = null;        // AudioWorkletNode
let meterAnimId = null;
let meterEnabled = storage.getBool('meterEnabled', false);

// Latest readings from the worklet
let meterMomentary = -Infinity;   // LUFS
let meterShortTerm = -Infinity;   // LUFS
let meterPeakDB = -Infinity;      // dBFS (sample peak)

// Smoothed display values (for visual smoothing)
let meterDispMom = -60;
let meterDispST = -60;

// Scale range
const METER_MIN = -60;  // LUFS floor
const METER_MAX = 0;    // LUFS ceiling

// Resize canvas to match waveform width
function resizeMeterCanvas() {
  const wf = document.getElementById('waveform');
  const w = wf ? wf.width : meterCanvas.parentElement.clientWidth;
  const dpr = window.devicePixelRatio || 1;
  const cssW = meterCanvas.clientWidth || meterCanvas.parentElement.clientWidth;
  const cssH = meterCanvas.clientHeight || 14;
  if (meterCanvas.width !== Math.round(cssW * dpr) || meterCanvas.height !== Math.round(cssH * dpr)) {
    meterCanvas.width = Math.round(cssW * dpr);
    meterCanvas.height = Math.round(cssH * dpr);
    meterCtx.scale(dpr, dpr);
  }
}

// Connect the meter worklet node into the audio graph
async function initMeterNode() {
  if (meterNode || !audioCtx || !gainNode) return;
  try {
    await audioCtx.audioWorklet.addModule('meter-processor.js');
    meterNode = new AudioWorkletNode(audioCtx, 'meter-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 2,
      channelCountMode: 'explicit'
    });
    // Insert between gainNode and destination:
    // gainNode was connected to destination; rewire to gainNode → meterNode → destination
    gainNode.disconnect(audioCtx.destination);
    gainNode.connect(meterNode);
    meterNode.connect(audioCtx.destination);

    meterNode.port.onmessage = (e) => {
      meterMomentary = e.data.momentary;
      meterShortTerm = e.data.shortTerm;
      meterPeakDB = e.data.peakDB;
    };
  } catch (err) {
    console.warn('Meter worklet init failed:', err);
    // Fallback: reconnect gain directly
    try { gainNode.connect(audioCtx.destination); } catch { /* already connected */ }
  }
}

// Map LUFS to 0..1 position on the meter bar
function lufsToX(lufs) {
  if (!isFinite(lufs) || lufs <= METER_MIN) return 0;
  if (lufs >= METER_MAX) return 1;
  return (lufs - METER_MIN) / (METER_MAX - METER_MIN);
}

// Draw the meter
function drawMeter() {
  meterAnimId = requestAnimationFrame(drawMeter);

  const dpr = window.devicePixelRatio || 1;
  const w = meterCanvas.width / dpr;
  const h = meterCanvas.height / dpr;

  meterCtx.clearRect(0, 0, w, h);

  // Smooth towards current values (fast attack, slower release)
  const momTarget = isFinite(meterMomentary) ? Math.max(METER_MIN, meterMomentary) : METER_MIN;
  const stTarget = isFinite(meterShortTerm) ? Math.max(METER_MIN, meterShortTerm) : METER_MIN;

  // Attack: fast (0.3), Release: slow (0.05)
  const atkMom = momTarget > meterDispMom ? 0.4 : 0.08;
  const atkST = stTarget > meterDispST ? 0.3 : 0.06;
  meterDispMom += (momTarget - meterDispMom) * atkMom;
  meterDispST += (stTarget - meterDispST) * atkST;

  // Background track
  meterCtx.fillStyle = '#1a1a2e';
  meterCtx.fillRect(0, 0, w, h);

  // Scale markings
  const marks = [-48, -36, -24, -18, -12, -9, -6, -3, 0];
  meterCtx.fillStyle = '#3d3d5c';
  meterCtx.font = '8px monospace';
  meterCtx.textAlign = 'center';
  meterCtx.textBaseline = 'bottom';
  for (const db of marks) {
    const x = lufsToX(db) * w;
    // Tick mark
    meterCtx.fillStyle = '#3d3d5c';
    meterCtx.fillRect(x, 0, 1, h);
    // Label (only show select labels to avoid clutter)
    if (db === -24 || db === -12 || db === -6 || db === 0) {
      meterCtx.fillStyle = '#666';
      meterCtx.fillText(db.toString(), x, h - 1);
    }
  }

  // Momentary loudness bar
  const momX = lufsToX(meterDispMom) * w;
  if (momX > 0) {
    const grad = meterCtx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#3949ab');                          // deep blue (quiet)
    grad.addColorStop(lufsToX(-18), '#5c6bc0');               // indigo (normal)
    grad.addColorStop(lufsToX(-9), '#ffb74d');                // amber (loud)
    grad.addColorStop(lufsToX(-3), '#ef5350');                // red (hot)
    grad.addColorStop(lufsToX(0), '#d32f2f');                 // deep red (clip)
    meterCtx.fillStyle = grad;
    meterCtx.fillRect(0, 1, momX, h - 5);
  }

  // Short-term marker line (thin bright line)
  const stX = lufsToX(meterDispST) * w;
  if (stX > 1) {
    meterCtx.fillStyle = '#e0e0e0';
    meterCtx.fillRect(stX - 1, 0, 2, h - 3);
  }

  // LUFS readout (right-aligned)
  const readout = isFinite(meterMomentary) && meterMomentary > METER_MIN
    ? meterMomentary.toFixed(1)
    : '—';
  meterCtx.fillStyle = '#aaa';
  meterCtx.font = '11px monospace';
  meterCtx.textAlign = 'right';
  meterCtx.textBaseline = 'middle';
  meterCtx.fillText(readout + ' LUFS', w - 2, h / 2);
}

function startMeter() {
  if (!meterEnabled) return;
  if (meterAnimId) return;
  if (!audioCtx || !gainNode) return;

  resizeMeterCanvas();
  initMeterNode().then(() => {
    if (!meterAnimId && meterEnabled) drawMeter();
  });
}

function stopMeter() {
  if (meterAnimId) {
    cancelAnimationFrame(meterAnimId);
    meterAnimId = null;
  }
  meterMomentary = -Infinity;
  meterShortTerm = -Infinity;
  meterPeakDB = -Infinity;
  meterDispMom = METER_MIN;
  meterDispST = METER_MIN;
  meterCtx.clearRect(0, 0, meterCanvas.width, meterCanvas.height);
}

function pauseMeter() {
  // Keep last frame visible, just stop animation
  if (meterAnimId) {
    cancelAnimationFrame(meterAnimId);
    meterAnimId = null;
  }
}

function setMeterEnabled(enabled) {
  meterEnabled = enabled;
  storage.set('meterEnabled', enabled);
  meterCanvas.style.display = enabled ? '' : 'none';

  if (enabled && audioCtx && !isPlaybackPaused()) {
    startMeter();
  } else if (!enabled) {
    stopMeter();
  }
}

// Show/hide canvas based on initial setting
meterCanvas.style.display = meterEnabled ? '' : 'none';
