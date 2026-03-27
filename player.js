// player.js - Core Playback (Streams & Mix Audio Control)
// Waveform code is in player-mix.js

// Custom audio controls
const playPauseBtn = document.getElementById('playPauseBtn');
const muteBtn = document.getElementById('muteBtn');
const volumeSlider = document.getElementById('volumeSlider');
const timeDisplay = document.getElementById('timeDisplay');

// Restore volume slider from persisted level (actual gain applied in ensureAudioContext)
volumeSlider.value = volume.get() * 100;

// Unified paused check — works for both streams and mixes
function isPlaybackPaused() {
  return state.isStream
    ? (state.userPausedStream || !streamIsActive())
    : aud.paused;
}

// Update time display
function updateTimeDisplay() {
  const current = formatTime(aud.currentTime);
  if (state.isStream) {
    const isPaused = isPlaybackPaused();
    timeDisplay.textContent = isPaused ? 'PAUSED' : `LIVE  ${current}`;
    timeDisplay.classList.toggle('live', !isPaused);
  } else {
    const duration = formatTime(aud.duration);
    timeDisplay.textContent = `${current} / ${duration}`;
    timeDisplay.classList.remove('live');
  }
}

// Update play/pause button icon
function updatePlayPauseBtn() {
  const isPaused = isPlaybackPaused();
  playPauseBtn.textContent = isPaused ? '▶' : '❚❚';
  playPauseBtn.className = 'control-btn ' + (isPaused ? 'paused' : 'playing');
}

// Update mute button icon
function updateMuteBtn() {
  const level = volume.get();
  if (volume.isMuted() || level === 0) {
    muteBtn.textContent = '🔇';
  } else if (level < 0.5) {
    muteBtn.textContent = '🔉';
  } else {
    muteBtn.textContent = '🔊';
  }
}

// Stream pause: stop MSE player (stops downloading)
function pauseStream() {
  state.userPausedStream = true;
  streamStop();
  stopVisualiser();
  stopTempo();
  updatePlayPauseBtn();
  updateTimeDisplay();
  if (!state.isRestoring) {
    storage.set('wasPlaying', false);
  }
}

// Stream resume: restart MSE player
function resumeStream() {
  state.userPausedStream = false;
  if (state.streamUrl) {
    ensureAudioContext();
    streamPlay(state.streamUrl, state.streamDisplayText);
    startVisualiser();
    startTempo();
    updatePlayPauseBtn();
    updateTimeDisplay();
    if (!state.isRestoring) {
      storage.set('wasPlaying', true);
    }
  }
}

// Stream reconnection is handled by IcecastMetadataPlayer (MSE)
// which has built-in retry with exponential back-off and seamless audio buffering.

// Start playing a stream via MSE
function playStream(url, displayText, autoplay = false) {
  timeDisplay.title = decodeURIComponent(url);
  state.isStream = true;
  state.userPausedStream = false;
  state.streamUrl = url;
  state.streamDisplayText = displayText;
  storage.set('streamUrl', url);
  storage.set('streamDisplayText', displayText);
  
  // Update now playing display
  const nowPlaying = document.getElementById('nowPlaying');
  if (nowPlaying) {
    nowPlaying.innerHTML = `<h1>${escapeHtml(displayText)}</h1>`;
  }
  
  document.title = 'Live - Player';

  if (autoplay) {
    ensureAudioContext();
    streamPlay(url, displayText);
    startVisualiser();
    startTempo();
  }
  
  updateTimeDisplay();
  updatePlayPauseBtn();
  
  // Notify other modules (e.g., player-mix.js) that stream started
  document.dispatchEvent(new CustomEvent('streamModeEntered', {
    detail: { url, displayText }
  }));
}

// Stop stream and return to normal mode
function stopStream() {
  if (state.isStream) {
    pauseStream();
    state.isStream = false;
    state.streamUrl = null;
    state.streamDisplayText = null;
    storage.remove('streamUrl');
    storage.remove('streamDisplayText');
    updateTimeDisplay();
    updatePlayPauseBtn();
  }
}

// Play/Pause button click — unified for both streams and mixes
playPauseBtn?.addEventListener('click', function(e) {
  if (isPlaybackPaused()) {
    if (state.isStream) {
      resumeStream();
    } else {
      ensureAudioContext();
      aud.play().catch(() => {});
      startVisualiser();
      startTempo();
    }
  } else {
    if (state.isStream) {
      pauseStream();
    } else {
      aud.pause();
      stopVisualiser();
      stopTempo();
    }
  }
});

// Mute button click
muteBtn.addEventListener('click', function() {
  volume.toggleMute();
  updateMuteBtn();
});

// Volume slider change
volumeSlider.addEventListener('input', function() {
  volume.set(this.value / 100);
  volumeSlider.value = volume.get() * 100;
  updateMuteBtn();
});

// Audio element events (just for UI, not for state tracking)
aud.addEventListener('play', () => {
  updatePlayPauseBtn();
  updateTimeDisplay();
  if (!state.isRestoring && !state.isStream) {
    storage.set('wasPlaying', true);
  }
});
aud.addEventListener('pause', () => {
  updatePlayPauseBtn();
  updateTimeDisplay();
  if (!state.isRestoring && !state.isStream) {
    storage.set('wasPlaying', false);
  }
});
aud.addEventListener('timeupdate', updateTimeDisplay);
aud.addEventListener('loadedmetadata', updateTimeDisplay);
aud.addEventListener('durationchange', updateTimeDisplay);

// Diagnostic: track duration changes to detect shrinking duration
let _lastKnownDuration = 0;
aud.addEventListener('durationchange', () => {
  const d = aud.duration;
  if (isFinite(d) && isFinite(_lastKnownDuration) && _lastKnownDuration > 0 && d < _lastKnownDuration - 1) {
    console.error('DURATION SHRUNK', { from: _lastKnownDuration, to: d, currentTime: aud.currentTime, src: aud.currentSrc });
  }
  if (isFinite(d)) _lastKnownDuration = d;
});
aud.addEventListener('loadstart', () => { _lastKnownDuration = 0; });

// Keep HTML element at full volume — all gain control via Web Audio gainNode
aud.addEventListener("volumechange", function () {
  if (aud.volume < 1) aud.volume = 1;
  if (aud.muted) aud.muted = false;
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
  // For streams, the browser fires aud 'pause' during unload which
  // incorrectly sets wasPlaying=false. Override with the actual stream state.
  if (state.isStream) {
    storage.set('wasPlaying', !isPlaybackPaused());
  }
});

aud.addEventListener("ended", async function () {
   // Diagnostic: detect premature end (> 60s before expected duration)
   if (!state.isStream && aud.duration && isFinite(aud.duration) && aud.currentTime < aud.duration - 60) {
     const bufRanges = [];
     for (let i = 0; i < aud.buffered.length; i++) bufRanges.push([aud.buffered.start(i), aud.buffered.end(i)]);
     console.error('PREMATURE END', {
       currentTime: aud.currentTime,
       duration: aud.duration,
       readyState: aud.readyState,
       networkState: aud.networkState,
       error: aud.error && { code: aud.error.code, message: aud.error.message },
       buffered: bufRanges,
       src: aud.currentSrc
     });
   }
   stopVisualiser();
   stopTempo();
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

async function load(url) {
  // Stop MSE player if active (important when exiting stream mode)
  await streamStop();
  aud.pause();
  stopVisualiser();
  stopTempo();
  
  // Exit stream mode when loading regular content
  if (state.isStream) {
    state.isStream = false;
    state.streamUrl = null;
    state.streamDisplayText = null;
    storage.remove('streamUrl');
    storage.remove('streamDisplayText');
    updateTimeDisplay();
  }
  aud.src = url;
  aud.currentTime = 0;
}

async function play(url) {
  timeDisplay.title = decodeURIComponent(url);
  await load(url);
  ensureAudioContext();
  aud.play();
  startVisualiser();
  startTempo();
}

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    playPauseBtn.click();
  }
  // Escape is handled by modals.js
});
