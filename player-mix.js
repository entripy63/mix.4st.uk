// player-mix.js - Mix Playback, Queue Integration, Waveform, Favourites
// Dependencies: core.js (state, storage, getMixId, escapeHtml, aud)
//               player.js (play, load, updateTimeDisplay, updatePlayPauseBtn, updateMuteBtn)
//               visualiser.js (startVisualiser, stopVisualiser)
//               mixes.js (fetchMixDetails, state.currentMixes)
//               queue.js (playFromQueue, saveQueue, displayQueue, updateQueueInfo)
//               browser.js (filterMixes, displayMixList, displaySearchResults, displayFavourites)

// DOM references (player.html only)
const waveformCanvas = document.getElementById("waveform");

// ============================================
// MIX FLAGS (player.html only)
// ============================================

const mixFlags = {
    _favourites: new Set(storage.getJSON('mixFavourites', [])),
    _hidden: new Set(storage.getJSON('mixHidden', [])),

    // Migrate old DJ paths (aboo/DJAboo) to new paths (mixes/aboo/DJAboo)
    _migrateOldPaths() {
        const migrateSet = (set) => {
            const migrated = new Set();
            for (const id of set) {
                // Check if path already has mixes/ prefix
                if (id.startsWith('mixes/')) {
                    migrated.add(id);
                } else {
                    // Check if it's a moreDJs path or a main DJ path
                    if (id.startsWith('moreDJs/')) {
                        migrated.add('mixes/' + id);
                    } else {
                        // Main DJ path: add mixes/ prefix
                        migrated.add('mixes/' + id);
                    }
                }
            }
            return migrated;
        };
        this._favourites = migrateSet(this._favourites);
        this._hidden = migrateSet(this._hidden);
        this._save();
    },

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
    
    // Run migration on load
    mixFlags._migrateOldPaths();
    
    function updateFavouritesButton() {
    const btn = document.querySelector('.mode-btn[data-mode="favourites"]');
    if (btn) btn.disabled = !mixFlags.hasFavourites();
}

// ============================================
// WAVEFORM CODE (player.html only)
// ============================================

const waveformCtx = waveformCanvas.getContext("2d");

// Set canvas resolution to match CSS size (both peaks and visualiser overlay)
function resizeWaveformCanvas() {
    const w = waveformCanvas.offsetWidth || 500;
    const h = waveformCanvas.offsetHeight || 60;
    if (waveformCanvas.width !== w) waveformCanvas.width = w;
    if (waveformCanvas.height !== h) waveformCanvas.height = h;
    resizeVisualiserCanvas();
    if (state.currentPeaks) {
        const progress = aud.duration ? aud.currentTime / aud.duration : 0;
        drawWaveform(state.currentPeaks, progress);
    }
}
resizeWaveformCanvas();
window.addEventListener('load', resizeWaveformCanvas);

function drawWaveform(peaks, progress = 0) {
    waveformCanvas.style.cursor = peaks.length ? 'pointer' : '';
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

    // Draw cursor line (shorter when BPM debug overlay is active)
    if (progress > 0) {
        const cursorX = w * progress;
        waveformCtx.strokeStyle = '#fff';
        waveformCtx.lineWidth = 2;
        waveformCtx.beginPath();
        waveformCtx.moveTo(cursorX, 0);
        waveformCtx.lineTo(cursorX, isTempoDebugEnabled() ? h - 14 : h);
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

// Click on waveform to seek (only when peaks are loaded, i.e. a mix is playing)
waveformCanvas.addEventListener('click', function (e) {
    if (!state.currentPeaks) return;
    e.preventDefault();
    e.stopPropagation();
    
    if (aud.duration && isFinite(aud.duration)) {
        const rect = waveformCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const progress = Math.max(0, Math.min(1, x / rect.width));
        let newTime = progress * aud.duration;
        
        // Clamp to seekable range
        if (aud.seekable.length > 0) {
            const seekableEnd = aud.seekable.end(aud.seekable.length - 1);
            newTime = Math.min(newTime, seekableEnd);
        }
        
        if (isFinite(newTime)) {
            aud.currentTime = newTime;
            updateWaveformCursor();
        }
    }
});

// Initialize with empty waveform
state.currentPeaks = null;
drawWaveform([], 0);

// Waveform resize handling
const resizeHandle = document.getElementById('waveformResizeHandle');
const waveformContainer = document.getElementById('waveformContainer');

// Restore saved height
const savedHeight = storage.getNum('waveformHeight', 0);
if (savedHeight) {
    waveformContainer.style.height = savedHeight + 'px';
    waveformCanvas.height = savedHeight;
    resizeVisualiserCanvas();
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
    const rect = waveformContainer.getBoundingClientRect();
    let newHeight = clientY - rect.top;
    newHeight = Math.max(30, Math.min(200, newHeight));
    waveformContainer.style.height = newHeight + 'px';
    waveformCanvas.height = newHeight;
    resizeVisualiserCanvas();
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

// Update queue info on play/pause (queue.js functions)
aud.addEventListener("play", updateQueueInfo);
aud.addEventListener("pause", updateQueueInfo);

// ============================================
// MIX PLAYBACK CODE
// ============================================

function getDJName(htmlPath) {
    if (!htmlPath) return '';
    const dir = htmlPath.split('/')[0];
    const djNames = { 'trip': 'trip-', 'izmar': 'Izmar' };
    return djNames[dir] || dir;
}

async function playMix(mix) {
    historyRecord();
    document.title = `${mix.name} - Player`;
    state.currentMix = mix;

    // Hide stream title when playing a DJ mix
    const streamTitle = document.getElementById('streamTitle');
    if (streamTitle) { streamTitle.textContent = ''; streamTitle.style.display = 'none'; }

    if (mix.isLocal) {
        storage.remove('currentMixPath');
        state.currentDownloadLinks = [];
        state.currentCoverSrc = null;
        play(mix.audioSrc);
        displayTrackList(mix, '', null);
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
            displayTrackList(mix, details.trackListTable, details.coverSrc);
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

function displayTrackList(mix, table, coverSrc) {
    const nowPlayingDiv = document.getElementById('nowPlaying');
    const trackListDiv = document.getElementById('trackList');
    const coverArtDiv = document.getElementById('coverArt');

    // Show mix name and artist immediately below player
    const mixName = mix ? escapeHtml(mix.name) : '';
    const djName = mix ? escapeHtml(mix.artist || getDJName(mix.htmlPath || mix.djPath)) : '';
    nowPlayingDiv.innerHTML = mixName ? `<h1>${mixName} by ${djName}</h1>` : '';

    // Track list content only
    trackListDiv.innerHTML = table || '';

    // Cover art (available in its own tab now, independent of track list)
    if (coverSrc) {
        coverArtDiv.innerHTML = `<img src="${coverSrc}" alt="Cover art">`;
    } else {
        coverArtDiv.innerHTML = '';
    }

    // Action bar in separate div
    displayActionBar();

    // Update tabs - prefer tracks if available, then art
    const prefer = table ? 'tracks' : coverSrc ? 'art' : null;
    updateRightTabs(prefer);
}

function displayActionBar() {
    const actionBarDiv = document.getElementById('actionBar');
    if (!actionBarDiv) return;

    const mix = state.currentMix;
    if (!mix) {
        actionBarDiv.innerHTML = '';
        return;
    }

    const mixId = getMixId(mix);
    const downloadLinks = state.currentDownloadLinks || [];
    const hasDownloads = downloadLinks.length > 0;
    const canFlag = mixId && !mix.isLocal;

    if (!hasDownloads && !canFlag) {
        actionBarDiv.innerHTML = '';
        return;
    }

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

    actionBarDiv.innerHTML = `<div class="action-bar">
      <div class="action-left">${downloadBtns}</div>
      <div class="action-right">${flagBtns}</div>
    </div>`;
}

function switchRightTab(tab) {
    const panes = {
        history: document.getElementById('playHistory'),
        tracks: document.getElementById('trackList'),
        art: document.getElementById('coverArt')
    };

    for (const [id, el] of Object.entries(panes)) {
        if (el) el.style.display = id === tab ? '' : 'none';
    }

    document.querySelectorAll('.right-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
}

function updateRightTabs(preferTab) {
    const tabs = [
        { id: 'history', el: document.getElementById('playHistory'), label: 'Recent' },
        { id: 'tracks', el: document.getElementById('trackList'), label: 'Tracks' },
        { id: 'art', el: document.getElementById('coverArt'), label: 'Art' }
    ];

    const available = tabs.filter(t => t.el && t.el.innerHTML.trim() !== '');
    const tabBar = document.getElementById('rightTabBar');
    if (!tabBar) return;

    if (available.length <= 1) {
        // Hide tab bar, show the one pane (or none)
        tabBar.style.display = 'none';
        tabs.forEach(t => {
            if (t.el) t.el.style.display = available.includes(t) ? '' : 'none';
        });
        return;
    }

    // Multiple tabs have content — show tab bar
    tabBar.style.display = '';

    // Determine which tab to activate
    let active = preferTab && available.find(t => t.id === preferTab) ? preferTab : null;
    if (!active) {
        // Keep current active if still available
        const currentBtn = tabBar.querySelector('.right-tab.active');
        if (currentBtn && available.find(t => t.id === currentBtn.dataset.tab)) {
            active = currentBtn.dataset.tab;
        }
    }
    if (!active) active = available[0].id;

    // Update tab button visibility and active state
    tabBar.querySelectorAll('.right-tab').forEach(btn => {
        const tab = tabs.find(t => t.id === btn.dataset.tab);
        btn.style.display = available.includes(tab) ? '' : 'none';
        btn.classList.toggle('active', btn.dataset.tab === active);
    });

    // Show/hide panes
    tabs.forEach(t => {
        if (t.el) t.el.style.display = t.id === active ? '' : 'none';
    });
}

function toggleCurrentFavourite() {
    if (!state.currentMix) return;
    const mixId = getMixId(state.currentMix);
    mixFlags.toggleFavourite(mixId);
    displayActionBar();
    refreshBrowserList();
}

function toggleCurrentHidden() {
    if (!state.currentMix) return;
    const mixId = getMixId(state.currentMix);
    mixFlags.toggleHidden(mixId);
    displayActionBar();
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

// Listen for live stream events and clear DJ mix UI
document.addEventListener('streamModeEntered', () => {
    storage.remove('currentMixPath');
    loadPeaks(null);
    const coverArt = document.getElementById('coverArt');
    const trackList = document.getElementById('trackList');
    const actionBar = document.getElementById('actionBar');
    const streamTitle = document.getElementById('streamTitle');
    if (coverArt) coverArt.innerHTML = '';
    if (trackList) trackList.innerHTML = '';
    if (actionBar) actionBar.innerHTML = '';
    if (streamTitle) { streamTitle.textContent = ''; streamTitle.style.display = 'block'; }
    updateRightTabs();
});

// Update stream title from ICY metadata
document.addEventListener('streamMetadata', (e) => {
    const title = e.detail?.metadata?.StreamTitle;
    const streamTitle = document.getElementById('streamTitle');
    if (streamTitle && title) {
        streamTitle.textContent = title;
    }
});


