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
    border-radius: 4px; z-index: 10000; animation: fadeOut 5s forwards;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
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
    
    // Capture triggering element position for positioning
    const btn = event && event.target.closest('button');
    let btnRect = null;
    if (btn) {
      btnRect = btn.getBoundingClientRect();
    }
    
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
