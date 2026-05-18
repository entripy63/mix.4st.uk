// core.js - Shared utilities, global state, and DOM references

// Mixes base URLs - ordered list of sources to try, loaded from mixes-config.json
let MIXES_BASE_URLS = ['/mixes/'];

async function loadMixesConfig() {
  try {
    const resp = await fetch('mixes/mixes-config.json');
    const config = await resp.json();
    const urls = config.mixesBaseUrls || (config.mixesBaseUrl ? [config.mixesBaseUrl] : null);
    if (urls && urls.length > 0) {
      // Filter out remote URLs that resolve to our own origin, either directly
      // (e.g. https://mixes.4st.uk/mixes/) or via a proxy wrapper
      // (e.g. https://proxy.example.com/?url=https://mixes.4st.uk/mixes/)
      const ownOrigin = window.location.origin;
      MIXES_BASE_URLS = urls.filter(url => {
        // Relative URLs: always keep
        if (!url.startsWith('http://') && !url.startsWith('https://')) return true;
        // Direct absolute URL to our own origin
        try { if (new URL(url).origin === ownOrigin) return false; }
        catch { /* keep */ }
        // Proxy URL wrapping our own origin (contains our origin in the URL string)
        if (url.includes(ownOrigin + '/')) return false;
        return true;
      });
      // Must have at least one URL; if all were filtered, keep the original list
      if (MIXES_BASE_URLS.length === 0) MIXES_BASE_URLS = urls;
    }
  } catch (e) {
    console.warn('Failed to load mixes/mixes-config.json, using local fallback:', e);
  }
}

function escapeHtml(str) {
   if (!str) return '';
   return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalizeDJPath(path) {
  if (!path) return '';
  let normalized = String(path).trim();
  if (!normalized) return '';

  const lower = normalized.toLowerCase();
  const marker = '/mixes/';
  const markerIndex = lower.lastIndexOf(marker);
  if (markerIndex >= 0) {
    normalized = normalized.slice(markerIndex + marker.length);
  }

  normalized = normalized.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '');
  normalized = normalized.replace(/^\/+/, '');
  while (normalized.startsWith('mixes/')) {
    normalized = normalized.slice(6);
  }

  return normalized.replace(/\/+$/, '');
}

function normalizeMixId(mixId) {
  if (!mixId) return '';
  const raw = normalizeDJPath(mixId);
  if (!raw.includes('/')) return raw;
  const parts = raw.split('/');
  const file = parts.pop();
  const djPath = normalizeDJPath(parts.join('/'));
  return djPath && file ? `${djPath}/${file}` : raw;
}

function normalizeMixObject(mix) {
  if (!mix || typeof mix !== 'object') return mix;
  const normalized = { ...mix };

  if (normalized.djPath) normalized.djPath = normalizeDJPath(normalized.djPath);
  if (normalized.dj) normalized.dj = normalizeDJPath(normalized.dj);
  if (normalized.htmlPath) normalized.htmlPath = normalizeMixId(normalized.htmlPath);
  if (normalized.mixId) normalized.mixId = normalizeMixId(normalized.mixId);

  if (!normalized.djPath && normalized.dj) normalized.djPath = normalized.dj;
  if (!normalized.dj && normalized.djPath) normalized.dj = normalized.djPath;

  const identity = normalized.mixId || normalized.htmlPath;
  if (!normalized.file && identity && identity.includes('/')) {
    normalized.file = identity.split('/').pop();
  }

  return normalized;
}

function normalizePlayHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  if (entry.type !== 'mix') return { ...entry };

  const normalized = { ...entry };
  const identity = normalizeMixId(normalized.mixId || `${normalized.djPath || ''}/${normalized.file || ''}`);

  if (identity) {
    normalized.mixId = identity;
    const parts = identity.split('/');
    normalized.file = parts.pop();
    normalized.djPath = parts.join('/');
  } else if (normalized.djPath) {
    normalized.djPath = normalizeDJPath(normalized.djPath);
  }

  return normalized;
}

function normalizeStorageValue(key, value) {
  if (value === null || value === undefined) return value;

  if (key === 'currentDJ' || key === 'currentDJ_all') {
    return typeof value === 'string' ? normalizeDJPath(value) : value;
  }

  if (key === 'currentMixPath') {
    return typeof value === 'string' ? normalizeMixId(value) : value;
  }

  if (key === 'mixFavourites' || key === 'mixHidden') {
    if (!Array.isArray(value)) return value;
    return Array.from(new Set(value.map(v => normalizeMixId(v)).filter(Boolean)));
  }

  if (key === 'queue') {
    if (!Array.isArray(value)) return value;
    return value.map(normalizeMixObject);
  }

  if (key === 'playHistory') {
    if (!Array.isArray(value)) return value;
    return value.map(normalizePlayHistoryEntry);
  }

  return value;
}

function getMixId(mix) {
   if (!mix) return '';
   if (mix.mixId) return normalizeMixId(mix.mixId);
   if (mix.htmlPath) return normalizeMixId(mix.htmlPath);
   const djPath = normalizeDJPath(mix.djPath || mix.dj || '');
   return djPath && mix.file ? `${djPath}/${mix.file}` : '';
}

function safeDecodeURIComponent(value) {
  if (typeof value !== 'string') return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const storage = {
  get(key, defaultVal = null) {
    const val = localStorage.getItem(key);
    if (val === null) return defaultVal;
    const normalized = normalizeStorageValue(key, val);
    if (typeof normalized === 'string' && normalized !== val) {
      localStorage.setItem(key, normalized);
    }
    return normalized;
  },
  getNum(key, defaultVal = 0) {
    const val = localStorage.getItem(key);
    return val !== null ? parseFloat(val) : defaultVal;
  },
  getJSON(key, defaultVal = null) {
    try {
      const val = localStorage.getItem(key);
      if (val === null) return defaultVal;
      const parsed = JSON.parse(val);
      const normalized = normalizeStorageValue(key, parsed);
      if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
        localStorage.setItem(key, JSON.stringify(normalized));
      }
      return normalized;
    } catch { return defaultVal; }
  },
  getBool(key, defaultVal = false) {
    return localStorage.getItem(key) === 'true' || (localStorage.getItem(key) === null && defaultVal);
  },
  set(key, val) {
    const normalized = normalizeStorageValue(key, val);
    localStorage.setItem(key, typeof normalized === 'object' ? JSON.stringify(normalized) : normalized);
  },
  remove(key) {
    localStorage.removeItem(key);
  }
};

const aud = document.getElementById("audioPlayer");

// Web Audio API context and nodes — initialised lazily on first user interaction
// (browsers require a user gesture before creating an AudioContext)
let audioCtx = null;
let analyserNode = null;
let declickNode = null;
let gainNode = null;
let audioSourceNode = null;

function ensureAudioContext() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 128;
    analyserNode.smoothingTimeConstant = 0.3;
    declickNode = audioCtx.createGain();
    gainNode = audioCtx.createGain();
    audioSourceNode = audioCtx.createMediaElementSource(aud);
    // Chain: source → analyser → declick → gain → destination
    // Analyser sees full-level signal; declick handles pause/resume fades;
    // gain controls output volume.
    audioSourceNode.connect(analyserNode);
    analyserNode.connect(declickNode);
    declickNode.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    // Force HTML element to full volume — all attenuation via gainNode
    aud.volume = 1;
    aud.muted = false;
    // Apply persisted volume
    const saved = storage.getNum('playerVolume', 0.5);
    volume.set(saved);
}

// Volume control via gainNode — smooth, zipper-free, perceptual curve
const volume = {
    _level: storage.getNum('playerVolume', 0.5),  // linear 0-1 slider position
    _muted: false,
    _ramp: 0.015,  // single-pole LPF time constant (seconds)

    // Two-segment linear taper (audio pot approximation)
    // 0–50% slider → 0–35% gain, 50–100% slider → 35–100% gain
    _toGain(x) {
        if (x <= 0) return 0;
        if (x < 0.5) return x * 0.7;
        return 0.35 + (x - 0.5) * 1.3;
    },

    set(linear) {
        this._level = Math.max(0, Math.min(1, linear));
        this._muted = false;
        this._apply();
        storage.set('playerVolume', this._level);
    },

    get() {
        return this._level;
    },

    mute() {
        this._muted = true;
        this._apply();
    },

    unmute() {
        this._muted = false;
        this._apply();
    },

    toggleMute() {
        this._muted = !this._muted;
        this._apply();
    },

    isMuted() {
        return this._muted;
    },

    _apply() {
        if (!gainNode) return;
        const target = this._muted ? 0 : this._toGain(this._level);
        gainNode.gain.setTargetAtTime(target, audioCtx.currentTime, this._ramp);
    }
};

// Declick: fast fade-out before pause, fade-in after resume to eliminate glitches
const declick = {
    _tau: 0.005,     // 5ms time constant — 3τ (15ms) reaches 95%
    _wait: 0.020,    // 20ms settle time before acting on pause

    fadeOut() {
        if (!declickNode) return Promise.resolve();
        declickNode.gain.cancelScheduledValues(audioCtx.currentTime);
        declickNode.gain.setTargetAtTime(0, audioCtx.currentTime, this._tau);
        return new Promise(resolve => setTimeout(resolve, this._wait * 1000));
    },

    fadeIn() {
        if (!declickNode) return;
        declickNode.gain.cancelScheduledValues(audioCtx.currentTime);
        declickNode.gain.setTargetAtTime(1, audioCtx.currentTime, this._tau);
    }
};

const state = {
   currentPeaks: null,
   isResizing: false,
   currentMixes: [],
   currentDJ: storage.get('currentDJ', ''),
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

   showHiddenMixes: false,  // Ephemeral, not persisted
   isStream: false,         // Currently playing a stream (not a file)
   streamUrl: null,         // URL of current stream
   streamM3u: storage.get('streamM3u'), // Source playlist URL of current stream
   streamDisplayText: null  // Display text for current stream
   };

function setCurrentStream(url, displayText, streamM3u = null) {
  state.isStream = true;
  state.streamUrl = url;
  state.streamDisplayText = displayText;
  storage.set('streamUrl', url);
  storage.set('streamDisplayText', displayText);

  if (streamM3u) {
    state.streamM3u = streamM3u;
    storage.set('streamM3u', streamM3u);
  } else {
    state.streamM3u = null;
    storage.remove('streamM3u');
  }
}

function clearCurrentStream() {
  state.isStream = false;
  state.streamUrl = null;
  state.streamM3u = null;
  state.streamDisplayText = null;
  storage.remove('streamUrl');
  storage.remove('streamM3u');
  storage.remove('streamDisplayText');
}

   // Migrate old localStorage keys (liveStreamUrl → streamUrl, etc.)
   (function migrateStreamKeys() {
     const keyMap = {
       'liveStreamUrl': 'streamUrl',
       'liveStreamM3u': 'streamM3u',
       'liveDisplayText': 'streamDisplayText'
     };
     for (const [oldKey, newKey] of Object.entries(keyMap)) {
       const val = localStorage.getItem(oldKey);
       if (val !== null && localStorage.getItem(newKey) === null) {
         localStorage.setItem(newKey, val);
         localStorage.removeItem(oldKey);
       }
     }
   })();

   // Migrate legacy After Play Now setting to the new After Mix Ends setting.
   // stop -> stop, loop/continue -> continue (sound continues either way).
   (function migrateAfterPlayNowSetting() {
     if (localStorage.getItem('afterMixEnds') !== null) return;
     const legacy = localStorage.getItem('afterPlayNow');
     if (legacy === null) return;
     localStorage.setItem('afterMixEnds', legacy === 'stop' ? 'stop' : 'continue');
     localStorage.removeItem('afterPlayNow');
   })();

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

function showToast(message, durationSecs = 5) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; bottom: 20px; right: 20px;
    background: #4a4a4a; color: #fff; padding: 10px 20px;
    border-radius: 4px; z-index: 10000; animation: fadeOut ${durationSecs}s forwards;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), durationSecs * 1000);
}

function showAlertDialog(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmDialog');
    if (!modal) {
      resolve();
      return;
    }

    const titleEl = modal.querySelector('.confirm-title');
    const messageEl = modal.querySelector('.confirm-message');
    const cancelBtn = modal.querySelector('.confirm-cancel');
    const confirmBtn = modal.querySelector('.confirm-confirm');

    titleEl.textContent = title;
    messageEl.textContent = message;

    // Hide cancel, restyle confirm as neutral OK
    cancelBtn.style.display = 'none';
    const origText = confirmBtn.textContent;
    const origBg = confirmBtn.style.background;
    confirmBtn.textContent = 'OK';
    confirmBtn.style.background = '#5c6bc0';

    const content = modal.querySelector('.confirm-content');

    const cleanup = () => {
      confirmBtn.removeEventListener('click', onOk);
      document.removeEventListener('keydown', onKeydown);
      cancelBtn.style.display = '';
      confirmBtn.textContent = origText;
      confirmBtn.style.background = origBg;
      content.style.position = '';
      content.style.left = '';
      content.style.top = '';
    };

    const onOk = () => {
      cleanup();
      modal.style.display = 'none';
      resolve();
    };

    const onKeydown = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        onOk();
      }
    };

    confirmBtn.addEventListener('click', onOk);
    document.addEventListener('keydown', onKeydown);

    modal.style.display = 'flex';
    confirmBtn.focus();
  });
}

function showConfirmDialog(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmDialog');
    if (!modal) {
      console.error('confirmDialog modal not found');
      resolve(false);
      return;
    }
    
    const titleEl = modal.querySelector('.confirm-title');
    const messageEl = modal.querySelector('.confirm-message');
    const cancelBtn = modal.querySelector('.confirm-cancel');
    const confirmBtn = modal.querySelector('.confirm-confirm');
    
    if (!titleEl || !messageEl || !cancelBtn || !confirmBtn) {
      console.error('confirmDialog elements not found');
      resolve(false);
      return;
    }
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    
    const content = modal.querySelector('.confirm-content');
    
    // Handler functions
    const cleanup = () => {
      cancelBtn.removeEventListener('click', onCancel);
      confirmBtn.removeEventListener('click', onConfirm);
      document.removeEventListener('keydown', onKeydown);
      content.style.position = '';
      content.style.left = '';
      content.style.top = '';
    };
    
    const onCancel = () => {
      cleanup();
      modal.style.display = 'none';
      resolve(false);
    };
    
    const onConfirm = () => {
      cleanup();
      modal.style.display = 'none';
      resolve(true);
    };
    
    const onKeydown = (e) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter') {
        onConfirm();
      }
    };
    
    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    document.addEventListener('keydown', onKeydown);
    
    modal.style.display = 'flex';
    
    // Center modal on screen (don't try to position near button for confirm dialogs)
    // Confirm dialogs are important and should be centered/prominent
    content.style.position = 'auto';
    content.style.left = 'auto';
    content.style.top = 'auto';
    
    confirmBtn.focus();
  });
}
