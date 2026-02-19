// liveui.js - Live stream UI rendering and interactions
// Dependencies: core.js (state, storage, escapeHtml, showToast)
//               player.js (playLive, stopLive, updatePlayPauseBtn)
//               livedata.js (stream management, probing, parsing)
//               modals.js (showPlaylistGuide, hidePlaylistGuide, showPresetsMenu, hidePresetsMenu)

// ========== LIVE STREAM DISPLAY ==========

function displayLiveStreams() {
  const config = getLiveStreamConfig();
  const mixList = document.getElementById('mixList');
  
  if (!config || config.length === 0) {
    mixList.innerHTML = '<div style="color: #888; padding: 20px;">No live streams added yet. Click "Add Playlists..." to get started.</div>';
    return;
  }
  
  const streamListHtml = liveStreams.map((stream, index) => {
    const statusClass = stream.available ? 'available' : 'unavailable';
    const statusText = stream.available ? '🟢 Available' : '🔴 Unavailable';
    const statusTitle = stream.reason ? `${statusText}: ${stream.reason}` : statusText;
    
    const streamName = escapeHtml(stream.name || stream.m3u);
    const genreText = stream.genre ? ` · ${escapeHtml(stream.genre)}` : '';
    const urlText = stream.url ? ` · ${stream.playlistTitle || 'Stream'}` : '';
    
    const extraInfo = `<div class="stream-extra-info" style="display:none; padding: 12px; background: #1a1a2e; border-radius: 6px; margin-top: 8px; font-size: 12px;">
      <div style="margin-bottom: 8px;">
        <strong>M3U URL:</strong>
        <textarea style="width: 100%; height: 60px; padding: 4px; background: #0f0f1e; border: 1px solid #3d3d5c; border-radius: 3px; color: #e0e0e0; font-family: monospace; font-size: 11px;" readonly>${escapeHtml(stream.m3u)}</textarea>
      </div>
      <button style="padding: 6px 12px; background: #c0475c; border: none; border-radius: 4px; color: #fff; cursor: pointer; font-size: 12px;" onclick="if(confirm('Delete this stream?')) { removeUserStream(${index}); liveStreamsInitialized = false; initLiveStreams().then(() => displayLiveStreams()); }">Delete Stream</button>
    </div>`;
    
    return `<div class="mix-item" data-stream-m3u="${escapeHtml(stream.m3u)}" draggable="true">
      <button class="icon-btn" onclick="playLiveStream(${index})" title="Play stream">▶</button>
      <span class="mix-name">${streamName} <span class="mix-duration">${genreText}${urlText}</span></span>
      <span title="${statusTitle}" style="margin-left: auto;">${statusText}</span>
      <button class="icon-btn info-btn" data-action="toggle-stream-info" title="More info">ⓘ</button>
      ${extraInfo}
    </div>`;
  }).join('');
  
  mixList.innerHTML = streamListHtml;
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
  
  // Save which stream is now playing
  saveCollectionToFile = () => {
    // Override temporarily to save current stream info
  };
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
  
  // Reorder liveStreams array
  const temp = liveStreams[dragIndex];
  liveStreams.splice(dragIndex, 1);
  liveStreams.splice(dropIndex, 0, temp);
  
  // Reorder in storage
  saveLiveStreamOrder();
  
  // Refresh display
  displayLiveStreams();
}

function onLiveStreamDragEnd(e) {
  e.target.style.opacity = '1';
}

// Attach drag handlers to mix list
document.addEventListener('dragstart', (e) => {
  const mixItem = e.target.closest('.mix-item');
  if (mixItem && mixItem.dataset.streamM3u) {
    const index = Array.from(mixItem.parentNode.children).indexOf(mixItem);
    onLiveStreamDragStart(e, index);
  }
});

document.addEventListener('dragover', (e) => {
  const mixItem = e.target.closest('.mix-item');
  if (mixItem && mixItem.dataset.streamM3u) {
    onLiveStreamDragOver(e);
  }
});

document.addEventListener('drop', (e) => {
  const mixItem = e.target.closest('.mix-item');
  if (mixItem && mixItem.dataset.streamM3u) {
    const index = Array.from(mixItem.parentNode.children).indexOf(mixItem);
    onLiveStreamDrop(e, index);
  }
});

document.addEventListener('dragend', onLiveStreamDragEnd);

// ========== STREAM COLLECTIONS MENU ==========

function toggleStreamCollectionsMenu() {
  let menu = document.getElementById('streamCollectionsMenu');
  if (!menu) {
    // Create menu dynamically if it doesn't exist
    const newMenu = document.createElement('div');
    newMenu.id = 'streamCollectionsMenu';
    newMenu.style.cssText = 'position: fixed; background: #252542; border: 1px solid #3d3d5c; border-radius: 6px; padding: 8px; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.4);';
    newMenu.innerHTML = `
      <button onclick="saveCollectionToFile()" style="display: block; width: 100%; padding: 8px 12px; background: #3d3d5c; border: none; border-radius: 4px; color: #e0e0e0; cursor: pointer; text-align: left; margin-bottom: 4px;">Export Streams</button>
      <button onclick="loadCollectionFromFile()" style="display: block; width: 100%; padding: 8px 12px; background: #3d3d5c; border: none; border-radius: 4px; color: #e0e0e0; cursor: pointer; text-align: left; margin-bottom: 4px;">Import Streams</button>
      <button onclick="clearAllStreams()" style="display: block; width: 100%; padding: 8px 12px; background: #c0475c; border: none; border-radius: 4px; color: #fff; cursor: pointer; text-align: left;">Clear All</button>
    `;
    document.body.appendChild(newMenu);
    menu = document.getElementById('streamCollectionsMenu');
  }
  
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  
  if (menu.style.display !== 'none') {
    const btn = document.querySelector('.stream-menu-btn');
    if (btn) {
      const rect = btn.getBoundingClientRect();
      menu.style.top = (rect.bottom + 5) + 'px';
      menu.style.left = rect.left + 'px';
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
    }
    
    // Update display with newly added streams
    displayLiveStreams();
    
    showToast(`Added ${added} stream${added !== 1 ? 's' : ''}${skipped > 0 ? `, skipped ${skipped} duplicate${skipped !== 1 ? 's' : ''}` : ''}`);
}

// ========== EVENT HANDLERS FOR DELEGATED ACTIONS ==========

// Delegated event handler for stream list buttons (live.html only)
const mixList = document.getElementById('mixList');
if (mixList) {
    mixList.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-action]');
      if (!actionBtn) return;
      
      const action = actionBtn.dataset.action;
      switch (action) {
         case 'toggle-stream-info':
            toggleStreamInfo(actionBtn);
            break;
      }
   });
}

// Callback for when live data is cleared (from livedata.js)
window.onLiveDataCleared = () => {
  displayLiveStreams();
};
