// player.js - Playback Controls & Waveform

// Set canvas resolution to match CSS size
function resizeWaveformCanvas() {
  const w = waveformCanvas.offsetWidth || 500;
  const h = waveformCanvas.offsetHeight || 60;
  if (waveformCanvas.width !== w) waveformCanvas.width = w;
  if (waveformCanvas.height !== h) waveformCanvas.height = h;
  if (state.currentPeaks) {
    const progress = aud.duration ? aud.currentTime / aud.duration : 0;
    drawWaveform(state.currentPeaks, progress);
  }
}
resizeWaveformCanvas();
window.addEventListener('load', resizeWaveformCanvas);

function drawWaveform(peaks, progress = 0) {
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
waveformCanvas.addEventListener('click', function(e) {
  if (aud.duration) {
    const rect = waveformCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = x / waveformCanvas.width;
    aud.currentTime = progress * aud.duration;
    updateWaveformCursor();
  }
});

// Initialize with empty waveform
state.currentPeaks = null;
drawWaveform([], 0);

// Waveform resize handling
const resizeHandle = document.getElementById('waveformResizeHandle');

// Restore saved height
const savedHeight = storage.getNum('waveformHeight', 0);
if (savedHeight) {
  waveformCanvas.style.height = savedHeight + 'px';
  waveformCanvas.height = savedHeight;
}

resizeHandle.addEventListener('mousedown', startResize);
resizeHandle.addEventListener('touchstart', startResize, { passive: false });

function startResize(e) {
  e.preventDefault();
  state.isResizing = true;
  document.addEventListener('mousemove', doResize);
  document.addEventListener('mouseup', stopResize);
  document.addEventListener('touchmove', doResize, { passive: false });
  document.addEventListener('touchend', stopResize);
}

function doResize(e) {
  if (!state.isResizing) return;
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
  storage.set('waveformHeight', waveformCanvas.height);
}

function loadPeaks(peaks) {
  if (peaks && peaks.length > 0) {
    state.currentPeaks = peaks;
    drawWaveform(state.currentPeaks, 0);
  } else {
    state.currentPeaks = null;
    waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
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
playPauseBtn.addEventListener('click', function() {
  console.log('Play/Pause button clicked');
  if (state.isLive) {
    if (aud.paused) {
      resumeLive();
      console.log('User clicked play (live), saving wasPlaying=true');
      storage.set('wasPlaying', true);
    } else {
      pauseLive();
      console.log('User clicked pause (live), saving wasPlaying=false');
      storage.set('wasPlaying', false);
    }
  } else {
    if (aud.paused) {
      aud.play();
      console.log('User clicked play (mix), saving wasPlaying=true');
      storage.set('wasPlaying', true);
    } else {
      aud.pause();
      console.log('User clicked pause (mix), saving wasPlaying=false');
      storage.set('wasPlaying', false);
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
});
aud.addEventListener('pause', () => {
  updatePlayPauseBtn();
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

function getDJName(htmlPath) {
  if (!htmlPath) return '';
  const dir = htmlPath.split('/')[0];
  const djNames = { 'trip': 'trip-', 'izmar': 'Izmar', 'aboo': 'Aboo' };
  return djNames[dir] || dir;
}

async function playMix(mix) {
  document.title = `${mix.name} - Player`;
  state.currentMix = mix;
  
  if (mix.isLocal) {
    storage.remove('currentMixPath');
    state.currentDownloadLinks = [];
    state.currentCoverSrc = null;
    play(mix.audioSrc);
    displayTrackList(mix, '', [], null);
    loadPeaks(null);
  } else {
    // Store mix identifier for restore (works with both manifest and HTML-based mixes)
    const mixId = mix.htmlPath || `${mix.djPath}/${mix.file}`;
    storage.set('currentMixPath', mixId);
    const details = await fetchMixDetails(mix);
    if (details.audioSrc) {
      state.currentDownloadLinks = details.downloadLinks || [];
      state.currentCoverSrc = details.coverSrc;
      play(details.audioSrc);
      displayTrackList(mix, details.trackListTable, details.downloadLinks, details.coverSrc);
      loadPeaks(details.peaks);
    }
  }
  displayQueue();
}

async function playNow(mixId) {
   console.log('playNow called, saving wasPlaying=true');
   storage.set('wasPlaying', true);
   // Save current queue position before Play Now overwrites it
   state.previousQueueIndex = state.currentQueueIndex;
   state.previousQueueTime = aud.currentTime;
   state.playingFromPlayNow = true;
   
   state.currentQueueIndex = -1;
   const mix = state.currentMixes.find(m => getMixId(m) === mixId);
   await playMix(mix || { name: mixId.split('/').pop(), htmlPath: mixId });
}

function displayTrackList(mix, table, downloadLinks, coverSrc) {
  const nowPlayingDiv = document.getElementById('nowPlaying');
  const trackListDiv = document.getElementById('trackList');
  const coverArtDiv = document.getElementById('coverArt');
  
  // Show mix name and artist immediately below player
  const mixName = mix ? escapeHtml(mix.name) : '';
  const djName = mix ? escapeHtml(mix.artist || getDJName(mix.htmlPath || mix.djPath)) : '';
  nowPlayingDiv.innerHTML = mixName ? `<h1>${mixName} by ${djName}</h1>` : '';
  
  // Build action bar with download buttons (left) and flag buttons (right)
  let actionBar = '';
  const mixId = mix ? getMixId(mix) : null;
  const hasDownloads = downloadLinks && downloadLinks.length > 0;
  const canFlag = mixId && !mix.isLocal;
  
  if (hasDownloads || canFlag) {
    const downloadBtns = hasDownloads 
      ? downloadLinks.map(d => `<a class="action-btn download-btn" href="${d.href}" download><span class="action-icon">⬇</span>${d.label}</a>`).join('')
      : '';
    
    let flagBtns = '';
    if (canFlag) {
      const isFav = mixFlags.isFavourite(mixId);
      const isHidden = mixFlags.isHidden(mixId);
      const hideDisabled = isFav ? ' disabled' : '';
      const hideTitle = isFav ? 'Cannot hide favourited mix' : (isHidden ? 'Unhide mix' : 'Hide mix');
      flagBtns = `
        <button class="action-btn fav-btn${isFav ? ' active' : ''}" onclick="toggleCurrentFavourite()" title="${isFav ? 'Remove from favourites' : 'Add to favourites'}">
          <span class="action-icon">${isFav ? '❤️' : '🤍'}</span>Fav
        </button>
        <button class="action-btn hide-btn${isHidden ? ' active' : ''}"${hideDisabled} onclick="toggleCurrentHidden()" title="${hideTitle}">
          <span class="action-icon">${isHidden ? '👁️' : '🚫'}</span>Hide
        </button>`;
    }
    
    actionBar = `<div class="action-bar">
      <div class="action-left">${downloadBtns}</div>
      <div class="action-right">${flagBtns}</div>
    </div>`;
  }
  
  const trackListSection = table || '';
  trackListDiv.innerHTML = trackListSection + actionBar;
  
  // Show cover art only if there's no track list (track list takes precedence)
  if (coverSrc && !table) {
    coverArtDiv.innerHTML = `<img src="${coverSrc}" alt="Cover art">`;
  } else {
    coverArtDiv.innerHTML = '';
  }
}

function toggleCurrentFavourite() {
  if (!state.currentMix) return;
  const mixId = getMixId(state.currentMix);
  mixFlags.toggleFavourite(mixId);
  // Refresh action bar
  const trackListDiv = document.getElementById('trackList');
  const table = trackListDiv.querySelector('table');
  displayTrackList(state.currentMix, table ? table.outerHTML : '', state.currentDownloadLinks || [], state.currentCoverSrc);
  // Refresh browser list if visible
  refreshBrowserList();
}

function toggleCurrentHidden() {
  if (!state.currentMix) return;
  const mixId = getMixId(state.currentMix);
  mixFlags.toggleHidden(mixId);
  // Refresh action bar
  const trackListDiv = document.getElementById('trackList');
  const table = trackListDiv.querySelector('table');
  displayTrackList(state.currentMix, table ? table.outerHTML : '', state.currentDownloadLinks || [], state.currentCoverSrc);
  // Refresh browser list if visible
  refreshBrowserList();
}

function refreshBrowserList() {
  const mode = document.querySelector('.mode-btn.active')?.dataset.mode;
  if ((mode === 'dj' || mode === 'all') && state.currentDJ) {
    displayMixList(filterMixes(state.currentMixes, state.currentFilter, state.currentGroups));
  } else if (mode === 'search') {
    const query = document.getElementById('searchInput')?.value;
    if (query) displaySearchResults(searchIndex.search(query), query);
  } else if (mode === 'favourites') {
    displayFavourites();
  }
}

// Audio file support detection
function guessMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const types = {
    'mp3': 'audio/mpeg',
    'm4a': 'audio/mp4',
    'ogg': 'audio/ogg',
    'wav': 'audio/wav',
    'flac': 'audio/flac',
    'webm': 'audio/webm'
  };
  return types[ext] || '';
}

async function checkAudioSupport(file) {
  const mimeType = file.type || guessMimeType(file.name);
  if (!mimeType) return 'maybe';
  
  const testAudio = document.createElement('audio');
  let result = testAudio.canPlayType(mimeType);
  
  // For M4A, try to detect codec by probing playback
  if (mimeType.includes('m4a') || mimeType.includes('mp4')) {
    result = await probeAudioPlayback(file);
  }
  
  return result;
}

function probeAudioPlayback(file) {
  return new Promise(resolve => {
    const testAudio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    
    const cleanup = () => {
      testAudio.src = '';
      URL.revokeObjectURL(url);
    };
    
    testAudio.addEventListener('canplay', () => {
      cleanup();
      resolve('probably');
    }, { once: true });
    
    testAudio.addEventListener('error', () => {
      cleanup();
      resolve('');
    }, { once: true });
    
    setTimeout(() => {
      cleanup();
      resolve('maybe');
    }, 3000);
    
    testAudio.src = url;
    testAudio.load();
  });
}
