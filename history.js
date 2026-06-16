// history.js - Play History
// Dependencies: core.js (state, storage, formatTime, escapeHtml, getMixId, aud)
//               player.js (playStream, playAt)
//               player-mix.js (playMix, getDJName)

const playHistory = {
  _entries: (storage.getJSON('playHistory', []) || []).map(normalizePlayHistoryEntry),
  _maxEntries: 20,
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
        djPath: normalizeDJPath(mix.djPath),
        file: mix.file,
        name: mix.name,
        artist: mix.artist || getDJName(mix.htmlPath || mix.djPath),
        duration: mix.duration || null,
        audioFile: mix.audioFile,
        hasTracklist: mix.hasTracklist || false,
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
    if (this._entries.length > this._maxEntries) {
      this._entries = this._entries.slice(0, this._maxEntries);
    }
  },

  _save() {
    storage.set('playHistory', this._entries);
  },

  // Proactively repair stream entries whose proxy has been removed from the
  // config, so the Recent list works on load without waiting for a play attempt.
  // Unrecoverable entries are left untouched (they may work again if the proxy
  // or stream returns). Silent on failure to avoid toast noise during load.
  //
  // config.shouldRedisplayAfterProbe: guard callback checked AFTER each (async)
  // probe completes, just before redisplaying. The user may have switched the
  // right column to the Tracks/Art tab while the probe ran, so we always persist
  // the repaired URL but only redisplay when the Recent pane is still visible.
  async refreshStaleProxies(config = {}) {
    await loadProxyConfig();
    for (const entry of this._entries) {
      if (entry.type !== 'stream' || !entry.streamUrl) continue;
      if (isProxyCurrent(entry.streamUrl)) continue;
      // Skip the currently-playing stream: re-probing it can trip
      // single-connection-per-IP servers and drop live playback.
      if (state.streamM3u && entry.streamM3u === state.streamM3u) continue;
      const fresh = await refreshProxiedUrl(entry.streamUrl, entry.streamM3u || null);
      if (fresh) {
        entry.streamUrl = fresh;
        this._save();
        if (!config.shouldRedisplayAfterProbe || config.shouldRedisplayAfterProbe()) {
          this.display();
        }
      }
    }
  },

  display() {
    const container = document.getElementById('playHistory');
    if (!container) return;

    if (this._entries.length === 0) {
      container.innerHTML = '';
      updateRightTabs();
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
      updateRightTabs();
      return;
    }

    const header = '<div class="history-header">Recent</div>';
    const rows = visible.map((entry) => {
      // Use original index for the onclick handler
      const i = this._entries.indexOf(entry);

      if (entry.type === 'stream') {
        return `<div class="mix-item">
          <div class="mix-item-row">
            <button class="delete-btn" onclick="removeFromHistory(${i})" title="Remove from history">✕</button>
            <span class="mix-name"><span style="font-size: 0.85em;">📡</span> ${escapeHtml(entry.streamDisplayText)}</span>
            <button class="icon-btn" onclick="resumeFromHistory(${i})" title="Resume Now">▶</button>
          </div>
        </div>`;
      } else {
        const djName = entry.artist ? ` - ${escapeHtml(entry.artist)}` : '';
        const pos = entry.position > 0 ? formatTime(entry.position) : '';
        const dur = entry.duration || '';
        const timeText = pos && dur ? `(<span class="history-position">${pos}</span> / ${dur})`
          : pos ? `(<span class="history-position">${pos}</span>)`
          : dur ? `(${dur})` : '';
        return `<div class="mix-item">
          <div class="mix-item-row">
            <button class="delete-btn" onclick="removeFromHistory(${i})" title="Remove from history">✕</button>
            <span class="mix-name">♪ ${escapeHtml(entry.name)}${djName} <span class="mix-duration">${timeText}</span></span>
            <button class="icon-btn" onclick="resumeFromHistory(${i})" title="Resume Now">▶</button>
          </div>
        </div>`;
      }
    }).join('');

    container.innerHTML = header + rows;
    updateRightTabs();
  }
};

function removeFromHistory(index) {
  playHistory._entries.splice(index, 1);
  playHistory._save();
  playHistory.display();
}

async function resumeFromHistory(index) {
  const entry = playHistory._entries[index];
  if (!entry) return;

  // Snapshot current item before switching
  playHistory.record();

  // Clear stale track list / cover art from previous item immediately
  const trackList = document.getElementById('trackList');
  const coverArt = document.getElementById('coverArt');
  const actionBar = document.getElementById('actionBar');
  if (trackList) trackList.innerHTML = '';
  if (coverArt) coverArt.innerHTML = '';
  if (actionBar) actionBar.innerHTML = '';

  if (entry.type === 'stream') {
    let url = entry.streamUrl;
    // Repair a stored URL whose proxy has been removed from the config.
    if (!isProxyCurrent(url)) {
      const fresh = await refreshProxiedUrl(url, entry.streamM3u || null);
      if (!fresh) {
        showToast('Stream is no longer reachable');
        return;
      }
      url = fresh;
      entry.streamUrl = url;
      playHistory._save();
    }
    beacon('stream-play', entry.streamDisplayText, 'history');
    setCurrentStream(url, entry.streamDisplayText, entry.streamM3u || null);
    playStream(url, entry.streamDisplayText, true);
  } else {
    const mix = {
      name: entry.name,
      file: entry.file,
      audioFile: entry.audioFile,
      djPath: normalizeDJPath(entry.djPath),
      artist: entry.artist,
      duration: entry.duration,
      hasTracklist: entry.hasTracklist || false,
      coverFile: entry.coverFile,
      downloads: entry.downloads
    };

    const savedPosition = entry.position || 0;

    const details = await fetchMixDetails(mix);
    if (details.audioSrc) {
      // Skip the historyRecord() call inside playMix — we already recorded above
      playHistory._skipNextRecord = true;
      // Detach from queue so the ended handler doesn't advance to the next
      state.currentQueueIndex = -1;
      beacon('mix-play', getMixId(mix) || mix.name, 'history');

      // Set up mix state and UI (mirrors playMix without calling play())
      document.title = `${mix.name} - Player`;
      state.currentMix = mix;
      const streamTitle = document.getElementById('streamTitle');
      if (streamTitle) { streamTitle.textContent = ''; streamTitle.style.display = 'none'; }
      const mixId = getMixId(mix);
      storage.set('currentMixPath', mixId);
      state.currentDownloadLinks = details.downloadLinks || [];
      state.currentCoverSrc = details.coverSrc;
      displayTrackList(mix, details.trackListTable, details.coverSrc);
      loadPeaks(details.peaks);
      displayQueue();

      await playAt(details.audioSrc, savedPosition);
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
