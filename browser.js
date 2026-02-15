// browser.js - Browser, Search, Live Streams, and Page Restoration

// Browser UI functions
async function loadDJ(djPath) {
  state.currentDJ = djPath;
  state.currentMixes = await fetchDJMixes(djPath);
  updateDJButtons();
  displayGroupFilters(state.currentMixes);
  displayMixList(state.currentMixes);
}

function updateDJButtons() {
  document.querySelectorAll('#djButtons button').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.replace('-', '').toLowerCase() === state.currentDJ);
  });
}

function displayGroupFilters(mixes) {
  state.currentFilter = '';
  const filterDiv = document.getElementById('groupFilters');
  state.currentGroups = detectGroups(mixes);
  if (state.currentGroups.length === 0) {
    filterDiv.innerHTML = '';
    return;
  }
  const otherMixes = filterMixes(mixes, 'Other', state.currentGroups);
  const otherButton = otherMixes.length > 0 ? ` <button onclick="applyFilter('Other')">Other</button>` : '';
  filterDiv.innerHTML = `<button class="active" onclick="applyFilter('')">All</button> ` +
    state.currentGroups.map(g => `<button onclick="applyFilter('${g}')">${g}</button>`).join(' ') +
    otherButton;
}

function updateFilterButtons() {
  document.querySelectorAll('#groupFilters button').forEach(btn => {
    btn.classList.toggle('active', btn.textContent === (state.currentFilter || 'All'));
  });
}

function applyFilter(group) {
  state.currentFilter = group;
  updateFilterButtons();
  const filtered = filterMixes(state.currentMixes, group, state.currentGroups);
  displayMixList(filtered);
}

function displayMixList(mixes) {
   // Filter out hidden mixes (unless showing hidden mixes)
   const visibleMixes = mixes.filter(mix => {
     const isHidden = mixFlags.isHidden(getMixId(mix));
     return !isHidden || state.showHiddenMixes;
   });
   state.displayedMixes = visibleMixes;
   const mixList = document.getElementById('mixList');
   const header = visibleMixes.length > 1 ? `<div class="mix-list-header"><button onclick="addAllToQueue()">Add All to Queue</button></div>` : '';
   mixList.innerHTML = header +
     visibleMixes.map((mix, i) => {
       const mixId = getMixId(mix);
       const isFav = mixFlags.isFavourite(mixId);
       const isHidden = mixFlags.isHidden(mixId);
       const favIcon = isFav ? '<span class="fav-icon" title="Favourite">❤️</span>' : '';
       const hiddenIcon = isHidden ? '<span class="hidden-icon" title="Hidden">🚫</span>' : '';
       const genre = mix.genre ? ` · ${escapeHtml(mix.genre)}` : '';
       const hasExtra = mix.date || mix.comment;
       const extraBtn = hasExtra ? `<button class="icon-btn info-btn" onclick="event.stopPropagation(); toggleMixInfo(this)" title="More info">ⓘ</button>` : '';
       const extraInfo = hasExtra ? `<div class="mix-extra-info" style="display:none">${mix.date ? `<div><strong>Date:</strong> ${escapeHtml(mix.date)}</div>` : ''}${mix.comment ? `<div><strong>Notes:</strong> ${escapeHtml(mix.comment)}</div>` : ''}</div>` : '';
       return `<div class="mix-item">
       <button class="icon-btn" onclick="addToQueue('${mixId}')" title="Add to queue">+</button>
       <button class="icon-btn" onclick="playNow('${mixId}')" title="Play now">▶</button>
       <span class="mix-name">${escapeHtml(mix.name)} <span class="mix-duration">(${mix.duration}${genre})</span></span>
       ${extraBtn}${favIcon}${hiddenIcon}${extraInfo}
     </div>`;
     }).join('');
}

function toggleMixInfo(btn) {
  const info = btn.parentElement.querySelector('.mix-extra-info');
  if (info) {
    info.style.display = info.style.display === 'none' ? 'block' : 'none';
  }
}

async function displayFavourites() {
  const mixList = document.getElementById('mixList');
  const favouriteIds = [...mixFlags._favourites];
  
  if (favouriteIds.length === 0) {
    mixList.innerHTML = '<div style="color: #888; padding: 20px;">No favourites yet. Play a mix and click the Fav button to add it here.</div>';
    return;
  }
  
  // Load search index to get mix metadata
  if (!searchIndex.data) {
    mixList.innerHTML = '<div style="color: #888; padding: 20px;">Loading...</div>';
    await searchIndex.load();
  }
  
  // Build mixes from favourited IDs using search index
  const mixes = [];
  for (const mixId of favouriteIds) {
    // mixId is like "trip/mix-name" or "haze/mix-name"
    const match = searchIndex.data.find(m => `${m.dj}/${m.file}` === mixId);
    if (match) {
      mixes.push({
        name: match.name,
        file: match.file,
        audioFile: match.audioFile,
        duration: match.duration,
        artist: match.artist,
        genre: match.genre,
        comment: match.comment,
        peaksFile: match.peaksFile,
        coverFile: match.coverFile,
        downloads: match.downloads,
        djPath: match.dj,
        djLabel: match.dj
      });
    }
  }
  
  if (mixes.length === 0) {
    mixList.innerHTML = '<div style="color: #888; padding: 20px;">No favourites found in search index.</div>';
    return;
  }
  
  // Use the DJ-badged display (same as search results)
  displayMixListWithDJ(mixes);
}

// Search index cache
const searchIndex = {
  data: null,
  loading: false,
  
  async load() {
    if (this.data) return this.data;
    if (this.loading) {
      // Wait for existing load to complete
      while (this.loading) await new Promise(r => setTimeout(r, 50));
      return this.data;
    }
    
    this.loading = true;
    try {
      const response = await fetch('search-index.json');
      this.data = await response.json();
    } catch (e) {
      console.error('Failed to load search index:', e);
      this.data = [];
    }
    this.loading = false;
    return this.data;
  },
  
  search(query) {
    if (!this.data || !query.trim()) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    
    return this.data.filter(mix => {
      const searchable = `${mix.name} ${mix.artist} ${mix.genre} ${mix.comment} ${mix.dj}`.toLowerCase();
      return terms.every(term => searchable.includes(term));
    });
  }
};

// Live streams configuration
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
   const config = { name: name || null, m3u, genre, userAdded: true };
   streams.push(config);
   saveUserStreams(streams);
   
   if (liveStreamsInitialized) {
     await probeAndAddStream(config);
   }
}

async function probeAndAddStream(config) {
   const stream = {
     name: config.name,
     genre: config.genre,
     url: null,
     available: false,
     reason: null,
     userAdded: config.userAdded || false
   };
   
   if (config.url) {
     stream.url = config.url;
     stream.available = await probeStream(config.url);
     if (!stream.available) {
       if (config.url.startsWith('http://') && location.protocol === 'https:') {
         stream.reason = `HTTP stream unavailable on HTTPS site: ${config.url}`;
       } else {
         stream.reason = `Stream unreachable: ${config.url}`;
       }
     }
   } else if (config.m3u) {
     const entries = await fetchPlaylist(config.m3u);
     for (const entry of entries) {
       const baseUrl = entry.url;
       const variants = [baseUrl];
       if (!baseUrl.endsWith('/;')) {
         const urlWithoutTrailingSlash = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
         variants.push(urlWithoutTrailingSlash + '/;');
       }
       
       for (const url of variants) {
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
       if (stream.available) break;
     }
     if (!stream.available && config.fallbackUrl) {
       if (await probeStream(config.fallbackUrl)) {
         stream.url = config.fallbackUrl;
         stream.available = true;
       }
     }
     if (!stream.available) {
       const testUrl = config.fallbackUrl || (entries.length > 0 ? entries[0].url : null);
       if (testUrl && testUrl.startsWith('http://') && location.protocol === 'https:') {
         stream.reason = `HTTP stream unavailable on HTTPS site: ${testUrl}`;
         stream.url = config.fallbackUrl || entries[0].url;
       } else {
         stream.reason = `No working stream found (playlist: ${config.m3u})`;
       }
     }
     if (!stream.name && stream.playlistTitle) {
       stream.name = stream.playlistTitle;
     }
   }
   
   if (!stream.name) {
     stream.name = config.m3u || config.url || 'Unknown Stream';
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
  
  liveStreams = [];
  for (const config of getLiveStreamConfig()) {
    await probeAndAddStream(config);
  }
  liveStreamsInitialized = true;
}

function displayLiveStreams() {
  const mixList = document.getElementById('mixList');
  
  if (!liveStreamsInitialized) {
    mixList.innerHTML = '<div style="padding: 20px; color: #888;">Checking stream availability...</div>';
    initLiveStreams().then(() => displayLiveStreams());
    return;
  }
  
  let html = '';
  
  html += `
    <div class="add-stream-form">
      <div class="add-stream-header" onclick="toggleAddStreamForm()">
        <span>+ Add Stream</span>
      </div>
      <div class="add-stream-fields" id="addStreamFields" style="display: none;">
         <input type="text" id="newStreamM3U" placeholder="Playlist URL (M3U or PLS)" />
         <input type="text" id="newStreamName" placeholder="Stream name (optional)" />
         <input type="text" id="newStreamGenre" placeholder="Genre (optional)" />
         <button onclick="handleAddStream()">Add</button>
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
    const deleteBtn = stream.userAdded 
      ? `<button class="icon-btn delete-stream-btn" onclick="handleRemoveStream(${userStreamIndex})" title="Remove stream">✕</button>`
      : '';
    if (stream.userAdded) userStreamIndex++;
    
    html += `
      <div class="mix-item${unavailableClass}">
        <button class="icon-btn" onclick="playLiveStream(${index})"${disabled} title="${escapeHtml(tooltip)}">▶</button>
        <span class="mix-name">${escapeHtml(stream.name)}</span>
        <span class="mix-duration">${stream.genre && stream.genre !== 'Unknown' ? escapeHtml(stream.genre) : ''}</span>
        ${deleteBtn}
      </div>
    `;
  });
  
  mixList.innerHTML = html;
}

function toggleAddStreamForm() {
  const fields = document.getElementById('addStreamFields');
  fields.style.display = fields.style.display === 'none' ? 'block' : 'none';
}

async function handleAddStream() {
   const name = document.getElementById('newStreamName').value.trim();
   const m3u = document.getElementById('newStreamM3U').value.trim();
   const genre = document.getElementById('newStreamGenre').value.trim();
   
   if (!m3u) {
     alert('Playlist URL is required');
     return;
   }
   
   if (!m3u.startsWith('http://') && !m3u.startsWith('https://')) {
     alert('Playlist URL must start with http:// or https://');
     return;
   }
   
   await addUserStream(name, m3u, genre);
   displayLiveStreams();
}

function handleRemoveStream(userIndex) {
  if (confirm('Remove this stream?')) {
    removeUserStream(userIndex);
    displayLiveStreams();
  }
}

function playLiveStream(index) {
  const stream = liveStreams[index];
  if (stream && stream.available) {
    playLive(stream.url, `Live from ${stream.name}`);
  }
}

// Browser modes coordinator
const browserModes = {
  current: 'dj',
  
  switch(mode) {
    if (mode === this.current) return;
    this.current = mode;
    
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    
    const djButtons = document.getElementById('djButtons');
    const djDropdown = document.getElementById('djDropdown');
    const searchBox = document.getElementById('searchBox');
    const groupFilters = document.getElementById('groupFilters');
    const mixList = document.getElementById('mixList');
    
    if (mode === 'dj') {
      djButtons.style.display = 'flex';
      djDropdown.style.display = 'none';
      searchBox.style.display = 'none';
      groupFilters.innerHTML = '';
      mixList.innerHTML = '';
    } else if (mode === 'all') {
      djButtons.style.display = 'none';
      djDropdown.style.display = 'block';
      searchBox.style.display = 'none';
      groupFilters.innerHTML = '';
      mixList.innerHTML = '';
      document.getElementById('djSelect').value = '';
    } else if (mode === 'search') {
      djButtons.style.display = 'none';
      djDropdown.style.display = 'none';
      searchBox.style.display = 'block';
      groupFilters.innerHTML = '';
      
      const searchInput = document.getElementById('searchInput');
      const existingQuery = searchInput.value;
      
      if (searchIndex.data) {
        if (existingQuery.trim()) {
          const results = searchIndex.search(existingQuery);
          displaySearchResults(results, existingQuery);
        } else {
          mixList.innerHTML = '';
          document.getElementById('searchInfo').textContent = `${searchIndex.data.length} mixes available`;
        }
        searchInput.focus();
      } else {
        mixList.innerHTML = '';
        document.getElementById('searchInfo').textContent = 'Loading search index...';
        searchIndex.load().then(() => {
          document.getElementById('searchInfo').textContent = `${searchIndex.data.length} mixes available`;
          searchInput.focus();
        });
      }
    } else if (mode === 'favourites') {
      djButtons.style.display = 'none';
      djDropdown.style.display = 'none';
      searchBox.style.display = 'none';
      groupFilters.innerHTML = '';
      displayFavourites();
    } else if (mode === 'live') {
      djButtons.style.display = 'none';
      djDropdown.style.display = 'none';
      searchBox.style.display = 'none';
      groupFilters.innerHTML = '';
      displayLiveStreams();
    }
  }
};

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => browserModes.switch(btn.dataset.mode));
});

document.getElementById('djSelect').addEventListener('change', function() {
  if (this.value) {
    loadDJ(this.value);
  }
});

let searchTimeout = null;
document.getElementById('searchInput').addEventListener('input', function() {
  clearTimeout(searchTimeout);
  const query = this.value;
  
  searchTimeout = setTimeout(() => {
    const results = searchIndex.search(query);
    displaySearchResults(results, query);
  }, 150);
});

function displaySearchResults(results, query) {
  const mixList = document.getElementById('mixList');
  const searchInfo = document.getElementById('searchInfo');
  
  if (!query.trim()) {
    mixList.innerHTML = '';
    searchInfo.textContent = `${searchIndex.data?.length || 0} mixes available`;
    return;
  }
  
  searchInfo.textContent = `${results.length} result${results.length !== 1 ? 's' : ''} for "${query}"`;
  
  if (results.length === 0) {
    mixList.innerHTML = '<div style="color: #888; padding: 20px;">No mixes found</div>';
    return;
  }
  
  const mixes = results.map(r => ({
    name: r.name,
    file: r.file,
    audioFile: r.audioFile,
    duration: r.duration,
    artist: r.artist,
    genre: r.genre,
    comment: r.comment,
    peaksFile: r.peaksFile,
    coverFile: r.coverFile,
    downloads: r.downloads,
    djPath: r.dj,
    djLabel: r.dj
  }));
  
  displayMixListWithDJ(mixes);
}

function displayMixListWithDJ(mixes) {
    const visibleMixes = mixes.filter(mix => {
      const isHidden = mixFlags.isHidden(getMixId(mix));
      return !isHidden || state.showHiddenMixes;
    });
    
    window.currentSearchMixes = visibleMixes;
    
    const mixList = document.getElementById('mixList');
    const header = visibleMixes.length > 1 ? `<div class="mix-list-header"><button onclick="addAllSearchResultsToQueue()">Add All to Queue</button></div>` : '';
    
    mixList.innerHTML = header + visibleMixes.map((mix, i) => {
      const mixId = getMixId(mix);
      const isFav = mixFlags.isFavourite(mixId);
      const isHidden = mixFlags.isHidden(mixId);
      const favIcon = isFav ? '<span class="fav-icon" title="Favourite">❤️</span>' : '';
      const hiddenIcon = isHidden ? '<span class="hidden-icon" title="Hidden">🚫</span>' : '';
      const djSuffix = mix.djLabel ? ` - ${escapeHtml(mix.djLabel.split('/').pop())}` : '';
      const genre = mix.genre ? ` · ${escapeHtml(mix.genre)}` : '';
      const duration = mix.duration ? `(${mix.duration}${genre})` : '';
      const hasExtra = mix.comment;
      const extraBtn = hasExtra ? `<button class="icon-btn info-btn" onclick="event.stopPropagation(); toggleSearchMixInfo(this)" title="More info">ⓘ</button>` : '';
      const extraInfo = hasExtra ? `<div class="mix-extra-info" style="display:none">${mix.comment ? `<div><strong>Notes:</strong> ${escapeHtml(mix.comment)}</div>` : ''}</div>` : '';
      
      return `<div class="mix-item">
        <button class="icon-btn" onclick="addSearchResultToQueue(${i})" title="Add to queue">+</button>
        <button class="icon-btn" onclick="playSearchResult(${i})" title="Play now">▶</button>
        <span class="mix-name">${escapeHtml(mix.name)}${djSuffix} <span class="mix-duration">${duration}</span></span>
        ${extraBtn}${favIcon}${hiddenIcon}${extraInfo}
      </div>`;
   }).join('');
}

function toggleSearchMixInfo(btn) {
  const info = btn.parentElement.querySelector('.mix-extra-info');
  if (info) {
    info.style.display = info.style.display === 'none' ? 'block' : 'none';
  }
}

function addSearchResultToQueue(index) {
  const mix = window.currentSearchMixes[index];
  if (mix) {
    state.queue.push({ ...mix, queueId: generateQueueId() });
    saveQueue();
    displayQueue();
  }
}

function addAllSearchResultsToQueue() {
  window.currentSearchMixes.forEach(mix => {
    state.queue.push({ ...mix, queueId: generateQueueId() });
  });
  saveQueue();
  displayQueue();
}

async function playSearchResult(index) {
   const mix = window.currentSearchMixes[index];
   if (mix) {
     state.previousQueueIndex = state.currentQueueIndex;
     state.previousQueueTime = aud.currentTime;
     state.playingFromPlayNow = true;
     
     state.queue.push({ ...mix, queueId: generateQueueId() });
     state.currentQueueIndex = state.queue.length - 1;
     saveQueue();
     displayQueue();
     await playMix(mix);
   }
}

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    playPauseBtn.click();
  } else if (e.code === 'ArrowDown' && e.ctrlKey) {
    e.preventDefault();
    skipNext();
  } else if (e.code === 'ArrowUp' && e.ctrlKey) {
    e.preventDefault();
    skipPrev();
  } else if (e.code === 'KeyD' && e.ctrlKey) {
    e.preventDefault();
    browserModes.switch('dj');
  } else if (e.code === 'KeyA' && e.ctrlKey) {
    e.preventDefault();
    browserModes.switch('all');
  } else if (e.code === 'KeyF' && e.ctrlKey) {
    e.preventDefault();
    browserModes.switch('search');
  } else if (e.code === 'KeyV' && e.ctrlKey) {
    e.preventDefault();
    browserModes.switch('favourites');
  } else if (e.code === 'KeyL' && e.ctrlKey) {
    e.preventDefault();
    browserModes.switch('live');
  } else if (e.code === 'Escape') {
    hideSettings();
    hideHelp();
  }
});

// Settings modal
function showSettings() {
   document.getElementById('settingsModal').style.display = 'flex';
   const setting = storage.get('afterPlayNow', 'stop');
   const radio = document.querySelector(`input[name="afterPlayNow"][value="${setting}"]`);
   if (radio) radio.checked = true;
   document.getElementById('showHiddenMixesCheckbox').checked = state.showHiddenMixes;
}

function hideSettings() {
   document.getElementById('settingsModal').style.display = 'none';
}

function updateSetting(key, value) {
   storage.set(key, value);
}

function updateShowHiddenMixes(checked) {
   state.showHiddenMixes = checked;
   if (state.currentDJ) {
     loadDJ(state.currentDJ);
   } else {
     if (state.displayedMixes) {
       displayMixList(state.currentMixes);
     }
   }
}

document.getElementById('settingsModal')?.addEventListener('click', function(e) {
  if (e.target === this) hideSettings();
});

// Help modal
function showHelp() {
  document.getElementById('helpModal').style.display = 'flex';
}

function hideHelp() {
  document.getElementById('helpModal').style.display = 'none';
}

document.getElementById('helpModal')?.addEventListener('click', function(e) {
  if (e.target === this) hideHelp();
});

// Handle local file selection
document.getElementById('fileInput').addEventListener('change', async function(e) {
  const files = Array.from(e.target.files);
  let rejected = 0;
  
  for (const file of files) {
    const canPlay = await checkAudioSupport(file);
    if (canPlay === '') {
      rejected++;
      continue;
    }
    if (canPlay === 'maybe') {
      showToast(`Warning: ${file.name} may not play correctly`);
    }
    const audioSrc = URL.createObjectURL(file);
    state.queue.push({
      name: file.name.replace(/\.[^/.]+$/, ''),
      audioSrc: audioSrc,
      isLocal: true,
      queueId: generateQueueId()
    });
  }
  
  if (rejected > 0) {
    showToast(`${rejected} file(s) not supported by this browser`);
  }
  
  saveQueue();
  displayQueue();
  e.target.value = '';
});

// Initialize favourites button state
updateFavouritesButton();

// Initialize built-in streams on first site load
initializeBuiltinStreams();

// Page restoration
(async function restorePlayer() {
  try {
    const savedLiveUrl = storage.get('liveStreamUrl');
    const savedLiveText = storage.get('liveDisplayText');
    
    if (savedLiveUrl && savedLiveText) {
      browserModes.switch('live');
      await initLiveStreams();
      const stream = liveStreams.find(s => s.url === savedLiveUrl);
      if (stream && stream.available) {
        state.isLive = true;
        state.liveStreamUrl = savedLiveUrl;
        state.liveDisplayText = savedLiveText;
        document.getElementById('nowPlaying').innerHTML = `<h1>${escapeHtml(savedLiveText)}</h1>`;
        document.getElementById('coverArt').innerHTML = '';
        document.getElementById('trackList').innerHTML = '';
        document.title = 'Live - Player';
        loadPeaks(null);
        updateTimeDisplay();
        updatePlayPauseBtn();
      } else {
        storage.remove('liveStreamUrl');
        storage.remove('liveDisplayText');
      }
      return;
    }
    
    const savedPath = storage.get('currentMixPath');
    if (savedPath) {
      const parts = savedPath.split('/');
      const file = parts.pop();
      const djPath = parts.join('/');
      let mix;
      try {
        const mixes = await fetchDJMixes(djPath);
        mix = mixes.find(m => m.file === file);
      } catch (e) {
        // Manifest not available, build minimal object
      }
      if (!mix) {
        mix = { djPath, file, audioFile: `${file}.mp3`, peaksFile: `${file}.peaks.json`, name: file };
      }
      const details = await fetchMixDetails(mix);
      if (details.audioSrc) {
        load(details.audioSrc);
        aud.currentTime = storage.getNum('playerTime', 0);
        state.currentMix = mix;
        state.currentDownloadLinks = details.downloadLinks || [];
        state.currentCoverSrc = details.coverSrc;
        displayTrackList(mix, details.trackListTable, details.downloadLinks, details.coverSrc);
        loadPeaks(details.peaks);
        requestAnimationFrame(resizeWaveformCanvas);
      }
    }
  } catch (e) {
    console.error('Error restoring player:', e);
  }
})();
