// player.js - Core Playback (Live Streams & Audio Control)
// Waveform code is in player-mix.js

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
  const current = formatTime(aud.currentTime);
  if (state.isLive) {
    const isPaused = state.userPausedLive || !mseIsActive();
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
  const isPaused = state.isLive ? (state.userPausedLive || !mseIsActive()) : aud.paused;
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

// Live stream pause: stop MSE player (stops downloading)
function pauseLive() {
  state.userPausedLive = true;
  mseStopLive();
  updatePlayPauseBtn();
  updateTimeDisplay();
  if (!state.isRestoring) {
    storage.set('wasPlaying', false);
  }
}

// Live stream resume: restart MSE player
function resumeLive() {
  state.userPausedLive = false;
  if (state.liveStreamUrl) {
    msePlayLive(state.liveStreamUrl, state.liveDisplayText);
    updatePlayPauseBtn();
    updateTimeDisplay();
    if (!state.isRestoring) {
      storage.set('wasPlaying', true);
    }
  }
}

// Live stream reconnection is handled by IcecastMetadataPlayer (MSE)
// which has built-in retry with exponential back-off and seamless audio buffering.

// Start playing a live stream via MSE
function playLive(url, displayText, autoplay = false) {
  state.isLive = true;
  state.userPausedLive = false;
  state.liveStreamUrl = url;
  state.liveDisplayText = displayText;
  storage.set('liveStreamUrl', url);
  storage.set('liveDisplayText', displayText);
  
  // Update now playing display
  const nowPlaying = document.getElementById('nowPlaying');
  if (nowPlaying) {
    nowPlaying.innerHTML = `<h1>${escapeHtml(displayText)}</h1>`;
  }
  
  document.title = 'Live - Player';

  if (autoplay) {
    msePlayLive(url, displayText);
  }
  
  updateTimeDisplay();
  updatePlayPauseBtn();
  
  // Notify other modules (e.g., player-mix.js) that live stream started
  document.dispatchEvent(new CustomEvent('liveStreamStarted', {
    detail: { url, displayText }
  }));
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
      if (state.userPausedLive || !mseIsActive()) {
        resumeLive();
      } else {
        pauseLive();
      }
    } else {
      if (aud.paused) {
        aud.play().catch(() => {}); // Ignore aborted/failed plays
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

async function load(url) {
  // Stop MSE player if active (important when exiting live mode)
  await mseStopLive();
  aud.pause();
  
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

async function play(url) {
  await load(url);
  aud.play();
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
