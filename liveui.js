// liveui.js - Live stream UI rendering and interactions
// Dependencies: core.js (state, storage, escapeHtml, showToast)
//               player.js (playLive, stopLive, updatePlayPauseBtn)
//               livedata.js (stream management, probing, parsing)
//               modals.js (showPlaylistGuide, hidePlaylistGuide, showPresetsMenu, hidePresetsMenu)

// ========== TARGET ELEMENT HELPERS ==========

function getStreamListTarget() {
  return document.getElementById('userStreamsList');
}

// Guard: check if user streams are currently visible and should be redisplayed
function shouldRedisplayStreams() {
  return document.getElementById('userStreamsTab')?.style.display !== 'none';
}

// ========== MIDDLE COLUMN TAB SWITCHING ==========

function switchMiddleTab(tab) {
  const queueTab = document.getElementById('queueTab');
  const userStreamsTab = document.getElementById('userStreamsTab');
  if (!queueTab || !userStreamsTab) return; // Not on player.html

  queueTab.style.display = tab === 'queue' ? '' : 'none';
  userStreamsTab.style.display = tab === 'userStreams' ? '' : 'none';

  document.querySelectorAll('.middle-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  const queueActions = document.getElementById('queueTabActions');
  if (queueActions) {
    queueActions.style.display = tab === 'queue' ? '' : 'none';
  }

  const streamActions = document.getElementById('streamTabActions');
  if (streamActions) {
    streamActions.style.display = tab === 'userStreams' ? '' : 'none';
  }

  storage.set('middleTab', tab);

  // If switching to user streams, ensure they're displayed
  if (tab === 'userStreams') {
    displayLiveStreams();
  }
}

// ========== PRESET CATEGORY BUTTONS ==========

async function renderPresetButtons(container) {
    const categories = await getAvailableCategories();
    
    if (categories.length === 0) return;
    
    let html = '';
    for (const category of categories) {
        const label = category.charAt(0).toUpperCase() + category.slice(1);
        html += `<button onclick="showPresetsMenu(event, '${category}')">Add ${label}</button>`;
    }
    
    container.innerHTML = html;
}

// ========== LIVE STREAM DISPLAY ==========

function displayLiveStreams() {
  const target = getStreamListTarget();
  
  if (!liveStreamsInitialized) {
    target.innerHTML = '<div style="padding: 20px; color: #888;">Checking stream availability...</div>';
    return;
  }
  
  let html = '';
  
  if (liveStreams.length === 0) {
    html += '<div style="padding: 20px; color: #888;">No live streams configured</div>';
  }
  
  // Stream list
  liveStreams.forEach((stream, index) => {
    const unavailableClass = stream.available ? '' : ' unavailable';
    const tooltip = stream.available ? 'Play Now' : (stream.reason || 'Unavailable');
    const disabled = stream.available ? '' : ' disabled';
    const deleteBtn = `<button class="delete-btn" onclick="handleRemoveStream(${index})" title="Remove stream">✕</button>`;
    const infoBtn = `<button class="icon-btn info-btn" data-action="toggle-stream-info" title="More info">ⓘ</button>`;
    const infoPopout = `<div class="stream-extra-info" style="display:none">
      <div class="stream-info-field">
        <strong>Stream URL:</strong>
        <a href="${escapeHtml(stream.url || stream.m3u)}" target="_blank" rel="noopener">${escapeHtml(decodeURIComponent(stream.url || stream.m3u))}</a>
      </div>
      <div class="stream-info-field">
        <strong>Name:</strong>
        <input type="text" class="stream-edit-name" value="${escapeHtml(stream.name)}" placeholder="Stream name" data-index="${index}" />
      </div>
      <div class="stream-info-field">
        <strong>Genre:</strong>
        <input type="text" class="stream-edit-genre" value="${escapeHtml(stream.genre || '')}" placeholder="Genre" data-index="${index}" />
      </div>
    </div>`;
    
    html += `
      <div class="mix-item${unavailableClass}"
           data-stream-m3u="${escapeHtml(stream.m3u)}"
           draggable="true"
           ondragstart="onLiveStreamDragStart(event, ${index})"
           ondragend="onLiveStreamDragEnd()">
        <div class="mix-item-row"
             ondragover="onLiveStreamDragOver(event)"
             ondrop="onLiveStreamDrop(event, ${index})">
           ${deleteBtn}
           <div class="stream-info">
            <span class="mix-name">${escapeHtml(stream.name)}</span>
            ${stream.genre && stream.genre !== 'Unknown' ? `<span class="stream-genre">${escapeHtml(stream.genre)}</span>` : ''}
          </div>
          ${infoBtn}<button class="icon-btn" onclick="playLiveStream(${index})"${disabled} title="${escapeHtml(tooltip)}">▶</button>
        </div>
        ${infoPopout}
      </div>
    `;
  });
  
  // Add stream form — placed after the stream list so input sits at the bottom
  html += `
    <div class="add-stream-form">
      <div class="add-stream-fields">
        <input type="text" id="newStreamM3U" placeholder="Playlist URL (M3U or PLS)" />
        <button class="tab-action-btn add-stream-plus" onclick="handleAddStream()" title="Add stream">＋</button>
      </div>
    </div>
  `;
  
  target.innerHTML = html;
}

function toggleStreamInfo(btn) {
  const info = btn.closest('.mix-item').querySelector('.stream-extra-info');
  if (info) {
    info.style.display = info.style.display === 'none' ? 'block' : 'none';
  }
}

// ========== STREAM PLAYBACK ==========

function playLiveStream(index) {
  const stream = liveStreams[index];
  if (!stream) return;
  
  if (!stream.available) {
    showAlertDialog('Stream Unavailable', stream.reason || 'Unknown reason');
    return;
  }
  
  const name = stream.name || stream.m3u;
  const url = stream.url;
  
  state.isLive = true;
  state.liveStreamUrl = url;
  state.liveStreamM3u = stream.m3u;
  state.liveDisplayText = name;
  storage.set('liveStreamUrl', url);
  storage.set('liveStreamM3u', stream.m3u);
  storage.set('liveDisplayText', name);
  
  playLive(url, name, true);
  displayLiveStreams();
}

// ========== STREAM MANAGEMENT HANDLERS ==========

async function handleAddStream() {
     const m3u = document.getElementById('newStreamM3U').value.trim();

     if (!m3u) {
       showAlertDialog('Add Stream', 'Playlist URL is required.');
       return;
     }

     if (!m3u.startsWith('http://') && !m3u.startsWith('https://')) {
       showAlertDialog('Add Stream', 'Playlist URL must start with http:// or https://');
       return;
     }

     // Add stream with no name, let playlist title be parsed from m3u
     await addUserStream(null, m3u, null);
     if (shouldRedisplayStreams()) {
       displayLiveStreams();
       // Open info pane for the newly added stream (last in list)
       const target = getStreamListTarget();
       const items = target.querySelectorAll('.mix-item');
       const lastItem = items[items.length - 1];
       if (lastItem) {
         const info = lastItem.querySelector('.stream-extra-info');
         if (info) info.style.display = 'block';
       }
       // Scroll to bottom so info pane and add-stream form are visible
       const scrollContainer = document.getElementById('userStreamsTab');
       if (scrollContainer) {
         scrollContainer.scrollTop = scrollContainer.scrollHeight;
       }
     }
}

async function handleRemoveStream(index) {
     const confirmed = await showConfirmDialog('Remove Stream', 'Are you sure you want to remove this stream?');
     if (confirmed) {
       // Remove from both liveStreams and storage, keeping them in sync
       if (index >= 0 && index < liveStreams.length) {
         const m3u = liveStreams[index].m3u;
         liveStreams.splice(index, 1);
         // Also remove from storage
         const configs = getUserStreams();
         const storageIndex = configs.findIndex(c => c.m3u === m3u);
         if (storageIndex >= 0) {
           configs.splice(storageIndex, 1);
           saveUserStreams(configs);
         }
       }
       if (shouldRedisplayStreams()) {
         displayLiveStreams();
       }
     }
}

async function reloadLiveStreams() {
    liveStreamsInitialized = false;
    liveStreams = [];
    if (shouldRedisplayStreams()) {
      displayLiveStreams(); // Shows "Checking..." message
    }
    const config = {
      shouldRedisplayAfterProbe: shouldRedisplayStreams
    };
    await initLiveStreams(config);
}

// ========== DRAG & DROP REORDERING ==========

function onLiveStreamDragStart(e, index) {
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', index);
  e.target.style.opacity = '0.5';
}

function onLiveStreamDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function onLiveStreamDrop(e, dropIndex) {
  e.preventDefault();
  const dragIndex = parseInt(e.dataTransfer.getData('text/plain'));
  
  if (dragIndex === dropIndex) return;
  
  // Follow canonical pattern: Update userStreams first
  const configs = getUserStreams();
  const temp = configs[dragIndex];
  configs.splice(dragIndex, 1);
  configs.splice(dropIndex, 0, temp);
  saveUserStreams(configs);
  
  // Step 2: Keep liveStreams in sync with new order
  if (liveStreamsInitialized) {
    const tempLive = liveStreams[dragIndex];
    liveStreams.splice(dragIndex, 1);
    liveStreams.splice(dropIndex, 0, tempLive);
  }
  
  // Refresh display
  if (shouldRedisplayStreams()) {
    displayLiveStreams();
  }
}

function onLiveStreamDragEnd(e) {
  if (e && e.target) {
    e.target.style.opacity = '1';
  }
}

// Drag/drop handlers are attached inline via ondragstart/ondrop/etc in displayLiveStreams()

// ========== STREAM COLLECTIONS MENU ==========

function toggleStreamCollectionsMenu() {
  const menu = document.getElementById('streamCollectionsMenu');
  if (!menu) return; // Menu created by displayLiveStreams()
  
  const isHidden = menu.style.display === 'none';
  menu.style.display = isHidden ? 'block' : 'none';
}

function hideStreamCollectionsMenu() {
  const menu = document.getElementById('streamCollectionsMenu');
  if (menu) {
    menu.style.display = 'none';
  }
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
   const menu = document.getElementById('streamCollectionsMenu');
   const container = menu?.parentElement;
   if (menu && container && !container.contains(e.target)) {
      hideStreamCollectionsMenu();
   }
});

// ========== PRESET SELECTION ==========

async function selectPreset(index) {
    const presets = window._currentPresets;
    if (!presets || !presets[index]) return;
    
    hidePresetsMenu();
    hideStreamCollectionsMenu();
    await addStreamsFromPreset(presets[index]);
}

// Add streams from a preset, skipping duplicates
async function addStreamsFromPreset(preset) {
     const currentStreams = getUserStreams();
     const existingM3Us = new Set(currentStreams.map(s => s.m3u));
     
     let added = 0;
     let skipped = 0;
     
     for (const stream of preset.streams) {
         if (existingM3Us.has(stream.m3u)) {
             skipped++;
             continue;
         }
         
         // addUserStream will probe and add to liveStreams if initialized
         await addUserStream(stream.name || null, stream.m3u, stream.genre || null);
         added++;
         
         // Update display after each stream is added for progress feedback
         if (shouldRedisplayStreams()) {
           displayLiveStreams();
         }
     }
    
    showToast(`Added ${added} stream${added !== 1 ? 's' : ''}${skipped > 0 ? `, skipped ${skipped} duplicate${skipped !== 1 ? 's' : ''}` : ''}`);
}

// ========== PRESET BROWSER (for browser Live mode) ==========

let _presetCache = null;

async function getPresets() {
  if (!_presetCache) {
    _presetCache = await loadAvailablePresets();
  }
  return _presetCache;
}

async function buildPresetDropdown() {
  const presetSelect = document.getElementById('presetSelect');
  if (!presetSelect) return;

  const presets = await getPresets();

  // Group by category
  const grouped = {};
  presets.forEach((preset, index) => {
    const cat = preset.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({ preset, index });
  });

  const categoryOrder = Object.keys(grouped).sort((a, b) => {
    if (a === 'genre') return -1;
    if (b === 'genre') return 1;
    return a.localeCompare(b);
  });

  let html = '<option value="">Select a preset...</option>';
  for (const category of categoryOrder) {
    const label = category.charAt(0).toUpperCase() + category.slice(1);
    html += `<optgroup label="${escapeHtml(label)}">`;
    for (const { preset, index } of grouped[category]) {
      html += `<option value="${index}">${escapeHtml(preset.name)}</option>`;
    }
    html += '</optgroup>';
  }

  presetSelect.innerHTML = html;
}

function displayPresetStreams(preset) {
  const mixList = document.getElementById('mixList');
  if (!mixList) return;

  window._currentBrowsedPreset = preset;

  if (!preset || !preset.streams || preset.streams.length === 0) {
    mixList.innerHTML = '<div style="padding: 20px; color: #888;">No streams in this preset</div>';
    return;
  }

  // Show/hide the "Add All" button based on stream count
  const presetAddAllBtn = document.getElementById('presetAddAllBtn');
  if (presetAddAllBtn) {
    presetAddAllBtn.style.display = preset.streams.length > 1 ? '' : 'none';
  }

  mixList.innerHTML = preset.streams.map((stream, i) => {
    const genre = stream.genre ? `<span class="stream-genre">${escapeHtml(stream.genre)}</span>` : '';
    return `<div class="mix-item" data-preset-stream-index="${i}">
      <div class="mix-item-row">
        <div class="stream-info">
          <span class="mix-name">${escapeHtml(stream.name || stream.m3u)}</span>
          ${genre}
        </div>
        <button class="icon-btn" data-action="preset-add-stream" title="Add to user streams">+</button>
        <button class="icon-btn" data-action="preset-play-now" title="Play now">▶</button>
      </div>
    </div>`;
  }).join('');
}

async function playPresetStream(index) {
  const preset = window._currentBrowsedPreset;
  if (!preset || !preset.streams[index]) return;

  const stream = preset.streams[index];
  const name = stream.name || stream.m3u;

  showToast('Connecting to stream...');

  // Resolve stream URL (probe without persisting to user streams)
  const audioExtensions = ['.mp3', '.aac', '.flac', '.wav', '.ogg', '.opus', '.m4a'];
  const isDirectAudio = audioExtensions.some(ext => stream.m3u.toLowerCase().endsWith(ext));

  let entries;
  if (isDirectAudio) {
    entries = [{ url: stream.m3u, title: null }];
  } else {
    entries = await fetchPlaylist(stream.m3u);
    if (entries.length === 0) {
      entries = [{ url: stream.m3u, title: null }];
    }
  }

  let resolvedUrl = null;
  for (const entry of entries) {
    // Route to appropriate proxy, with fallback to proxyAll
    const proxyUrls = getProxyUrls(entry.url);
    for (const proxyUrl of proxyUrls) {
      if (await probeStream(proxyUrl)) {
        resolvedUrl = proxyUrl;
        break;
      }
    }
    if (resolvedUrl) break;
  }

  if (!resolvedUrl) {
    showToast('Stream unavailable');
    return;
  }

  state.isLive = true;
  state.liveStreamUrl = resolvedUrl;
  state.liveStreamM3u = stream.m3u;
  state.liveDisplayText = name;
  storage.set('liveStreamUrl', resolvedUrl);
  storage.set('liveStreamM3u', stream.m3u);
  storage.set('liveDisplayText', name);

  playLive(resolvedUrl, name, true);
}

async function addPresetStreamToUserStreams(index) {
  const preset = window._currentBrowsedPreset;
  if (!preset || !preset.streams[index]) return;

  const stream = preset.streams[index];
  const currentStreams = getUserStreams();
  if (currentStreams.some(s => s.m3u === stream.m3u)) {
    showToast('Stream already in user streams');
    return;
  }

  await addUserStream(stream.name || null, stream.m3u, stream.genre || null);
  switchMiddleTab('userStreams');
  showToast(`Added ${stream.name || 'stream'}`);
}

// Wrapper for button click handler
function addAllPresetStreams() {
  addAllPresetStreamsToUserStreams();
}

async function addAllPresetStreamsToUserStreams() {
  const preset = window._currentBrowsedPreset;
  if (!preset) return;

  await addStreamsFromPreset(preset);
  switchMiddleTab('userStreams');
}

// ========== EVENT HANDLERS FOR DELEGATED ACTIONS ==========

// Delegated event handler for user stream list
const streamListElement = getStreamListTarget();
if (streamListElement) {
     streamListElement.addEventListener('click', (e) => {
       const actionBtn = e.target.closest('[data-action]');
       if (!actionBtn) return;
       
       const action = actionBtn.dataset.action;
       switch (action) {
          case 'toggle-stream-info':
             toggleStreamInfo(actionBtn);
             break;
       }
    });
    
    // Handle stream name and genre editing
    streamListElement.addEventListener('input', (e) => {
      const nameInput = e.target.closest('.stream-edit-name');
      const genreInput = e.target.closest('.stream-edit-genre');
      
      if (nameInput) {
        const index = parseInt(nameInput.dataset.index);
        const newName = nameInput.value.trim();
        if (index >= 0 && index < liveStreams.length) {
          const m3u = liveStreams[index].m3u;
          liveStreams[index].name = newName;
          // Update display
          const streamRow = nameInput.closest('.mix-item');
          const nameSpan = streamRow?.querySelector('.mix-name');
          if (nameSpan) nameSpan.textContent = newName || m3u;
          // Save to storage using m3u as key to avoid index mismatches
          const configs = getUserStreams();
          const storageIndex = configs.findIndex(c => c.m3u === m3u);
          if (storageIndex >= 0) {
            configs[storageIndex].name = newName;
            saveUserStreams(configs);
          }
        }
      }
      
      if (genreInput) {
        const index = parseInt(genreInput.dataset.index);
        const newGenre = genreInput.value.trim();
        if (index >= 0 && index < liveStreams.length) {
          const m3u = liveStreams[index].m3u;
          liveStreams[index].genre = newGenre;
          // Update display
          const streamRow = genreInput.closest('.mix-item');
          const streamInfo = streamRow?.querySelector('.stream-info');
          if (streamInfo) {
            let genreSpan = streamInfo.querySelector('.stream-genre');
            if (newGenre && newGenre !== 'Unknown') {
              if (!genreSpan) {
                genreSpan = document.createElement('span');
                genreSpan.className = 'stream-genre';
                streamInfo.appendChild(genreSpan);
              }
              genreSpan.textContent = newGenre;
            } else if (genreSpan) {
              genreSpan.remove();
            }
          }
          // Save to storage using m3u as key to avoid index mismatches
          const configs = getUserStreams();
          const storageIndex = configs.findIndex(c => c.m3u === m3u);
          if (storageIndex >= 0) {
            configs[storageIndex].genre = newGenre;
            saveUserStreams(configs);
          }
        }
      }
    });
    
    // Disable dragging when pointer is in text input fields
    streamListElement.addEventListener('pointerdown', (e) => {
      const inputInPopout = e.target.closest('.stream-extra-info input, .stream-extra-info textarea');
      if (inputInPopout) {
        const row = e.target.closest('.mix-item');
        if (row && row.draggable) {
          row.dataset.wasDraggable = '1';
          row.draggable = false;
        }
      }
    }, true);
    
    streamListElement.addEventListener('pointerup', () => {
      // Re-enable dragging
      const rows = document.querySelectorAll('.mix-item[data-was-draggable="1"]');
      rows.forEach(row => {
        row.draggable = true;
        delete row.dataset.wasDraggable;
      });
    }, true);
}

// Callback for when streams are added during initialization (from livedata.js)
// Check guard callback before redisplaying (checks current browser mode at invocation time)
window.onStreamAdded = () => {
  if (shouldRedisplayStreams()) {
    displayLiveStreams();
  }
};

// Callback for when live data is cleared (from livedata.js)
window.onLiveDataCleared = () => {
  displayLiveStreams();
};
