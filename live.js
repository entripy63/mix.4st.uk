// live.js - Live Stream Management (extracted from browser.js)
// Dependencies: core.js (state, storage, escapeHtml, showToast)
//               player.js (playLive)

// Live streams configuration
// We can't always use the proxy because it hates jungletrain.net
const STREAM_PROXY = 'https://stream-proxy.round-bar-e93e.workers.dev';

const BUILTIN_STREAM_DEFS = [
  { name: 'Sleepbot Environmental Broadcast', m3u: 'http://sleepbot.com/ambience/cgi/listen.m3u', genre: 'Ambient' },
  { name: 'Jungletrain.net', m3u: 'https://jungletrain.net/static/256kbps.m3u', genre: 'Jungle/Drum & Bass' }
];

function getUserStreams() {
  return storage.getJSON('userStreams', []);
}

function saveUserStreams(streams) {
  storage.set('userStreams', streams);
}

async function addUserStream(name, m3u, genre) {
   const streams = getUserStreams();
   const config = { name: name || null, m3u, genre };
   streams.push(config);
   saveUserStreams(streams);
   
   if (liveStreamsInitialized) {
      await probeAndAddStream(config);
   }
}

async function probeAndAddStream(config) {
    const stream = {
      m3u: config.m3u,
      name: config.name,
      genre: config.genre,
      url: null,
      available: false,
      reason: null
    };
    
    const entries = await fetchPlaylist(config.m3u);
    for (const entry of entries) {
      let url = entry.url;
      // Shoutcast servers use port 8000; append ';' variant for them
      if (url.includes(':8000/')) {
        if (!url.endsWith('/')) {
          url += '/';
        }
        url += ';';
      }
      
      if (await probeStream(url)) {
        stream.url = url;
        stream.playlistTitle = entry.title;
        stream.available = true;
        break;
      }
      if (url.startsWith('http://') && location.protocol === 'https:') {
        const proxyUrl = `${STREAM_PROXY}?url=${encodeURIComponent(url)}`;
        if (await probeStream(proxyUrl)) {
          stream.url = proxyUrl;
          stream.playlistTitle = entry.title;
          stream.available = true;
          break;
        }
      }
    }
    if (!stream.available) {
      stream.reason = `No working stream found (playlist: ${config.m3u})`;
    }
    if (!stream.name && stream.playlistTitle) {
      const parsed = parseSomaFMStream(stream.playlistTitle, stream.genre);
      stream.name = parsed.name;
      if (!stream.genre) {
        stream.genre = parsed.genre;
      }
    }
    
    if (!stream.name) {
       stream.name = config.m3u || 'Unknown Stream';
    }
    
    // Update the saved config with resolved name/genre if they were null
    if (!config.name && stream.name) {
       config.name = stream.name;
       const configs = getUserStreams();
       const idx = configs.findIndex(c => c.m3u === config.m3u);
       if (idx >= 0) {
           configs[idx] = config;
           saveUserStreams(configs);
       }
    }
    if (!config.genre && stream.genre) {
       config.genre = stream.genre;
       const configs = getUserStreams();
       const idx = configs.findIndex(c => c.m3u === config.m3u);
       if (idx >= 0) {
           configs[idx] = config;
           saveUserStreams(configs);
       }
    }
    
    liveStreams.push(stream);
    }

function removeUserStream(index) {
   const streams = getUserStreams();
   streams.splice(index, 1);
   saveUserStreams(streams);
   
   if (liveStreamsInitialized && index < liveStreams.length) {
     liveStreams.splice(index, 1);
   }
}

function initializeBuiltinStreams() {
   const initialized = storage.getBool('builtinStreamsInitialized', false);
   if (!initialized) {
     for (const stream of BUILTIN_STREAM_DEFS) {
       addUserStream(stream.name, stream.m3u, stream.genre);
     }
     storage.set('builtinStreamsInitialized', true);
   }
}

function getLiveStreamConfig() {
  return getUserStreams();
}

let liveStreams = [];
let liveStreamsInitialized = false;

function probeStream(url, timeoutMs = 5000) {
  return new Promise(resolve => {
    const audio = new Audio();
    const timer = setTimeout(() => {
      audio.src = '';
      resolve(false);
    }, timeoutMs);
    
    audio.addEventListener('canplay', () => {
      clearTimeout(timer);
      audio.src = '';
      resolve(true);
    }, { once: true });
    
    audio.addEventListener('error', () => {
      clearTimeout(timer);
      resolve(false);
    }, { once: true });
    
    audio.src = url;
    audio.load();
  });
}

function parsePLS(text) {
  const entries = [];
  const lines = text.split('\n');
  const files = {};
  const titles = {};
  
  for (const line of lines) {
    const fileMatch = line.match(/^File(\d+)=(.+)$/i);
    if (fileMatch) {
      files[fileMatch[1]] = fileMatch[2].trim();
    }
    const titleMatch = line.match(/^Title(\d+)=(.+)$/i);
    if (titleMatch) {
      titles[titleMatch[1]] = titleMatch[2].trim();
    }
  }
  
  for (const num of Object.keys(files).sort((a, b) => a - b)) {
    entries.push({ url: files[num], title: titles[num] || null });
  }
  return entries;
}

function parseM3U(text) {
  const entries = [];
  const lines = text.split('\n').map(line => line.trim());
  let pendingTitle = null;
  
  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      const commaIndex = line.indexOf(',');
      if (commaIndex !== -1) {
        pendingTitle = line.substring(commaIndex + 1).trim();
      }
    } else if (line && !line.startsWith('#')) {
      entries.push({ url: line, title: pendingTitle });
      pendingTitle = null;
    }
  }
  return entries;
}

async function fetchPlaylist(playlistUrl) {
  try {
    // Use proxy to avoid CORS errors on M3U and PLS playlists
    const url = `${STREAM_PROXY}?url=${encodeURIComponent(playlistUrl)}`;
    const resp = await fetch(url);
    const text = await resp.text();
    if (text.trim().toLowerCase().startsWith('[playlist]')) {
      return parsePLS(text);
    }
    return parseM3U(text);
  } catch {
    return [];
  }
}

async function initLiveStreams() {
    if (liveStreamsInitialized) return;
    
    liveStreamsInitialized = true;
    liveStreams = [];
    for (const config of getLiveStreamConfig()) {
      await probeAndAddStream(config);
      displayLiveStreams();
    }
}

function displayLiveStreams() {
    const mixList = document.getElementById('mixList');
    if (!mixList) return; // Not loaded in this context
    
    if (!liveStreamsInitialized) {
      mixList.innerHTML = '<div style="padding: 20px; color: #888;">Checking stream availability...</div>';
      initLiveStreams().then(() => displayLiveStreams());
      return;
    }
   
   let html = '';
   
   html += `
     <div class="add-stream-form">
       <div class="add-stream-fields">
          <input type="text" id="newStreamM3U" placeholder="Playlist URL (M3U or PLS)" />
          <button class="add-stream-btn" onclick="handleAddStream()">Add</button>
          <button onclick="reloadLiveStreams()" class="reload-btn" title="Reload all streams">⟳</button>
          <div class="stream-menu-container">
            <button class="stream-menu-btn" onclick="toggleStreamCollectionsMenu()" title="Save/Load streams">☰</button>
            <div id="streamCollectionsMenu" class="stream-collections-menu" style="display: none;">
              <button onclick="loadCollectionFromFile()">📂 Load from File</button>
              <button onclick="saveCollectionToFile()">💾 Save to File</button>
              <button onclick="clearAllStreams()" style="color: #ff6b6b;">🗑️ Clear All</button>
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
   
   let userStreamIndex = 0;
   
   liveStreams.forEach((stream, index) => {
     const unavailableClass = stream.available ? '' : ' unavailable';
     const tooltip = stream.available ? 'Play Now' : (stream.reason || 'Unavailable');
     const disabled = stream.available ? '' : ' disabled';
     const deleteBtn = `<button class="icon-btn delete-stream-btn" onclick="handleRemoveStream(${userStreamIndex})" title="Remove stream">✕</button>`;
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
     userStreamIndex++;
     
     html += `
       <div class="mix-item${unavailableClass}" 
            draggable="true"
            ondragstart="onLiveStreamDragStart(event, ${index})" 
            ondragover="onLiveStreamDragOver(event)" 
            ondrop="onLiveStreamDrop(event, ${index})"
            ondragend="onLiveStreamDragEnd()">
        <button class="icon-btn" onclick="playLiveStream(${index})"${disabled} title="${escapeHtml(tooltip)}">▶</button>
         <div class="stream-info">
           <span class="mix-name">${escapeHtml(stream.name)}</span>
           ${stream.genre && stream.genre !== 'Unknown' ? `<span class="stream-genre">${escapeHtml(stream.genre)}</span>` : ''}
         </div>
         ${infoBtn}${deleteBtn}
         ${infoPopout}
       </div>
     `;
   });
   
   mixList.innerHTML = html;
}

// Parse SomaFM stream names to extract shorter name and genre
function parseSomaFMStream(name, genre) {
   if (!name || !name.startsWith('SomaFM:')) {
      return { name, genre };
   }
   
   // Find the second colon in the name
   const firstColonIdx = name.indexOf(':');
   const secondColonIdx = name.indexOf(':', firstColonIdx + 1);
   
   if (secondColonIdx === -1) {
      // No second colon, return as-is
      return { name, genre };
   }
   
   // Extract name up to second colon, and genre from after it
   const parsedName = name.substring(0, secondColonIdx).trim();
   const parsedGenre = name.substring(secondColonIdx + 1).trim();
   
   // Use parsed genre if provided genre is empty or 'Unknown'
   const finalGenre = (!genre || genre === 'Unknown') ? parsedGenre : genre;
   
   return { name: parsedName, genre: finalGenre };
}

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

function handleRemoveStream(userIndex) {
   if (confirm('Remove this stream?')) {
     removeUserStream(userIndex);
     displayLiveStreams();
   }
}

async function reloadLiveStreams() {
   liveStreamsInitialized = false;
   liveStreams = [];
   displayLiveStreams();
}

function playLiveStream(index) {
  const stream = liveStreams[index];
  if (stream && stream.available) {
    storage.set('wasPlaying', true);
    playLive(stream.url, `Live from ${stream.name}`, true);
  }
}

// Live stream drag-and-drop handlers
function onLiveStreamDragStart(e, index) {
   state.draggedStreamIndex = index;
   e.currentTarget.classList.add('dragging');
}

function onLiveStreamDragOver(e) {
  e.preventDefault();
}

function onLiveStreamDrop(e, dropIndex) {
  e.preventDefault();
  if (state.draggedStreamIndex === null || state.draggedStreamIndex === dropIndex) return;
  
  const draggedStream = liveStreams.splice(state.draggedStreamIndex, 1)[0];
  liveStreams.splice(dropIndex, 0, draggedStream);
  
  saveLiveStreamOrder();
  displayLiveStreams();
}

function onLiveStreamDragEnd() {
  state.draggedStreamIndex = null;
  document.querySelectorAll('.mix-item').forEach(el => el.classList.remove('dragging'));
}

function saveLiveStreamOrder() {
  // Save the full reordered stream list (each stream has m3u stored on it)
  const configMap = new Map(getLiveStreamConfig().map(cfg => [cfg.m3u, cfg]));
  
  const orderedStreams = liveStreams.map(stream => {
    // Look up original config by m3u (unique identifier)
    if (configMap.has(stream.m3u)) {
      return configMap.get(stream.m3u);
    }
    // Fallback (shouldn't happen - all streams should have m3u)
    return { name: stream.name, m3u: stream.m3u, genre: stream.genre };
  }).filter(cfg => cfg.m3u); // Only save configs with valid m3u URLs
  
  saveUserStreams(orderedStreams);
}

// Toggle stream info popup (for live.html)
function toggleStreamInfo(btn) {
   const info = btn.closest('.mix-item').querySelector('.stream-extra-info');
   if (info) {
      info.style.display = info.style.display === 'none' ? 'table' : 'none';
   }
}

// Stream edit event handlers - update display on input
document.addEventListener('DOMContentLoaded', function() {
   const mixList = document.getElementById('mixList');
   if (!mixList) return;
   
   mixList.addEventListener('input', (e) => {
      if (e.target.classList.contains('stream-edit-name')) {
         const index = parseInt(e.target.dataset.index);
         const stream = liveStreams[index];
         if (stream) {
            stream.name = e.target.value;
            const mixName = e.target.closest('.mix-item').querySelector('.mix-name');
            if (mixName) mixName.textContent = e.target.value;
         }
      } else if (e.target.classList.contains('stream-edit-genre')) {
         const index = parseInt(e.target.dataset.index);
         const stream = liveStreams[index];
         if (stream) {
            stream.genre = e.target.value;
            // Update or create genre display in row
            const streamInfo = e.target.closest('.mix-item').querySelector('.stream-info');
            let genreSpan = streamInfo?.querySelector('.stream-genre');
            if (e.target.value) {
               if (!genreSpan) {
                  genreSpan = document.createElement('span');
                  genreSpan.className = 'stream-genre';
                  streamInfo?.appendChild(genreSpan);
               }
               genreSpan.textContent = e.target.value;
           } else if (genreSpan) {
              genreSpan.remove();
           }
        }
     }
  });

  // Track pointer origin and temporarily disable dragging when in popout inputs
  mixList.addEventListener('pointerdown', (e) => {
     const inputInPopout = e.target.closest('.stream-extra-info input, .stream-extra-info textarea');
     if (inputInPopout) {
        const row = e.target.closest('.mix-item');
        if (row && row.draggable) {
           row.dataset.wasDraggable = '1';
           row.draggable = false;
        }
     }
  }, true);

  mixList.addEventListener('pointerup', () => {
     const rows = document.querySelectorAll('.mix-item[data-was-draggable="1"]');
     rows.forEach(row => {
        row.draggable = true;
        delete row.dataset.wasDraggable;
     });
  }, true);

  // Save to storage on blur
  mixList.addEventListener('blur', (e) => {
     if (e.target.classList.contains('stream-edit-name') || e.target.classList.contains('stream-edit-genre')) {
        const index = parseInt(e.target.dataset.index);
        const field = e.target.classList.contains('stream-edit-name') ? 'name' : 'genre';
        const stream = liveStreams[index];
        if (stream) {
           // Get current config, modify it, then save the modified array
           const configs = getLiveStreamConfig();
           const config = configs.find(cfg => cfg.m3u === stream.m3u);
           if (config) {
              config[field] = e.target.value;
              saveUserStreams(configs);
           }
        }
     }
  }, true);
});

// Stream collections management
function toggleStreamCollectionsMenu() {
  const menu = document.getElementById('streamCollectionsMenu');
  if (menu) {
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  }
}

function hideStreamCollectionsMenu() {
  const menu = document.getElementById('streamCollectionsMenu');
  if (menu) {
    menu.style.display = 'none';
  }
}

function saveCollectionToFile() {
  const name = prompt('Save collection as:', 'My Streams');
  if (!name) return;
  
  const collection = {
    name: name,
    version: 1,
    savedAt: new Date().toISOString(),
    streams: getUserStreams()
  };
  
  const blob = new Blob([JSON.stringify(collection, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9-]/gi, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  hideStreamCollectionsMenu();
  showToast('Collection saved');
}

function loadCollectionFromFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  
  input.onchange = async (e) => {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      
      const text = await file.text();
      const data = JSON.parse(text);
      
      if (!Array.isArray(data.streams)) {
        throw new Error('Invalid collection file: missing "streams" array');
      }
      
      // Replace current streams
      saveUserStreams(data.streams);
      
      // Re-initialize live streams
      liveStreamsInitialized = false;
      liveStreams = [];
      await initLiveStreams();
      displayLiveStreams();
      
      hideStreamCollectionsMenu();
      showToast(`Loaded ${data.name || 'collection'}`);
    } catch (err) {
      console.error('Failed to load collection:', err);
      alert(`Error loading collection: ${err.message}`);
    }
  };
  
  input.click();
}

function clearAllStreams() {
  if (!confirm('Clear all streams? This cannot be undone.')) return;
  
  saveUserStreams([]);
  liveStreamsInitialized = false;
  liveStreams = [];
  displayLiveStreams();
  
  hideStreamCollectionsMenu();
  showToast('All streams cleared');
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
   const menu = document.getElementById('streamCollectionsMenu');
   const btn = document.querySelector('.stream-menu-btn');
   if (menu && btn && !btn.contains(e.target) && !menu.contains(e.target)) {
     hideStreamCollectionsMenu();
   }
});

// Close presets modal on Escape
document.addEventListener('keydown', (e) => {
   if (e.key === 'Escape') {
      const presetsModal = document.getElementById('presetsModal');
      if (presetsModal && presetsModal.style.display === 'flex') {
         hidePresetsMenu();
      }
   }
});

// Show playlist guide / help
function showPlaylistGuide() {
    document.getElementById('playlistGuideModal').style.display = 'flex';
}

function hidePlaylistGuide() {
    document.getElementById('playlistGuideModal').style.display = 'none';
}

// Load available presets from /presets/manifest.json
async function loadAvailablePresets() {
    try {
        // Load manifest
        const manifestResponse = await fetch('/presets/manifest.json');
        const manifest = await manifestResponse.json();
        
        if (!Array.isArray(manifest.presets)) {
            console.error('Invalid manifest: missing "presets" array');
            return [];
        }
        
        // Load each preset file
        const presets = [];
        for (const item of manifest.presets) {
            try {
                const presetResponse = await fetch(`/presets/${item.filename}`);
                const preset = await presetResponse.json();
                if (preset.name && Array.isArray(preset.streams)) {
                    presets.push({
                        filename: item.filename,
                        name: preset.name,
                        streams: preset.streams
                    });
                }
            } catch (e) {
                console.error(`Failed to load preset ${item.filename}:`, e);
            }
        }
        
        return presets;
    } catch (e) {
        console.error('Failed to load presets:', e);
        return [];
    }
}

// Show presets menu modal
async function showPresetsMenu() {
    const presets = await loadAvailablePresets();
    
    if (presets.length === 0) {
        alert('No presets available. Upload preset files to /presets/ directory on the server.');
        return;
    }
    
    // Populate preset list with clickable buttons
    const presetsList = document.getElementById('presetsList');
    presetsList.innerHTML = presets.map((preset, index) => `
        <button onclick="selectPreset(${index})" style="padding: 12px 16px; background: #3d3d5c; border: none; border-radius: 6px; color: #e0e0e0; cursor: pointer; text-align: left; transition: background 0.2s;" onmouseover="this.style.background='#5c6bc0'" onmouseout="this.style.background='#3d3d5c'">${escapeHtml(preset.name)}</button>
    `).join('');
    
    // Store presets for selection handler
    window._currentPresets = presets;
    
    // Show modal
    const modal = document.getElementById('presetsModal');
    modal.style.display = 'flex';
}

function hidePresetsMenu() {
    const modal = document.getElementById('presetsModal');
    modal.style.display = 'none';
}

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

// Live stream restoration for both SPAs
async function restoreLivePlayer() {
  try {
    const savedLiveUrl = storage.get('liveStreamUrl');
    const savedLiveText = storage.get('liveDisplayText');
    
    if (savedLiveUrl && savedLiveText) {
      state.isRestoring = true;
      const wasPlaying = storage.getBool('wasPlaying', false);
      playLive(savedLiveUrl, savedLiveText, wasPlaying);
      // Keep isRestoring true until after playLive's async setup (canplay listener, timeouts, etc.)
      setTimeout(() => {
        state.isRestoring = false;
      }, 200);
      await initLiveStreams();
      return true; // Restored live stream
    }
  } catch (e) {
    console.error('Error restoring live stream:', e);
  }
  return false; // Did not restore
}

// Initialize builtin streams on first load
initializeBuiltinStreams();

// Initialize live streams in background
initLiveStreams().catch(e => console.error('Failed to initialize live streams:', e));
