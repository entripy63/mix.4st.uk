# Exact Code Sections for Split

## core.js - Complete File

**Source:** player.js lines 1-103

```javascript
// core.js - Shared utilities, global state, and DOM references

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
   showHiddenMixes: false,  // Ephemeral, not persisted
   isLive: false,           // Currently playing a live stream
   liveStreamUrl: null,     // URL to restore on live resume
   liveDisplayText: null    // Display text for current live stream
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
```

---

## queue.js - Key Sections

**Source:** player.js lines 464-926, reorganized for logical flow

### Section 1: Queue State & Persistence
```javascript
// queue.js - Queue Management

function generateQueueId() {
  state.queueIdCounter += 1;
  storage.set('queueIdCounter', state.queueIdCounter);
  return state.queueIdCounter;
}

// Ensure existing queue items have IDs
for (const item of state.queue) {
  if (!item.queueId) {
    item.queueId = generateQueueId();
  }
}

function saveQueue() {
  storage.set('queue', state.queue);
  storage.set('currentQueueIndex', state.currentQueueIndex);
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; bottom: 20px; right: 20px;
    background: #4a4a4a; color: #fff; padding: 10px 20px;
    border-radius: 4px; z-index: 10000; animation: fadeOut 3s forwards;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
```

### Section 2: Queue Display
```javascript
function updateQueueInfo() {
  const info = document.getElementById('queueInfo');
  if (!info) return;
  
  const count = state.queue.length;
  const duration = calculateTotalDuration();
  const durationStr = formatTime(duration);
  
  info.innerHTML = `${count} mix${count !== 1 ? 'es' : ''} • ${durationStr}`;
}

function displayQueue() {
  const queueDiv = document.getElementById('queue');
  
  let html = '<div class="queue-header">';
  html += `<span id="queueInfo">0 mixes • 0:00</span>`;
  html += `<button class="small-btn" onclick="clearQueue()" title="Clear queue">✕</button>`;
  html += `<button class="small-btn" onclick="shuffleQueue()" title="Shuffle">🔀</button>`;
  html += `<button class="small-btn" onclick="toggleLoop()" title="Loop" id="loopBtn">↻</button>`;
  html += '</div>';
  
  if (state.queue.length === 0) {
    html += '<div style="padding: 10px; color: #888;">Queue is empty</div>';
  } else {
    html += '<div id="queueItems" class="queue-items">';
    state.queue.forEach((mix, i) => {
      const isCurrentlyPlaying = i === state.currentQueueIndex && !state.isLive;
      const className = isCurrentlyPlaying ? 'queue-item current' : 'queue-item';
      const duration = mix.duration ? ` (${formatTime(mix.duration)})` : '';
      
      html += `
        <div class="${className}" draggable="true" 
             ondragstart="onDragStart(event, ${i})"
             ondragover="onDragOver(event)"
             ondrop="onDrop(event, ${i})"
             ondragend="onDragEnd()">
          <span class="mix-name" onclick="playFromQueue(${i})">${escapeHtml(mix.name)}${duration}</span>
          <button class="icon-btn small" onclick="removeFromQueue(${i})" title="Remove">✕</button>
        </div>
      `;
    });
    html += '</div>';
  }
  
  queueDiv.innerHTML = html;
  updateQueueInfo();
  
  const loopBtn = document.getElementById('loopBtn');
  if (loopBtn) {
    loopBtn.style.opacity = state.loopQueue ? '1' : '0.5';
  }
}
```

### Section 3: Queue Operations
```javascript
function onDragStart(e, index) {
  state.draggedIndex = index;
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function onDrop(e, dropIndex) {
  e.preventDefault();
  if (state.draggedIndex === null || state.draggedIndex === dropIndex) return;
  
  const draggedItem = state.queue.splice(state.draggedIndex, 1)[0];
  state.queue.splice(dropIndex, 0, draggedItem);
  
  // Adjust currentQueueIndex if needed
  if (state.draggedIndex === state.currentQueueIndex) {
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
}

function clearQueue() {
  if (confirm('Clear entire queue?')) {
    state.queue = [];
    state.currentQueueIndex = -1;
    saveQueue();
    displayQueue();
  }
}

function shuffleQueue() {
  for (let i = state.queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
  }
  // If a mix is currently playing, keep its index up-to-date
  // (position in array changed but we want to keep same mix)
  saveQueue();
  displayQueue();
}

function toggleLoop() {
  state.loopQueue = !state.loopQueue;
  storage.set('loopQueue', state.loopQueue);
  displayQueue();
}

function calculateTotalDuration() {
  return state.queue.reduce((sum, mix) => sum + (mix.duration || 0), 0);
}

function skipNext() {
  if (state.queue.length === 0) return;
  if (state.currentQueueIndex < state.queue.length - 1) {
    playFromQueue(state.currentQueueIndex + 1);
  } else if (state.loopQueue) {
    playFromQueue(0);
  } else {
    stopLive();
  }
}

function skipPrev() {
  if (state.currentQueueIndex > 0) {
    playFromQueue(state.currentQueueIndex - 1);
  }
}

async function playFromQueue(index) {
  state.currentQueueIndex = index;
  await playMix(state.queue[index]);
  displayQueue();
}

function removeFromQueue(index) {
  state.queue.splice(index, 1);
  if (state.currentQueueIndex >= state.queue.length && state.currentQueueIndex > 0) {
    state.currentQueueIndex--;
  }
  saveQueue();
  displayQueue();
}
```

---

## player.js - Key Sections

**Source:** player.js lines 104-631, reorganized

### Section 1: Waveform Functions
```javascript
// player.js - Audio Playback & Waveform

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
    
    const playedX = w * progress;
    waveformCtx.fillStyle = x < playedX ? '#5c6bc0' : '#3d3d5c';
    waveformCtx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight);
  });
  
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

setInterval(updateWaveformCursor, 100);

waveformCanvas.addEventListener('click', function(e) {
  if (aud.duration) {
    const rect = waveformCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = x / waveformCanvas.width;
    aud.currentTime = progress * aud.duration;
    updateWaveformCursor();
  }
});

// ... rest of waveform code
```

### Section 2: Playback Core Functions
```javascript
function load(url) {
  aud.src = url;
  aud.load();
}

function play(url) {
  load(url);
  aud.play();
}

async function playMix(mix) {
  // This is called from queue.playFromQueue() and browser.playNow()
  // Don't set playingFromPlayNow flag here - it's set elsewhere
  
  const details = await fetchMixDetails(mix);
  if (details.audioSrc) {
    load(details.audioSrc);
    aud.play();
    state.currentMix = mix;
    state.currentDownloadLinks = details.downloadLinks || [];
    state.currentCoverSrc = details.coverSrc;
    displayTrackList(mix, details.trackListTable, details.downloadLinks, details.coverSrc);
    loadPeaks(details.peaks);
    requestAnimationFrame(resizeWaveformCanvas);
    
    storage.set('currentMixPath', `${mix.djPath}/${mix.file}`);
  }
}

async function playNow(mixId) {
  state.playingFromPlayNow = true;
  
  const mixes = await fetchDJMixes(state.currentDJ);
  const mix = mixes.find(m => getMixId(m) === mixId);
  
  state.queue.unshift({ ...mix, queueId: generateQueueId() });
  state.currentQueueIndex = 0;
  saveQueue();
  displayQueue();
  await playMix(mix || { name: mixId.split('/').pop(), htmlPath: mixId });
}
```

---

## browser.js - Key Sections

**Source:** player.js lines 496-1752, major reorganization needed

### Section 1: Mix Browser Display
```javascript
// browser.js - Mix Browser, Search, Live Streams

async function loadDJ(djPath) {
  state.currentDJ = djPath;
  state.currentFilter = '';
  state.currentGroups = [];
  const mixes = await fetchDJMixes(djPath);
  state.currentMixes = mixes;
  updateDJButtons();
  updateFilterButtons();
  displayGroupFilters(mixes);
  displayMixList(mixes);
}

function updateDJButtons() {
  const buttons = document.querySelectorAll('.dj-btn');
  buttons.forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.dj === state.currentDJ) {
      btn.classList.add('active');
    }
  });
}

function displayGroupFilters(mixes) {
  // Show genre/group filters based on loaded mixes
  const groups = new Set();
  mixes.forEach(mix => {
    if (mix.genre) groups.add(mix.genre);
  });
  state.currentGroups = Array.from(groups).sort();
  updateFilterButtons();
}

function updateFilterButtons() {
  // Update filter button states based on current filter
  // ... code here
}

function applyFilter(group) {
  state.currentFilter = state.currentFilter === group ? '' : group;
  const filtered = filterMixes(state.currentMixes, state.currentFilter, state.currentGroups);
  displayMixList(filtered);
}

function getMixId(mix) {
  return mix.htmlPath || `${mix.djPath}/${mix.file}`;
}

function displayMixList(mixes) {
  const mixList = document.getElementById('mixList');
  
  let html = '';
  
  mixes.forEach(mix => {
    const mixId = getMixId(mix);
    const isFav = mixFlags.isFavourite(mixId);
    const favClass = isFav ? ' active' : '';
    const duration = mix.duration ? ` (${formatTime(mix.duration)})` : '';
    
    html += `
      <div class="mix-item">
        <div class="mix-info">
          <strong onclick="toggleMixInfo(this)">${escapeHtml(mix.name)}</strong>
          <span class="mix-meta">${duration}</span>
          <div class="mix-details" style="display: none;">
            ${mix.genre ? `<small>Genre: ${escapeHtml(mix.genre)}</small><br>` : ''}
            ${mix.duration ? `<small>Duration: ${formatTime(mix.duration)}</small><br>` : ''}
          </div>
        </div>
        <div class="mix-buttons">
          <button class="icon-btn${favClass}" onclick="toggleFavFromBrowser('${mixId}')" title="Favorite">★</button>
          <button class="icon-btn" onclick="addToQueue('${mixId}')" title="Add to queue">+</button>
          <button class="icon-btn" onclick="playNow('${mixId}')" title="Play now">▶</button>
        </div>
      </div>
    `;
  });
  
  mixList.innerHTML = html || '<div style="padding: 20px; color: #888;">No mixes found</div>';
}

function toggleMixInfo(btn) {
  const details = btn.nextElementSibling?.nextElementSibling;
  if (details) {
    details.style.display = details.style.display === 'none' ? 'block' : 'none';
  }
}

function addAllToQueue() {
  state.currentMixes.forEach(mix => {
    const mixId = getMixId(mix);
    state.queue.push({ ...mix, queueId: generateQueueId() });
  });
  saveQueue();
  displayQueue();
  showToast(`Added ${state.currentMixes.length} mixes to queue`);
}

function addToQueue(mixId) {
  const mixes = state.displayedMixes.length > 0 ? state.displayedMixes : state.currentMixes;
  const mix = mixes.find(m => getMixId(m) === mixId);
  if (mix) {
    state.queue.push({ ...mix, queueId: generateQueueId() });
    saveQueue();
    displayQueue();
    showToast(`Added "${mix.name}" to queue`);
  }
}

function refreshBrowserList() {
  if (state.currentDJ) {
    loadDJ(state.currentDJ);
  } else {
    displayMixList(state.currentMixes);
  }
}

// ... more browser functions
```

### Section 2: Live Streams
```javascript
// Live Stream Management
const STREAM_PROXY = 'https://stream-proxy.round-bar-e93e.workers.dev';

const BUILTIN_STREAM_DEFS = [
  { name: 'Sleepbot Environmental Broadcast', m3u: 'http://sleepbot.com/ambience/cgi/listen.m3u', genre: 'Ambient' },
  { name: 'Jungletrain.net', m3u: 'https://jungletrain.net/static/256kbps.m3u', genre: 'Jungle/Drum & Bass' }
];

// ... all live stream functions ...

let liveStreams = [];
let liveStreamsInitialized = false;

async function initLiveStreams() {
  if (liveStreamsInitialized) return;
  
  liveStreams = [];
  for (const config of getLiveStreamConfig()) {
    await probeAndAddStream(config);
  }
  liveStreamsInitialized = true;
}

function displayLiveStreams() {
  const mixList = document.getElementById('mixList');
  
  if (!liveStreamsInitialized) {
    mixList.innerHTML = '<div style="padding: 20px; color: #888;">Checking stream availability...</div>';
    initLiveStreams().then(() => displayLiveStreams());
    return;
  }
  
  // ... display live streams UI ...
}
```

### Section 3: Browser Modes Coordinator
```javascript
const browserModes = {
  current: 'dj',
  
  switch(mode) {
    if (mode === this.current) return;
    
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.mode === mode) btn.classList.add('active');
    });
    
    this.current = mode;
    
    if (mode === 'dj') {
      // Show DJ selector
      if (state.currentDJ) loadDJ(state.currentDJ);
    } else if (mode === 'all') {
      // Show all mixes
      loadAllMixes();
    } else if (mode === 'favourites') {
      // Show only favorites
      displayFavourites();
    } else if (mode === 'live') {
      // Show live streams
      displayLiveStreams();
    } else if (mode === 'search') {
      // Show search
      showSearchInterface();
    }
  }
};

// Attach event listeners
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => browserModes.switch(btn.dataset.mode));
});
```

### Section 4: Page Initialization
```javascript
// Initialize on page load
updateFavouritesButton();
initializeBuiltinStreams();

(async function restorePlayer() {
  try {
    // Check if we were in live mode
    const savedLiveUrl = storage.get('liveStreamUrl');
    const savedLiveText = storage.get('liveDisplayText');
    
    if (savedLiveUrl && savedLiveText) {
      browserModes.switch('live');
      await initLiveStreams();
      const stream = liveStreams.find(s => s.url === savedLiveUrl);
      if (stream && stream.available) {
        state.isLive = true;
        state.liveStreamUrl = savedLiveUrl;
        state.liveDisplayText = savedLiveText;
        // ... restore live state
      }
      return;
    }
    
    // Restore last playing mix
    const savedPath = storage.get('currentMixPath');
    if (savedPath) {
      // ... restore mix playback
    }
  } catch (e) {
    console.error('Error restoring player:', e);
  }
})();
```

---

## Summary

These code sections show:
- **core.js**: Pure utilities and state (no imports needed)
- **queue.js**: Queue management, depends only on core
- **player.js**: Playback control, depends on core and mixes
- **browser.js**: Everything else, depends on all modules

Load them in HTML in this order:
```html
<script src="core.js"></script>
<script src="mixes.js"></script>
<script src="queue.js"></script>
<script src="player.js"></script>
<script src="browser.js"></script>
```
