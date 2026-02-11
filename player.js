function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const storage = {
  get(key, defaultVal = null) {
    const val = localStorage.getItem(key);
    return val !== null ? val : defaultVal;
  },
  getNum(key, defaultVal = 0) {
    const val = localStorage.getItem(key);
    return val !== null ? parseFloat(val) : defaultVal;
  },
  getJSON(key, defaultVal = null) {
    try {
      const val = localStorage.getItem(key);
      return val !== null ? JSON.parse(val) : defaultVal;
    } catch { return defaultVal; }
  },
  getBool(key, defaultVal = false) {
    return localStorage.getItem(key) === 'true' || (localStorage.getItem(key) === null && defaultVal);
  },
  set(key, val) {
    localStorage.setItem(key, typeof val === 'object' ? JSON.stringify(val) : val);
  },
  remove(key) {
    localStorage.removeItem(key);
  }
};

const aud = document.getElementById("audioPlayer");
const waveformCanvas = document.getElementById("waveform");
const waveformCtx = waveformCanvas.getContext("2d");

const state = {
   currentPeaks: null,
   isResizing: false,
   currentMixes: [],
   currentDJ: '',
   currentFilter: '',
   currentGroups: [],
   displayedMixes: [],
   draggedIndex: null,
   queue: storage.getJSON('queue', []),
   currentQueueIndex: storage.getNum('currentQueueIndex', -1),
   loopQueue: storage.getBool('loopQueue'),
   queueIdCounter: storage.getNum('queueIdCounter', 0),
   currentMix: null,
   playingFromPlayNow: false,
   previousQueueIndex: -1,
   previousQueueTime: 0,
   showHiddenMixes: false  // Ephemeral, not persisted
};

// Mix flags (favourites/hidden) - stored as arrays, used as Sets for O(1) lookup
const mixFlags = {
  _favourites: new Set(storage.getJSON('mixFavourites', [])),
  _hidden: new Set(storage.getJSON('mixHidden', [])),
  
  isFavourite(mixId) { return this._favourites.has(mixId); },
  isHidden(mixId) { return this._hidden.has(mixId); },
  hasFavourites() { return this._favourites.size > 0; },
  
  toggleFavourite(mixId) {
    if (this._favourites.has(mixId)) {
      this._favourites.delete(mixId);
    } else {
      this._favourites.add(mixId);
      // Can't be both favourite and hidden
      this._hidden.delete(mixId);
    }
    this._save();
    return this._favourites.has(mixId);
  },
  
  toggleHidden(mixId) {
    if (this._hidden.has(mixId)) {
      this._hidden.delete(mixId);
    } else {
      this._hidden.add(mixId);
      // Can't be both favourite and hidden
      this._favourites.delete(mixId);
    }
    this._save();
    return this._hidden.has(mixId);
  },
  
  _save() {
    storage.set('mixFavourites', [...this._favourites]);
    storage.set('mixHidden', [...this._hidden]);
    updateFavouritesButton();
  }
};

function updateFavouritesButton() {
  const btn = document.querySelector('.mode-btn[data-mode="favourites"]');
  if (btn) btn.disabled = !mixFlags.hasFavourites();
}

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

// Update waveform cursor during playback
setInterval(updateWaveformCursor, 100);

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

// Restore volume from localStorage, default to 50%
aud.volume = storage.getNum('playerVolume', 0.5);

// Save volume on change
aud.addEventListener("volumechange", function () {
  storage.set('playerVolume', aud.volume);
});

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
  aud.src = url;
  aud.currentTime = 0;
}

function play(url) {
  load(url);
  aud.play();
}



function generateQueueId() {
  state.queueIdCounter++;
  storage.set('queueIdCounter', state.queueIdCounter);
  return state.queueIdCounter;
}

// Ensure existing queue items have IDs
state.queue.forEach(item => {
  if (!item.queueId) item.queueId = generateQueueId();
});

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function saveQueue() {
  const persistableQueue = state.queue.filter(mix => !mix.isLocal);
  storage.set('queue', persistableQueue);
  // Recalculate index for persistable queue
  const currentMix = state.queue[state.currentQueueIndex];
  const persistedIndex = currentMix && !currentMix.isLocal 
    ? persistableQueue.findIndex(m => getMixId(m) === getMixId(currentMix))
    : -1;
  storage.set('currentQueueIndex', persistedIndex);
}

async function loadDJ(djPath) {
  state.currentDJ = djPath;
  state.currentMixes = await fetchDJMixes(djPath);
  updateDJButtons();
  displayGroupFilters(state.currentMixes);
  displayMixList(state.currentMixes);
}

function updateDJButtons() {
  document.querySelectorAll('#djButtons button').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.replace('-', '').toLowerCase() === state.currentDJ);
  });
}

function displayGroupFilters(mixes) {
  state.currentFilter = '';
  const filterDiv = document.getElementById('groupFilters');
  state.currentGroups = detectGroups(mixes);
  if (state.currentGroups.length === 0) {
    filterDiv.innerHTML = '';
    return;
  }
  const otherMixes = filterMixes(mixes, 'Other', state.currentGroups);
  const otherButton = otherMixes.length > 0 ? ` <button onclick="applyFilter('Other')">Other</button>` : '';
  filterDiv.innerHTML = `<button class="active" onclick="applyFilter('')">All</button> ` +
    state.currentGroups.map(g => `<button onclick="applyFilter('${g}')">${g}</button>`).join(' ') +
    otherButton;
}

function updateFilterButtons() {
  document.querySelectorAll('#groupFilters button').forEach(btn => {
    btn.classList.toggle('active', btn.textContent === (state.currentFilter || 'All'));
  });
}

function applyFilter(group) {
  state.currentFilter = group;
  updateFilterButtons();
  const filtered = filterMixes(state.currentMixes, group, state.currentGroups);
  displayMixList(filtered);
}

function getMixId(mix) {
  return mix.htmlPath || `${mix.djPath}/${mix.file}`;
}

function displayMixList(mixes) {
   // Filter out hidden mixes (unless showing hidden mixes)
   const visibleMixes = mixes.filter(mix => {
     const isHidden = mixFlags.isHidden(getMixId(mix));
     return !isHidden || state.showHiddenMixes;
   });
   state.displayedMixes = visibleMixes;
   const mixList = document.getElementById('mixList');
   const header = visibleMixes.length > 1 ? `<div class="mix-list-header"><button onclick="addAllToQueue()">Add All to Queue</button></div>` : '';
   mixList.innerHTML = header +
     visibleMixes.map((mix, i) => {
       const mixId = getMixId(mix);
       const isFav = mixFlags.isFavourite(mixId);
       const isHidden = mixFlags.isHidden(mixId);
       const favIcon = isFav ? '<span class="fav-icon" title="Favourite">❤️</span>' : '';
       const hiddenIcon = isHidden ? '<span class="hidden-icon" title="Hidden">🚫</span>' : '';
       const genre = mix.genre ? ` · ${escapeHtml(mix.genre)}` : '';
       const hasExtra = mix.date || mix.comment;
       const extraBtn = hasExtra ? `<button class="icon-btn info-btn" onclick="event.stopPropagation(); toggleMixInfo(this)" title="More info">ⓘ</button>` : '';
       const extraInfo = hasExtra ? `<div class="mix-extra-info" style="display:none">${mix.date ? `<div><strong>Date:</strong> ${escapeHtml(mix.date)}</div>` : ''}${mix.comment ? `<div><strong>Notes:</strong> ${escapeHtml(mix.comment)}</div>` : ''}</div>` : '';
       return `<div class="mix-item">
       <button class="icon-btn" onclick="addToQueue('${mixId}')" title="Add to queue">+</button>
       <button class="icon-btn" onclick="playNow('${mixId}')" title="Play now">▶</button>
       <span class="mix-name">${escapeHtml(mix.name)} <span class="mix-duration">(${mix.duration}${genre})</span></span>
       ${extraBtn}${favIcon}${hiddenIcon}${extraInfo}
     </div>`;
     }).join('');
}

function toggleMixInfo(btn) {
  const info = btn.parentElement.querySelector('.mix-extra-info');
  if (info) {
    info.style.display = info.style.display === 'none' ? 'block' : 'none';
  }
}

function addAllToQueue() {
  state.displayedMixes.forEach(mix => {
    state.queue.push({ ...mix, queueId: generateQueueId() });
  });
  saveQueue();
  displayQueue();
}

function addToQueue(mixId) {
  const mix = state.currentMixes.find(m => getMixId(m) === mixId);
  if (mix) {
    state.queue.push({ ...mix, queueId: generateQueueId() });
    saveQueue();
    displayQueue();
  }
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
    if (query) performSearch(query);
  } else if (mode === 'favourites') {
    displayFavourites();
  }
}

async function displayFavourites() {
  const mixList = document.getElementById('mixList');
  const favouriteIds = [...mixFlags._favourites];
  
  if (favouriteIds.length === 0) {
    mixList.innerHTML = '<div style="color: #888; padding: 20px;">No favourites yet. Play a mix and click the Fav button to add it here.</div>';
    return;
  }
  
  // Load search index to get mix metadata
  if (!searchIndex.data) {
    mixList.innerHTML = '<div style="color: #888; padding: 20px;">Loading...</div>';
    await searchIndex.load();
  }
  
  // Build mixes from favourited IDs using search index
  const mixes = [];
  for (const mixId of favouriteIds) {
    // mixId is like "trip/mix-name" or "haze/mix-name"
    const match = searchIndex.data.find(m => `${m.dj}/${m.file}` === mixId);
    if (match) {
      mixes.push({
        name: match.name,
        file: match.file,
        audioFile: match.audioFile,
        duration: match.duration,
        artist: match.artist,
        genre: match.genre,
        comment: match.comment,
        peaksFile: match.peaksFile,
        coverFile: match.coverFile,
        downloads: match.downloads,
        djPath: match.dj,
        djLabel: match.dj
      });
    }
  }
  
  if (mixes.length === 0) {
    mixList.innerHTML = '<div style="color: #888; padding: 20px;">No favourites found in search index.</div>';
    return;
  }
  
  // Use the DJ-badged display (same as search results)
  displayMixListWithDJ(mixes);
}

function getDJName(htmlPath) {
  if (!htmlPath) return '';
  const dir = htmlPath.split('/')[0];
  const djNames = { 'trip': 'trip-', 'izmar': 'Izmar', 'aboo': 'Aboo' };
  return djNames[dir] || dir;
}

function updateQueueInfo() {
  const infoDiv = document.querySelector('.queue-info');
  if (!infoDiv || state.queue.length === 0) return;
  
  const totalDuration = calculateTotalDuration();
  const durationText = totalDuration ? ` · ${totalDuration}` : '';
  const playState = aud.paused ? 'Stopped' : 'Playing';
  
  infoDiv.textContent = state.currentQueueIndex >= 0 
    ? `${playState} ${state.currentQueueIndex + 1} of ${state.queue.length}${durationText}`
    : `${state.queue.length} mixes${durationText}`;
}

function displayQueue() {
  const queueDiv = document.getElementById('queue');
  const totalDuration = calculateTotalDuration();
  const durationText = totalDuration ? ` · ${totalDuration}` : '';
  const playState = aud.paused ? 'Stopped' : 'Playing';
  const queueInfo = state.queue.length > 0 
    ? `<div class="queue-info">${state.currentQueueIndex >= 0 ? `${playState} ${state.currentQueueIndex + 1} of ${state.queue.length}` : `${state.queue.length} mixes`}${durationText}</div>` 
    : '';
  const header = state.queue.length > 0 
    ? `<div class="queue-header">
        <button onclick="clearQueue()">Clear</button>
        <button onclick="shuffleQueue()">Shuffle</button>
        <button class="loop-btn${state.loopQueue ? ' active' : ''}" onclick="toggleLoop()">Loop</button>
        <button onclick="skipPrev()" title="Previous in queue">↑ Prev</button>
        <button onclick="skipNext()" title="Next in queue">↓ Next</button>
      </div>` 
    : '';
  queueDiv.innerHTML = queueInfo + header + state.queue.map((mix, i) => {
    const djName = mix.artist || getDJName(mix.htmlPath || mix.djPath);
    const djSuffix = mix.isLocal ? '' : ` - ${escapeHtml(djName)}`;
    return `<div class="queue-item${i === state.currentQueueIndex ? ' current' : ''}" 
          draggable="true" 
          ondragstart="onDragStart(event, ${i})" 
          ondragover="onDragOver(event)" 
          ondrop="onDrop(event, ${i})"
          ondragend="onDragEnd()">
      <span class="drag-handle">☰</span>
      <span class="mix-name" onclick="playFromQueue(${i})">${escapeHtml(mix.name)}${djSuffix}</span>
      ${i !== state.currentQueueIndex ? `<button class="remove-btn" onclick="removeFromQueue(${i})">✕</button>` : ''}
    </div>`;
  }).join('');
}

function onDragStart(e, index) {
  state.draggedIndex = index;
  e.currentTarget.classList.add('dragging');
}

function onDragOver(e) {
  e.preventDefault();
}

function onDrop(e, dropIndex) {
  e.preventDefault();
  if (state.draggedIndex === null || state.draggedIndex === dropIndex) return;
  
  const draggedItem = state.queue.splice(state.draggedIndex, 1)[0];
  state.queue.splice(dropIndex, 0, draggedItem);
  
  // Update currentQueueIndex to follow the currently playing item
  if (state.currentQueueIndex === state.draggedIndex) {
    state.currentQueueIndex = dropIndex;
  } else if (state.draggedIndex < state.currentQueueIndex && dropIndex >= state.currentQueueIndex) {
    state.currentQueueIndex--;
  } else if (state.draggedIndex > state.currentQueueIndex && dropIndex <= state.currentQueueIndex) {
    state.currentQueueIndex++;
  }
  
  saveQueue();
  displayQueue();
}

function onDragEnd() {
  state.draggedIndex = null;
  document.querySelectorAll('.queue-item').forEach(el => el.classList.remove('dragging'));
}

function clearQueue() {
  state.queue = [];
  state.currentQueueIndex = -1;
  saveQueue();
  displayQueue();
}

function shuffleQueue() {
  const currentMix = state.currentQueueIndex >= 0 ? state.queue[state.currentQueueIndex] : null;
  for (let i = state.queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
  }
  if (currentMix) {
    state.currentQueueIndex = state.queue.findIndex(m => m.queueId === currentMix.queueId);
  }
  saveQueue();
  displayQueue();
}

function toggleLoop() {
  state.loopQueue = !state.loopQueue;
  storage.set('loopQueue', state.loopQueue);
  displayQueue();
}

function calculateTotalDuration() {
  let totalMinutes = 0;
  let hasDuration = false;
  state.queue.forEach(mix => {
    if (mix.duration && mix.duration !== '0:00:00') {
      const parts = mix.duration.split(':');
      totalMinutes += parseInt(parts[0]) * 60 + parseInt(parts[1]);
      hasDuration = true;
    }
  });
  if (!hasDuration) return '';
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${hours}:${mins.toString().padStart(2, '0')}:00`;
}

function skipNext() {
  if (state.currentQueueIndex >= 0 && state.currentQueueIndex < state.queue.length - 1) {
    playFromQueue(state.currentQueueIndex + 1);
  }
}

function skipPrev() {
  if (state.currentQueueIndex > 0) {
    playFromQueue(state.currentQueueIndex - 1);
  }
}

async function playFromQueue(index) {
  state.currentQueueIndex = index;
  saveQueue();
  await playMix(state.queue[index]);
}

function removeFromQueue(index) {
  if (index !== state.currentQueueIndex) {
    state.queue.splice(index, 1);
    if (index < state.currentQueueIndex) state.currentQueueIndex--;
    saveQueue();
    displayQueue();
  }
}

displayQueue();

// Search index cache
const searchIndex = {
  data: null,
  loading: false,
  
  async load() {
    if (this.data) return this.data;
    if (this.loading) {
      // Wait for existing load to complete
      while (this.loading) await new Promise(r => setTimeout(r, 50));
      return this.data;
    }
    
    this.loading = true;
    try {
      const response = await fetch('search-index.json');
      this.data = await response.json();
    } catch (e) {
      console.error('Failed to load search index:', e);
      this.data = [];
    }
    this.loading = false;
    return this.data;
  },
  
  search(query) {
    if (!this.data || !query.trim()) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    
    return this.data.filter(mix => {
      const searchable = `${mix.name} ${mix.artist} ${mix.genre} ${mix.comment} ${mix.dj}`.toLowerCase();
      return terms.every(term => searchable.includes(term));
    });
  }
};

// Browser mode switching
const browserModes = {
  current: 'dj',
  
  switch(mode) {
    if (mode === this.current) return;
    this.current = mode;
    
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    
    const djButtons = document.getElementById('djButtons');
    const djDropdown = document.getElementById('djDropdown');
    const searchBox = document.getElementById('searchBox');
    const groupFilters = document.getElementById('groupFilters');
    const mixList = document.getElementById('mixList');
    
    if (mode === 'dj') {
      djButtons.style.display = 'flex';
      djDropdown.style.display = 'none';
      searchBox.style.display = 'none';
      // Clear search results, show empty until DJ is selected
      groupFilters.innerHTML = '';
      mixList.innerHTML = '';
    } else if (mode === 'all') {
      djButtons.style.display = 'none';
      djDropdown.style.display = 'block';
      searchBox.style.display = 'none';
      // Clear current selection, user must pick from dropdown
      groupFilters.innerHTML = '';
      mixList.innerHTML = '';
      document.getElementById('djSelect').value = '';
    } else if (mode === 'search') {
      djButtons.style.display = 'none';
      djDropdown.style.display = 'none';
      searchBox.style.display = 'block';
      groupFilters.innerHTML = '';
      
      const searchInput = document.getElementById('searchInput');
      const existingQuery = searchInput.value;
      
      if (searchIndex.data) {
        // Index already loaded, re-run search if there's a query
        if (existingQuery.trim()) {
          const results = searchIndex.search(existingQuery);
          displaySearchResults(results, existingQuery);
        } else {
          mixList.innerHTML = '';
          document.getElementById('searchInfo').textContent = `${searchIndex.data.length} mixes available`;
        }
        searchInput.focus();
      } else {
        // First time loading search index
        mixList.innerHTML = '';
        document.getElementById('searchInfo').textContent = 'Loading search index...';
        searchIndex.load().then(() => {
          document.getElementById('searchInfo').textContent = `${searchIndex.data.length} mixes available`;
          searchInput.focus();
        });
      }
    } else if (mode === 'favourites') {
      djButtons.style.display = 'none';
      djDropdown.style.display = 'none';
      searchBox.style.display = 'none';
      groupFilters.innerHTML = '';
      displayFavourites();
    }
  }
};

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => browserModes.switch(btn.dataset.mode));
});

// DJ dropdown selection handler
document.getElementById('djSelect').addEventListener('change', function() {
  if (this.value) {
    loadDJ(this.value);
  }
});

// Search input handler
let searchTimeout = null;
document.getElementById('searchInput').addEventListener('input', function() {
  clearTimeout(searchTimeout);
  const query = this.value;
  
  // Debounce search for 150ms
  searchTimeout = setTimeout(() => {
    const results = searchIndex.search(query);
    displaySearchResults(results, query);
  }, 150);
});

function displaySearchResults(results, query) {
  const mixList = document.getElementById('mixList');
  const searchInfo = document.getElementById('searchInfo');
  
  if (!query.trim()) {
    mixList.innerHTML = '';
    searchInfo.textContent = `${searchIndex.data?.length || 0} mixes available`;
    return;
  }
  
  searchInfo.textContent = `${results.length} result${results.length !== 1 ? 's' : ''} for "${query}"`;
  
  if (results.length === 0) {
    mixList.innerHTML = '<div style="color: #888; padding: 20px;">No mixes found</div>';
    return;
  }
  
  // Convert search results to mix format expected by displayMixList
  const mixes = results.map(r => ({
    name: r.name,
    file: r.file,
    audioFile: r.audioFile,
    duration: r.duration,
    artist: r.artist,
    genre: r.genre,
    comment: r.comment,
    peaksFile: r.peaksFile,
    coverFile: r.coverFile,
    downloads: r.downloads,
    djPath: r.dj,
    djLabel: r.dj  // Extra field to show DJ in results
  }));
  
  displayMixListWithDJ(mixes);
}

function displayMixListWithDJ(mixes) {
    // Filter out hidden mixes (unless showing hidden mixes)
    const visibleMixes = mixes.filter(mix => {
      const isHidden = mixFlags.isHidden(getMixId(mix));
      return !isHidden || state.showHiddenMixes;
    });
    
    // Store visible mixes globally for onclick handlers (indices must match)
    window.currentSearchMixes = visibleMixes;
    
    const mixList = document.getElementById('mixList');
    const header = visibleMixes.length > 1 ? `<div class="mix-list-header"><button onclick="addAllSearchResultsToQueue()">Add All to Queue</button></div>` : '';
    
    mixList.innerHTML = header + visibleMixes.map((mix, i) => {
      const mixId = getMixId(mix);
      const isFav = mixFlags.isFavourite(mixId);
      const isHidden = mixFlags.isHidden(mixId);
      const favIcon = isFav ? '<span class="fav-icon" title="Favourite">❤️</span>' : '';
      const hiddenIcon = isHidden ? '<span class="hidden-icon" title="Hidden">🚫</span>' : '';
      const djSuffix = mix.djLabel ? ` - ${escapeHtml(mix.djLabel.split('/').pop())}` : '';
      const genre = mix.genre ? ` · ${escapeHtml(mix.genre)}` : '';
      const duration = mix.duration ? `(${mix.duration}${genre})` : '';
      const hasExtra = mix.comment;
      const extraBtn = hasExtra ? `<button class="icon-btn info-btn" onclick="event.stopPropagation(); toggleSearchMixInfo(this)" title="More info">ⓘ</button>` : '';
      const extraInfo = hasExtra ? `<div class="mix-extra-info" style="display:none">${mix.comment ? `<div><strong>Notes:</strong> ${escapeHtml(mix.comment)}</div>` : ''}</div>` : '';
      
      return `<div class="mix-item">
        <button class="icon-btn" onclick="addSearchResultToQueue(${i})" title="Add to queue">+</button>
        <button class="icon-btn" onclick="playSearchResult(${i})" title="Play now">▶</button>
        <span class="mix-name">${escapeHtml(mix.name)}${djSuffix} <span class="mix-duration">${duration}</span></span>
        ${extraBtn}${favIcon}${hiddenIcon}${extraInfo}
      </div>`;
   }).join('');
}

function toggleSearchMixInfo(btn) {
  const info = btn.parentElement.querySelector('.mix-extra-info');
  if (info) {
    info.style.display = info.style.display === 'none' ? 'block' : 'none';
  }
}

function addSearchResultToQueue(index) {
  const mix = window.currentSearchMixes[index];
  if (mix) {
    state.queue.push({ ...mix, queueId: generateQueueId() });
    saveQueue();
    displayQueue();
  }
}

function addAllSearchResultsToQueue() {
  window.currentSearchMixes.forEach(mix => {
    state.queue.push({ ...mix, queueId: generateQueueId() });
  });
  saveQueue();
  displayQueue();
}

async function playSearchResult(index) {
   const mix = window.currentSearchMixes[index];
   if (mix) {
     // Save current queue position before Play Now overwrites it
     state.previousQueueIndex = state.currentQueueIndex;
     state.previousQueueTime = aud.currentTime;
     state.playingFromPlayNow = true;
     
     state.queue.push({ ...mix, queueId: generateQueueId() });
     state.currentQueueIndex = state.queue.length - 1;
     saveQueue();
     displayQueue();
     await playMix(mix);
   }
}

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (aud.paused) {
      aud.play();
    } else {
      aud.pause();
    }
  } else if (e.code === 'ArrowDown' && e.ctrlKey) {
    e.preventDefault();
    skipNext();
  } else if (e.code === 'ArrowUp' && e.ctrlKey) {
    e.preventDefault();
    skipPrev();
  } else if (e.code === 'KeyD' && e.ctrlKey) {
    e.preventDefault();
    browserModes.switch('dj');
  } else if (e.code === 'KeyA' && e.ctrlKey) {
    e.preventDefault();
    browserModes.switch('all');
  } else if (e.code === 'KeyF' && e.ctrlKey) {
    e.preventDefault();
    browserModes.switch('search');
  } else if (e.code === 'KeyV' && e.ctrlKey) {
    e.preventDefault();
    browserModes.switch('favourites');
  } else if (e.code === 'Escape') {
    hideSettings();
    hideHelp();
  }
});

// Settings modal
function showSettings() {
   document.getElementById('settingsModal').style.display = 'flex';
   // Initialize radio buttons from storage
   const setting = storage.get('afterPlayNow', 'stop');
   const radio = document.querySelector(`input[name="afterPlayNow"][value="${setting}"]`);
   if (radio) radio.checked = true;
   // Initialize checkbox from state (not persisted)
   document.getElementById('showHiddenMixesCheckbox').checked = state.showHiddenMixes;
}

function hideSettings() {
   document.getElementById('settingsModal').style.display = 'none';
}

function updateSetting(key, value) {
   storage.set(key, value);
}

function updateShowHiddenMixes(checked) {
   state.showHiddenMixes = checked;
   // Refresh current display
   if (state.currentDJ) {
     loadDJ(state.currentDJ);
   } else {
     // Re-render current mix list view
     if (state.displayedMixes) {
       displayMixList(state.currentMixes);
     }
   }
}

// Close settings modal when clicking outside content
document.getElementById('settingsModal')?.addEventListener('click', function(e) {
  if (e.target === this) hideSettings();
});

// Help modal
function showHelp() {
  document.getElementById('helpModal').style.display = 'flex';
}

function hideHelp() {
  document.getElementById('helpModal').style.display = 'none';
}

// Close help modal when clicking outside content
document.getElementById('helpModal')?.addEventListener('click', function(e) {
  if (e.target === this) hideHelp();
});

// Handle local file selection
document.getElementById('fileInput').addEventListener('change', async function(e) {
  const files = Array.from(e.target.files);
  let rejected = 0;
  
  for (const file of files) {
    const canPlay = await checkAudioSupport(file);
    if (canPlay === '') {
      rejected++;
      continue;
    }
    if (canPlay === 'maybe') {
      showToast(`Warning: ${file.name} may not play correctly`);
    }
    const audioSrc = URL.createObjectURL(file);
    state.queue.push({
      name: file.name.replace(/\.[^/.]+$/, ''),
      audioSrc: audioSrc,
      isLocal: true,
      queueId: generateQueueId()
    });
  }
  
  if (rejected > 0) {
    showToast(`${rejected} file(s) not supported by this browser`);
  }
  
  saveQueue();
  displayQueue();
  e.target.value = '';
});

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

// Restore last playing mix on page load
// Initialize favourites button state
updateFavouritesButton();

(async function restorePlayer() {
  try {
    const savedPath = storage.get('currentMixPath');
    if (savedPath) {
      // savedPath could be "dj/file.html" (legacy) or "dj/file" (manifest)
      const isLegacy = savedPath.endsWith('.html');
      let mix;
      if (isLegacy) {
        mix = { htmlPath: savedPath, name: savedPath.split('/').pop().replace('.html', '') };
      } else {
        const parts = savedPath.split('/');
        const file = parts.pop();
        const djPath = parts.join('/');
        // Try to get full mix data from manifest
        try {
          const mixes = await fetchDJMixes(djPath);
          mix = mixes.find(m => m.file === file);
        } catch (e) {
          // Manifest not available, build minimal object
        }
        if (!mix) {
          mix = { djPath, file, audioFile: `${file}.mp3`, peaksFile: `${file}.peaks.json`, name: file };
        }
      }
      const details = await fetchMixDetails(mix);
      if (details.audioSrc) {
        load(details.audioSrc);
        aud.currentTime = storage.getNum('playerTime', 0);
        state.currentMix = mix;
        state.currentDownloadLinks = details.downloadLinks || [];
        state.currentCoverSrc = details.coverSrc;
        displayTrackList(mix, details.trackListTable, details.downloadLinks, details.coverSrc);
        loadPeaks(details.peaks);
        // Ensure waveform draws after layout is ready
        requestAnimationFrame(resizeWaveformCanvas);
      }
    }
  } catch (e) {
    console.error('Error restoring player:', e);
  }
})();