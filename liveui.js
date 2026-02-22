// liveui.js - Live stream UI rendering and interactions
// Dependencies: core.js (state, storage, escapeHtml, showToast)
//               player.js (playLive, stopLive, updatePlayPauseBtn)
//               livedata.js (stream management, probing, parsing)
//               modals.js (showPlaylistGuide, hidePlaylistGuide, showPresetsMenu, hidePresetsMenu)

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
  const mixList = document.getElementById('mixList');
  
  if (!liveStreamsInitialized) {
    mixList.innerHTML = '<div style="padding: 20px; color: #888;">Checking stream availability...</div>';
    initLiveStreams().then(() => displayLiveStreams());
    return;
  }
  
  let html = '';
  
  // Add stream form
  html += `
    <div class="add-stream-form">
      <div class="add-stream-fields">
        <input type="text" id="newStreamM3U" placeholder="Playlist URL (M3U or PLS)" />
        <button class="add-stream-btn" onclick="handleAddStream()">Add</button>
        <button onclick="reloadLiveStreams()" class="reload-btn" title="Reload all streams">⟳</button>
        <div class="stream-menu-container" style="position: relative;">
          <button class="stream-menu-btn" onclick="toggleStreamCollectionsMenu()" title="Save/Load streams">☰</button>
          <div id="streamCollectionsMenu" class="stream-collections-menu" style="display: none; position: absolute; top: 100%; left: 0; background: #252542; border: 1px solid #3d3d5c; border-radius: 6px; padding: 8px; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.4); flex-direction: column; gap: 4px;">
            <button onclick="hideStreamCollectionsMenu(); loadCollectionFromFile()" style="padding: 8px 12px; background: #3d3d5c; border: none; border-radius: 4px; color: #e0e0e0; cursor: pointer; text-align: left;">📂 Load from File</button>
            <button onclick="hideStreamCollectionsMenu(); saveCollectionToFile()" style="padding: 8px 12px; background: #3d3d5c; border: none; border-radius: 4px; color: #e0e0e0; cursor: pointer; text-align: left;">💾 Save to File</button>
            <button onclick="hideStreamCollectionsMenu(); clearAllStreams()" style="padding: 8px 12px; background: #c0475c; border: none; border-radius: 4px; color: #fff; cursor: pointer; text-align: left;">🗑️ Clear All</button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  if (liveStreams.length === 0) {
    html += '<div style="padding: 20px; color: #888;">No live streams configured</div>';
    mixList.innerHTML = html;
    return;
  }
  
  // Stream list
  liveStreams.forEach((stream, index) => {
    const unavailableClass = stream.available ? '' : ' unavailable';
    const tooltip = stream.available ? 'Play Now' : (stream.reason || 'Unavailable');
    const disabled = stream.available ? '' : ' disabled';
    const deleteBtn = `<button class="icon-btn delete-stream-btn" onclick="handleRemoveStream(${index})" title="Remove stream" style="color: #c0475c;">✕</button>`;
    const infoBtn = `<button class="icon-btn info-btn" data-action="toggle-stream-info" title="More info">ⓘ</button>`;
    const infoPopout = `<div class="stream-extra-info" style="display:none">
      <div class="stream-info-field">
        <strong>Stream URL:</strong>
        <a href="${escapeHtml(stream.url || stream.m3u)}" target="_blank" rel="noopener">${escapeHtml(stream.url || stream.m3u)}</a>
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
          <button class="icon-btn" onclick="playLiveStream(${index})"${disabled} title="${escapeHtml(tooltip)}">▶</button>
          <div class="stream-info">
            <span class="mix-name">${escapeHtml(stream.name)}</span>
            ${stream.genre && stream.genre !== 'Unknown' ? `<span class="stream-genre">${escapeHtml(stream.genre)}</span>` : ''}
          </div>
          ${infoBtn}${deleteBtn}
        </div>
        ${infoPopout}
      </div>
    `;
  });
  
  mixList.innerHTML = html;
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
    alert(`Stream not available: ${stream.reason || 'Unknown reason'}`);
    return;
  }
  
  const name = stream.name || stream.m3u;
  const url = stream.url;
  
  state.isLive = true;
  state.liveStreamUrl = url;
  state.liveDisplayText = name;
  storage.set('liveStreamUrl', url);
  storage.set('liveDisplayText', name);
  
  playLive(url, name, true);
}

// ========== STREAM MANAGEMENT HANDLERS ==========

async function handleAddStream() {
    const m3u = document.getElementById('newStreamM3U').value.trim();

    if (!m3u) {
      alert('Playlist URL is required');
      return;
    }

    if (!m3u.startsWith('http://') && !m3u.startsWith('https://')) {
      alert('Playlist URL must start with http:// or https://');
      return;
    }

    // Add stream with no name, let playlist title be parsed from m3u
    await addUserStream(null, m3u, null);
    document.getElementById('newStreamM3U').value = '';
    displayLiveStreams();
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
      displayLiveStreams();
    }
}

async function reloadLiveStreams() {
   liveStreamsInitialized = false;
   liveStreams = [];
   displayLiveStreams();
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
  displayLiveStreams();
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
  menu.style.display = isHidden ? 'flex' : 'none';
  
  // Position menu to not go off-screen
  if (isHidden) {
    const btn = document.querySelector('.stream-menu-btn');
    if (btn) {
      const btnRect = btn.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      
      // If menu would go off-screen right, position it to the left
      if (btnRect.left + menuRect.width > viewportWidth) {
        menu.style.left = 'auto';
        menu.style.right = '0';
      } else {
        menu.style.left = '0';
        menu.style.right = 'auto';
      }
    }
  }
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
   const btn = document.querySelector('.stream-menu-btn');
   if (menu && btn && !btn.contains(e.target) && !menu.contains(e.target)) {
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
        displayLiveStreams();
    }
    
    showToast(`Added ${added} stream${added !== 1 ? 's' : ''}${skipped > 0 ? `, skipped ${skipped} duplicate${skipped !== 1 ? 's' : ''}` : ''}`);
}

// ========== EVENT HANDLERS FOR DELEGATED ACTIONS ==========

// Delegated event handler for stream list buttons (live.html only)
const streamListElement = document.getElementById('mixList');
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
window.onStreamAdded = () => {
  displayLiveStreams();
};

// Callback for when live data is cleared (from livedata.js)
window.onLiveDataCleared = () => {
  displayLiveStreams();
};
