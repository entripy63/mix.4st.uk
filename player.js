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
async function pauseStream() {
  state.userPausedStream = true;
  await declick.fadeOut();
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
    declick.fadeIn();
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

  // Clean up any prior mix visualiser/tempo state (e.g. paused mix worker)
  stopVisualiser();
  stopTempo();

  if (autoplay) {
    ensureAudioContext();
    streamPlay(url, displayText);
    declick.fadeIn();
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
playPauseBtn?.addEventListener('click', async function(e) {
  if (isPlaybackPaused()) {
    if (state.isStream) {
      resumeStream();
    } else {
      ensureAudioContext();
      aud.play().catch(() => {});
      declick.fadeIn();
      startVisualiser();
      resumeTempo();
    }
  } else {
    if (state.isStream) {
      pauseStream();
    } else {
      await declick.fadeOut();
      aud.pause();
      pauseVisualiser();
      pauseTempo();
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
   // Ignore ended events while in stream mode. Stream lifecycle is handled
   // by IcecastMetadataPlayer and should not stop tempo/visualiser state.
   if (state.isStream) {
     return;
   }

   // Diagnostic: detect premature end (> 60s before expected duration)
   if (aud.duration && isFinite(aud.duration) && aud.currentTime < aud.duration - 60) {
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
       declick.fadeIn();
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
  // Declick before stopping current playback
  await declick.fadeOut();
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
  timeDisplay.title = decodeURIComponent(url);
  aud.src = url;
  aud.currentTime = 0;
}

async function play(url) {
  await load(url);
  ensureAudioContext();
  aud.play();
  declick.fadeIn();
  startVisualiser();
  startTempo();
}

// Timed Fades — two independent timers: fadeout (pause) and fadein (play)
const timedFades = {
  _timers: { fadeout: null, fadein: null },
  _intervals: { fadeout: null, fadein: null },
  _savedLevel: { fadeout: null, fadein: null },
  _dueTime: { fadeout: null, fadein: null },

  // Calculate ms until the next occurrence of hh:mm for "at" mode
  _calcAtDelay(h, m) {
    const now = new Date();
    const target = new Date(now);
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target - now;
  },

  // Check if today qualifies for the repeat setting
  _shouldFireToday(repeat) {
    if (repeat === 'all') return true;
    if (repeat === 'weekdays') {
      const day = new Date().getDay();
      return day >= 1 && day <= 5;
    }
    return true; // 'none' — always fire (one-shot)
  },

  schedule(type) {
    this._cancelTimer(type);
    if (!storage.getBool('timedFadesEnabled')) return;
    if (!storage.getBool(`tf.${type}.active`)) return;

    const mode = storage.get(`tf.${type}.mode`, 'at');
    const timeStr = storage.get(`tf.${type}.time`, type === 'fadeout' ? '23:00' : '07:00');
    const fadeSecs = storage.getNum(`tf.${type}.duration`, 3);
    const [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return;

    let dueMs;
    if (mode === 'at') {
      dueMs = this._calcAtDelay(h, m);
    } else {
      dueMs = (h * 3600 + m * 60) * 1000;
      if (dueMs <= 0) return;
    }

    // For fadein with stream playback, account for ~3s buffering latency
    const streamDelay = (type === 'fadein' && storage.getBool('tf.fadein.playStream')) ? 3000 : 0;
    const fadeStartMs = Math.max(0, dueMs - fadeSecs * 1000 - streamDelay);
    this._dueTime[type] = Date.now() + dueMs;

    this._timers[type] = setTimeout(() => {
      this._timers[type] = null;
      this._startFade(type, fadeSecs);
    }, fadeStartMs);
  },

  _startFade(type, fadeSecs) {
    if (type === 'fadeout') {
      this._startFadeOut(fadeSecs);
    } else {
      this._startFadeIn(fadeSecs);
    }
  },

  _startFadeOut(fadeSecs) {
    const repeat = storage.get('tf.fadeout.repeat', 'none');
    if (!this._shouldFireToday(repeat)) {
      this._scheduleRepeat('fadeout');
      return;
    }
    if (isPlaybackPaused()) {
      this._finish('fadeout', false);
      return;
    }
    this._savedLevel.fadeout = volume.get();
    const startLevel = this._savedLevel.fadeout;
    const steps = Math.max(1, Math.round(fadeSecs / 0.05));
    const decrement = startLevel / steps;
    let step = 0;

    showToast('Fading out...', fadeSecs);
    this._intervals.fadeout = setInterval(() => {
      step++;
      const level = Math.max(0, startLevel - decrement * step);
      volume.set(level);
      volumeSlider.value = level * 100;
      if (step >= steps) this._finish('fadeout', true);
    }, fadeSecs * 1000 / steps);
  },

  _startFadeIn(fadeSecs) {
    const repeat = storage.get('tf.fadein.repeat', 'none');
    if (!this._shouldFireToday(repeat)) {
      this._scheduleRepeat('fadein');
      return;
    }
    if (!isPlaybackPaused()) {
      this._finish('fadein', false);
      return;
    }
    this._savedLevel.fadein = volume.get();
    volume.set(0);
    volumeSlider.value = 0;

    // Optionally play first user stream instead of resuming current
    const useStream = storage.getBool('tf.fadein.playStream');
    let isStreamPlayback = false;

    ensureAudioContext();
    if (useStream) {
      const streams = getUserStreams();
      if (streams.length > 0 && liveStreams.length > 0 && liveStreams[0].available) {
        playLiveStream(0);
        isStreamPlayback = true;
      }
    }

    if (!isStreamPlayback) {
      // Resume whatever was playing
      if (state.isStream && state.streamUrl) {
        resumeStream();
        isStreamPlayback = true;
      } else if (state.currentQueueIndex >= 0 && state.currentQueueIndex < state.queue.length) {
        aud.play().catch(() => {});
        declick.fadeIn();
        startVisualiser();
        resumeTempo();
      } else {
        // Nothing to play — restore and bail
        volume.set(this._savedLevel.fadein);
        volumeSlider.value = this._savedLevel.fadein * 100;
        this._savedLevel.fadein = null;
        this._finish('fadein', false);
        return;
      }
    }

    // Streams have ~3s buffering latency; delay fade start to avoid
    // volume jumps when audio actually begins
    const delay = isStreamPlayback ? 3000 : 0;
    setTimeout(() => {
      if (!this._savedLevel.fadein) return; // cancelled during delay
      const targetLevel = this._savedLevel.fadein;
      const steps = Math.max(1, Math.round(fadeSecs / 0.05));
      const increment = targetLevel / steps;
      let step = 0;

      showToast('Fading in...', fadeSecs);
      this._intervals.fadein = setInterval(() => {
        step++;
        const level = Math.min(targetLevel, increment * step);
        volume.set(level);
        volumeSlider.value = level * 100;
        if (step >= steps) this._finish('fadein', false);
      }, fadeSecs * 1000 / steps);
    }, delay);
  },

  _finish(type, doPause) {
    if (this._intervals[type]) {
      clearInterval(this._intervals[type]);
      this._intervals[type] = null;
    }
    if (doPause) {
      if (state.isStream) {
        pauseStream();
      } else {
        declick.fadeOut().then(() => {
          aud.pause();
          stopVisualiser();
          pauseTempo();
        });
      }
    }
    // Restore volume (for fadeout: after pause; for fadein: already at target)
    if (this._savedLevel[type] !== null) {
      const restore = this._savedLevel[type];
      this._savedLevel[type] = null;
      if (type === 'fadeout') {
        setTimeout(() => {
          volume.set(restore);
          volumeSlider.value = restore * 100;
          updateMuteBtn();
        }, 100);
      }
    }
    this._dueTime[type] = null;

    const repeat = storage.get(`tf.${type}.repeat`, 'none');
    const mode = storage.get(`tf.${type}.mode`, 'at');
    if (repeat !== 'none' && mode === 'at') {
      this._scheduleRepeat(type);
    } else {
      // One-shot: deactivate this type
      storage.set(`tf.${type}.active`, false);
      this._updateUI(type);
    }
  },

  _scheduleRepeat(type) {
    this._cancelTimer(type);
    // Re-schedule for next "at" occurrence
    const timeStr = storage.get(`tf.${type}.time`, type === 'fadeout' ? '23:00' : '07:00');
    const fadeSecs = storage.getNum(`tf.${type}.duration`, 3);
    const [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return;

    const dueMs = this._calcAtDelay(h, m);
    const streamDelay = (type === 'fadein' && storage.getBool('tf.fadein.playStream')) ? 3000 : 0;
    const fadeStartMs = Math.max(0, dueMs - fadeSecs * 1000 - streamDelay);
    this._dueTime[type] = Date.now() + dueMs;

    this._timers[type] = setTimeout(() => {
      this._timers[type] = null;
      this._startFade(type, fadeSecs);
    }, fadeStartMs);
  },

  _updateUI(type) {
    const typeEl = document.getElementById('tfType');
    if (typeEl && typeEl.value === type) {
      const activeEl = document.getElementById('tfActive');
      if (activeEl) activeEl.checked = storage.getBool(`tf.${type}.active`);
    }
    this.updateStatus();
  },

  _cancelTimer(type) {
    if (this._timers[type]) {
      clearTimeout(this._timers[type]);
      this._timers[type] = null;
    }
    if (this._intervals[type]) {
      clearInterval(this._intervals[type]);
      this._intervals[type] = null;
      if (this._savedLevel[type] !== null) {
        volume.set(this._savedLevel[type]);
        volumeSlider.value = this._savedLevel[type] * 100;
        updateMuteBtn();
        this._savedLevel[type] = null;
      }
    }
    this._dueTime[type] = null;
  },

  cancel(type) {
    if (type) {
      this._cancelTimer(type);
    } else {
      this._cancelTimer('fadeout');
      this._cancelTimer('fadein');
    }
    this.updateStatus();
  },

  updateStatus() {
    const el = document.getElementById('tfStatus');
    if (!el) return;
    const parts = [];
    for (const type of ['fadeout', 'fadein']) {
      if (!this._dueTime[type]) continue;
      const remainMs = this._dueTime[type] - Date.now();
      if (remainMs <= 0) continue;
      const dueSecs = Math.round(remainMs / 1000);
      const h = Math.floor(dueSecs / 3600);
      const m = Math.floor((dueSecs % 3600) / 60);
      const verb = type === 'fadeout' ? 'pause' : 'play';
      const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
      parts.push(`Will ${verb} in ${timeStr}`);
    }
    el.textContent = parts.join(' · ');
  }
};

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    playPauseBtn.click();
  }
  // Escape is handled by modals.js
});
