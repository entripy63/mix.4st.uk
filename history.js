// history.js - Play History
// Dependencies: core.js (state, storage, formatTime, escapeHtml, getMixId, aud)
//               player.js (playStream)
//               player-mix.js (playMix, getDJName)

const playHistory = {
  _entries: storage.getJSON('playHistory', []),
  _maxEntries: 20,
  _minEntries: 5,
  _expiryMs: 14 * 24 * 60 * 60 * 1000, // 2 weeks
  _skipNextRecord: false,

  // Snapshot the currently playing item into history
  record() {
    if (this._skipNextRecord) {
      this._skipNextRecord = false;
      return;
    }
    const entry = this._buildCurrentEntry();
    if (!entry) return;

    // Deduplicate: find existing entry with same identity
    const existingIndex = this._findEntry(entry);

    if (existingIndex >= 0) {
      this._entries[existingIndex] = entry;
    } else {
      this._entries.unshift(entry);
    }

    this._prune();
    this._save();
    this.display();
  },

  // Update position of current item without adding new entry
  updatePosition() {
    if (state.isStream || aud.paused || !aud.currentTime) return;
    const mixId = state.currentMix ? getMixId(state.currentMix) : null;
    if (!mixId) return;

    const entry = this._entries.find(e => e.type === 'mix' && e.mixId === mixId);
    if (entry) {
      entry.position = aud.currentTime;
      entry.timestamp = Date.now();
      this._save();
    }
  },

  _findEntry(entry) {
    if (entry.type === 'mix') {
      return this._entries.findIndex(e => e.type === 'mix' && e.mixId === entry.mixId);
    }
    return this._entries.findIndex(e => e.type === 'stream' && e.streamUrl === entry.streamUrl);
  },

  _buildCurrentEntry() {
    if (state.isStream && state.streamUrl) {
      return {
        type: 'stream',
        streamUrl: state.streamUrl,
        streamM3u: state.streamM3u || null,
        streamDisplayText: state.streamDisplayText || state.streamUrl,
        position: null,
        timestamp: Date.now()
      };
    } else if (state.currentMix) {
      const mix = state.currentMix;
      return {
        type: 'mix',
        mixId: getMixId(mix),
        djPath: mix.djPath,
        file: mix.file,
        name: mix.name,
        artist: mix.artist || getDJName(mix.htmlPath || mix.djPath),
        duration: mix.duration || null,
        audioFile: mix.audioFile,
        peaksFile: mix.peaksFile || null,
        coverFile: mix.coverFile || null,
        downloads: mix.downloads || null,
        position: aud.currentTime || 0,
        timestamp: Date.now()
      };
    }
    return null;
  },

  _prune() {
    this._entries.sort((a, b) => b.timestamp - a.timestamp);
    const now = Date.now();
    if (this._entries.length > this._minEntries) {
      this._entries = this._entries.filter((entry, i) =>
        i < this._minEntries || (now - entry.timestamp) < this._expiryMs
      );
    }
    if (this._entries.length > this._maxEntries) {
      this._entries = this._entries.slice(0, this._maxEntries);
    }
  },

  _save() {
    storage.set('playHistory', this._entries);
  },

  display() {
    const container = document.getElementById('playHistory');
    if (!container) return;

    if (this._entries.length === 0) {
      container.innerHTML = '';
      return;
    }

    const currentMixId = (!state.isStream && state.currentMix) ? getMixId(state.currentMix) : null;
    const currentStreamUrl = state.isStream ? state.streamUrl : null;

    // Filter out the currently playing item — the Player/Now Playing area already shows it
    const visible = this._entries.filter(entry => {
      if (entry.type === 'mix' && currentMixId === entry.mixId) return false;
      if (entry.type === 'stream' && currentStreamUrl === entry.streamUrl) return false;
      return true;
    });

    if (visible.length === 0) {
      container.innerHTML = '';
      return;
    }

    const header = '<div class="history-header">Recent</div>';
    const rows = visible.map((entry) => {
      // Use original index for the onclick handler
      const i = this._entries.indexOf(entry);

      if (entry.type === 'stream') {
        return `<div class="mix-item">
          <div class="mix-item-row">
            <span class="mix-name"><span style="font-size: 0.85em;">📡</span> ${escapeHtml(entry.streamDisplayText)}</span>
            <button class="icon-btn" onclick="resumeFromHistory(${i})" title="Resume Now">▶</button>
          </div>
        </div>`;
      } else {
        const djName = entry.artist ? ` - ${escapeHtml(entry.artist)}` : '';
        const duration = entry.duration ? `(${entry.duration})` : '';
        const posText = entry.position > 0 ? `<span class="history-position">${formatTime(entry.position)}</span>` : '';
        return `<div class="mix-item">
          <div class="mix-item-row">
            <span class="mix-name">♪ ${escapeHtml(entry.name)}${djName} <span class="mix-duration">${duration}</span></span>
            ${posText}
            <button class="icon-btn" onclick="resumeFromHistory(${i})" title="Resume Now">▶</button>
          </div>
        </div>`;
      }
    }).join('');

    container.innerHTML = header + rows;
  }
};

async function resumeFromHistory(index) {
  const entry = playHistory._entries[index];
  if (!entry) return;

  // Snapshot current item before switching
  playHistory.record();

  // Clear stale track list / cover art from previous item immediately
  const trackList = document.getElementById('trackList');
  const coverArt = document.getElementById('coverArt');
  if (trackList) trackList.innerHTML = '';
  if (coverArt) coverArt.innerHTML = '';

  if (entry.type === 'stream') {
    state.streamM3u = entry.streamM3u;
    if (entry.streamM3u) storage.set('streamM3u', entry.streamM3u);
    playStream(entry.streamUrl, entry.streamDisplayText, true);
  } else {
    const mix = {
      name: entry.name,
      file: entry.file,
      audioFile: entry.audioFile,
      djPath: entry.djPath,
      artist: entry.artist,
      duration: entry.duration,
      peaksFile: entry.peaksFile,
      coverFile: entry.coverFile,
      downloads: entry.downloads
    };

    const savedPosition = entry.position || 0;

    // Use load-then-seek-then-play pattern (like restore.js) because
    // play() resets currentTime to 0 after the async declick fade.
    const details = await fetchMixDetails(mix);
    if (details.audioSrc) {
      // Skip the historyRecord() call inside playMix — we already recorded above
      playHistory._skipNextRecord = true;

      // Set up mix state and UI (mirrors playMix without calling play())
      document.title = `${mix.name} - Player`;
      state.currentMix = mix;
      const streamTitle = document.getElementById('streamTitle');
      if (streamTitle) { streamTitle.textContent = ''; streamTitle.style.display = 'none'; }
      const mixId = mix.htmlPath || `${mix.djPath}/${mix.file}`;
      storage.set('currentMixPath', mixId);
      state.currentDownloadLinks = details.downloadLinks || [];
      state.currentCoverSrc = details.coverSrc;
      displayTrackList(mix, details.trackListTable, details.downloadLinks, details.coverSrc);
      loadPeaks(details.peaks);
      displayQueue();

      // Load audio without playing, seek, then play
      await load(details.audioSrc);

      const startPlayback = () => {
        aud.currentTime = savedPosition;
        ensureAudioContext();
        aud.play().catch(() => {});
        declick.fadeIn();
        startVisualiser();
        startTempo();
      };

      if (aud.readyState >= 1) {
        startPlayback();
      } else {
        aud.addEventListener('loadedmetadata', startPlayback, { once: true });
      }
    }
  }

  // Update entry timestamp
  entry.timestamp = Date.now();
  playHistory._save();
  playHistory.display();
}

// Record history when playback changes (called from playMix/playLiveStream/etc.)
function historyRecord() {
  playHistory.record();
}

// Periodic position update (every 30s)
setInterval(() => playHistory.updatePosition(), 30000);

// Update position on beforeunload
window.addEventListener('beforeunload', () => playHistory.updatePosition());

// Refresh display when playback state changes
aud.addEventListener('play', () => playHistory.display());
document.addEventListener('streamModeEntered', () => playHistory.display());

// Initial display
playHistory.display();
