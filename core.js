// core.js - Shared utilities, global state, and DOM references

function escapeHtml(str) {
   if (!str) return '';
   return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getMixId(mix) {
   return mix.htmlPath || `${mix.djPath}/${mix.file}`;
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
   draggedStreamIndex: null,
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

// State setters - ensure state and UI stay in sync
function setQueue(newQueue) {
  state.queue = newQueue;
  saveQueue();
  displayQueue();
}

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

// Format time as M:SS or H:MM:SS
function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
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
