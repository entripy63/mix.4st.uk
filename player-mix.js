// player-mix.js - Mix Playback, Queue Integration, Waveform, Favourites
// Dependencies: core.js (state, storage, getMixId, escapeHtml, mixFlags, waveformCanvas, waveformCtx)
//               player.js (play, load, displayQueue, updateTimeDisplay, updatePlayPauseBtn, updateMuteBtn, aud)
//               mixes.js (fetchMixDetails, state.currentMixes)
//               queue.js (playFromQueue, saveQueue, displayQueue, updateQueueInfo)
//               browser.js (filterMixes, displayMixList, displaySearchResults, displayFavourites)

// ============================================
// WAVEFORM CODE (player.html only)
// ============================================

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

// ============================================
// MIX PLAYBACK CODE
// ============================================

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

// Audio file support detection (for local file uploads)
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
