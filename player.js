// player.js - Playback Controls & Waveform

// Set canvas resolution to match CSS size
function resizeWaveformCanvas() {
  if (!waveformCanvas) return; // No waveform in live.html
  const w = waveformCanvas.offsetWidth || 500;
  const h = waveformCanvas.offsetHeight || 60;
  if (waveformCanvas.width !== w) waveformCanvas.width = w;
  if (waveformCanvas.height !== h) waveformCanvas.height = h;
  if (state.currentPeaks) {
    const progress = aud.duration ? aud.currentTime / aud.duration : 0;
    drawWaveform(state.currentPeaks, progress);
  }
}
if (waveformCanvas) {
  resizeWaveformCanvas();
  window.addEventListener('load', resizeWaveformCanvas);
}

function drawWaveform(peaks, progress = 0) {
  if (!waveformCanvas || !waveformCtx) return; // No waveform in live.html
  const w = waveformCanvas.width;
  const h = waveformCanvas.height;
  const barWidth = w / peaks.length;
  
  waveformCtx.clearRect(0, 0, w, h);
  
  peaks.forEach((peak, i) => {
    const x = i * barWidth;
    const barHeight = peak * h * 0.9;
    const y = (h - barHeight) / 2;
    
    // Played portion in accent color, unplayed in muted
    const playedX = w * progress;
    waveformCtx.fillStyle = x < playedX ? '#5c6bc0' : '#3d3d5c';
    waveformCtx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight);
  });
  
  // Draw cursor line
  if (progress > 0) {
    const cursorX = w * progress;
    waveformCtx.strokeStyle = '#fff';
    waveformCtx.lineWidth = 2;
    waveformCtx.beginPath();
    waveformCtx.moveTo(cursorX, 0);
    waveformCtx.lineTo(cursorX, h);
    waveformCtx.stroke();
  }
}

function updateWaveformCursor() {
  if (state.currentPeaks && aud.duration) {
    const progress = aud.currentTime / aud.duration;
    drawWaveform(state.currentPeaks, progress);
  }
}

// Update waveform cursor on audio events
aud.addEventListener('timeupdate', updateWaveformCursor);
aud.addEventListener('seeked', updateWaveformCursor);

// Click on waveform to seek
if (waveformCanvas) {
  waveformCanvas.addEventListener('click', function(e) {
    if (aud.duration) {
      const rect = waveformCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const progress = x / waveformCanvas.width;
      aud.currentTime = progress * aud.duration;
      updateWaveformCursor();
    }
  });
}

// Initialize with empty waveform
state.currentPeaks = null;
if (waveformCanvas) drawWaveform([], 0);

// Waveform resize handling
const resizeHandle = document.getElementById('waveformResizeHandle');

// Restore saved height
if (waveformCanvas) {
  const savedHeight = storage.getNum('waveformHeight', 0);
  if (savedHeight) {
    waveformCanvas.style.height = savedHeight + 'px';
    waveformCanvas.height = savedHeight;
  }
}

if (resizeHandle) {
  resizeHandle.addEventListener('mousedown', startResize);
  resizeHandle.addEventListener('touchstart', startResize, { passive: false });
}

function startResize(e) {
  e.preventDefault();
  state.isResizing = true;
  document.addEventListener('mousemove', doResize);
  document.addEventListener('mouseup', stopResize);
  document.addEventListener('touchmove', doResize, { passive: false });
  document.addEventListener('touchend', stopResize);
}

function doResize(e) {
  if (!state.isResizing || !waveformCanvas) return;
  e.preventDefault();
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const rect = waveformCanvas.getBoundingClientRect();
  let newHeight = clientY - rect.top;
  newHeight = Math.max(30, Math.min(200, newHeight));
  waveformCanvas.style.height = newHeight + 'px';
  waveformCanvas.height = newHeight;
  if (state.currentPeaks) drawWaveform(state.currentPeaks, aud.currentTime / aud.duration || 0);
}

function stopResize() {
  if (!state.isResizing) return;
  state.isResizing = false;
  document.removeEventListener('mousemove', doResize);
  document.removeEventListener('mouseup', stopResize);
  document.removeEventListener('touchmove', doResize);
  document.removeEventListener('touchend', stopResize);
  if (waveformCanvas) storage.set('waveformHeight', waveformCanvas.height);
}

function loadPeaks(peaks) {
  if (peaks && peaks.length > 0) {
    state.currentPeaks = peaks;
    drawWaveform(state.currentPeaks, 0);
  } else {
    state.currentPeaks = null;
    if (waveformCtx && waveformCanvas) waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
  }
}

// Custom audio controls
const playPauseBtn = document.getElementById('playPauseBtn');
const muteBtn = document.getElementById('muteBtn');
const volumeSlider = document.getElementById('volumeSlider');
const timeDisplay = document.getElementById('timeDisplay');

// Restore volume from localStorage, default to 50%
aud.volume = storage.getNum('playerVolume', 0.5);
volumeSlider.value = aud.volume * 100;

// Update time display
function updateTimeDisplay() {
  if (state.isLive) {
    const isPaused = aud.paused || !aud.src;
    timeDisplay.textContent = isPaused ? 'PAUSED' : 'LIVE';
    timeDisplay.classList.toggle('live', !isPaused);
  } else {
    const current = formatTime(aud.currentTime);
    const duration = formatTime(aud.duration);
    timeDisplay.textContent = `${current} / ${duration}`;
    timeDisplay.classList.remove('live');
  }
}

// Update play/pause button icon
function updatePlayPauseBtn() {
  const isPaused = state.isLive ? (aud.paused || !aud.src) : aud.paused;
  playPauseBtn.textContent = isPaused ? '▶' : '❚❚';
  playPauseBtn.className = 'control-btn ' + (isPaused ? 'paused' : 'playing');
}

// Update mute button icon
function updateMuteBtn() {
  if (aud.muted || aud.volume === 0) {
    muteBtn.textContent = '🔇';
  } else if (aud.volume < 0.5) {
    muteBtn.textContent = '🔉';
  } else {
    muteBtn.textContent = '🔊';
  }
}

// Live stream pause: stop downloading by clearing src
function pauseLive() {
  aud.pause();
  aud.src = '';
  aud.removeAttribute('src');
  setTimeout(() => aud.load(), 0);
  updatePlayPauseBtn();
  updateTimeDisplay();
  if (!state.isRestoring) {
    storage.set('wasPlaying', false);
  }
}

// Live stream resume: restore src and play
function resumeLive() {
  if (state.liveStreamUrl) {
    aud.src = state.liveStreamUrl;
    aud.load();
    // Wait for canplay before playing
    const handleCanPlay = () => {
      aud.play();
      aud.removeEventListener('canplay', handleCanPlay);
    };
    aud.addEventListener('canplay', handleCanPlay, { once: true });
    // Fallback in case canplay never fires
    setTimeout(() => {
      if (!aud.paused) return;
      aud.play().catch(() => {});
    }, 100);
    updatePlayPauseBtn();
    updateTimeDisplay();
    if (!state.isRestoring) {
      storage.set('wasPlaying', true);
    }
  }
}

// Start playing a live stream
function playLive(url, displayText, autoplay = false) {
  state.isLive = true;
  state.liveStreamUrl = url;
  state.liveDisplayText = displayText;
  storage.set('liveStreamUrl', url);
  storage.set('liveDisplayText', displayText);
  storage.remove('currentMixPath');
  aud.src = url;
  aud.load();
  if (autoplay) {
    const handleCanPlay = () => {
      aud.play();
      aud.removeEventListener('canplay', handleCanPlay);
    };
    aud.addEventListener('canplay', handleCanPlay, { once: true });
    // Fallback in case canplay never fires
    setTimeout(() => {
      if (!aud.paused) return;
      aud.play().catch(() => {});
    }, 100);
  }
  document.getElementById('nowPlaying').innerHTML = `<h1>${escapeHtml(displayText)}</h1>`;
  document.getElementById('coverArt').innerHTML = '';
  document.getElementById('trackList').innerHTML = '';
  document.title = 'Live - Player';
  loadPeaks(null);
  updateTimeDisplay();
  updatePlayPauseBtn();
}

// Stop live stream and return to normal mode
function stopLive() {
  if (state.isLive) {
    pauseLive();
    state.isLive = false;
    state.liveStreamUrl = null;
    state.liveDisplayText = null;
    storage.remove('liveStreamUrl');
    storage.remove('liveDisplayText');
    updateTimeDisplay();
    updatePlayPauseBtn();
  }
}

// Play/Pause button click
playPauseBtn?.addEventListener('click', function(e) {
   if (state.isLive) {
     if (aud.paused) {
       resumeLive();
     } else {
       pauseLive();
     }
   } else {
     if (aud.paused) {
       aud.play();
     } else {
       aud.pause();
     }
   }
 });

// Mute button click
let volumeBeforeMute = 0.5;
muteBtn.addEventListener('click', function() {
  if (aud.muted) {
    aud.muted = false;
  } else {
    volumeBeforeMute = aud.volume;
    aud.muted = true;
  }
});

// Volume slider change
volumeSlider.addEventListener('input', function() {
  aud.volume = this.value / 100;
  aud.muted = false;
});

// Audio element events (just for UI, not for state tracking)
aud.addEventListener('play', () => {
  updatePlayPauseBtn();
  updateTimeDisplay();
  if (!state.isRestoring) {
    storage.set('wasPlaying', true);
  }
});
aud.addEventListener('pause', () => {
  updatePlayPauseBtn();
  updateTimeDisplay();
  if (!state.isRestoring) {
    storage.set('wasPlaying', false);
  }
});
aud.addEventListener('timeupdate', updateTimeDisplay);
aud.addEventListener('loadedmetadata', updateTimeDisplay);
aud.addEventListener('durationchange', updateTimeDisplay);

// Save volume on change and update UI
aud.addEventListener("volumechange", function () {
  storage.set('playerVolume', aud.volume);
  volumeSlider.value = aud.volume * 100;
  updateMuteBtn();
});

// Initialize UI state
updatePlayPauseBtn();
updateMuteBtn();
updateTimeDisplay();

// Save position periodically
setInterval(function () {
  if (aud.src && !aud.paused) {
    storage.set('playerTime', aud.currentTime);
  }
}, 5000);

// Save position on pause and before unload
aud.addEventListener("pause", function () {
  storage.set('playerTime', aud.currentTime);
});
window.addEventListener("beforeunload", function () {
  storage.set('playerTime', aud.currentTime);
  // wasPlaying already saved by play/pause button handler
});

aud.addEventListener("ended", async function () {
   // Handle Play Now mix end based on setting
   if (state.playingFromPlayNow) {
     const setting = storage.get('afterPlayNow', 'stop');
     
     if (setting === 'loop') {
       aud.currentTime = 0;
       aud.play();
       return;
     } else if (setting === 'continue') {
       // Restore previous queue position
       if (state.previousQueueIndex >= 0 && state.previousQueueIndex < state.queue.length) {
         state.currentQueueIndex = state.previousQueueIndex;
         state.playingFromPlayNow = false;
         saveQueue();
         await playFromQueue(state.currentQueueIndex);
         // Try to restore position in the mix
         aud.currentTime = state.previousQueueTime;
       }
       return;
     }
     // else setting === 'stop' - do nothing
     return;
   }
   
   // Normal queue handling
   if (state.currentQueueIndex >= 0 && state.currentQueueIndex < state.queue.length - 1) {
     state.currentQueueIndex++;
     saveQueue();
     await playFromQueue(state.currentQueueIndex);
   } else if (state.loopQueue && state.queue.length > 0) {
     state.currentQueueIndex = 0;
     saveQueue();
     await playFromQueue(state.currentQueueIndex);
   }
});

aud.addEventListener("play", updateQueueInfo);
aud.addEventListener("pause", updateQueueInfo);

function load(url) {
  // Exit live mode when loading regular content
  if (state.isLive) {
    state.isLive = false;
    state.liveStreamUrl = null;
    state.liveDisplayText = null;
    storage.remove('liveStreamUrl');
    storage.remove('liveDisplayText');
    updateTimeDisplay();
  }
  aud.src = url;
  aud.currentTime = 0;
}

function play(url) {
  load(url);
  aud.play();
}
