// browser.js - Browser, Search, Live Streams, and Page Restoration

// State setters - keep state and UI in sync
async function setCurrentDJ(djPath) {
  state.currentDJ = djPath;
  state.currentMixes = await fetchDJMixes(djPath);
  state.currentFilter = '';
  state.currentGroups = detectGroups(state.currentMixes);
  updateDJButtons();
  displayGroupFilters(state.currentMixes);
  displayMixList(state.currentMixes);
}

function setShowHiddenMixes(show) {
  state.showHiddenMixes = show;
  if (state.currentDJ) {
    displayMixList(state.currentMixes);
  } else if (state.displayedMixes) {
    displayMixList(state.displayedMixes);
  }
}

// Browser UI functions
async function loadDJ(djPath) {
  await setCurrentDJ(djPath);
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
    const header = visibleMixes.length > 1 ? `<div class="mix-list-header"><button data-action="add-all-queue" class="mix-list-btn" title="Add all to queue">Add All to Queue</button></div>` : '';
    mixList.innerHTML = header +
      visibleMixes.map((mix, i) => {
        const mixId = getMixId(mix);
        const isFav = mixFlags.isFavourite(mixId);
        const isHidden = mixFlags.isHidden(mixId);
        const favIcon = isFav ? '<span class="fav-icon" title="Favourite">❤️</span>' : '';
        const hiddenIcon = isHidden ? '<span class="hidden-icon" title="Hidden">🚫</span>' : '';
        const genre = mix.genre ? ` · ${escapeHtml(mix.genre)}` : '';
        const hasExtra = mix.date || mix.comment;
        const extraBtn = hasExtra ? `<button class="icon-btn info-btn" data-action="toggle-info" title="More info">ⓘ</button>` : '';
        const extraInfo = hasExtra ? `<div class="mix-extra-info" style="display:none">${mix.date ? `<div><strong>Date:</strong> ${escapeHtml(mix.date)}</div>` : ''}${mix.comment ? `<div><strong>Notes:</strong> ${escapeHtml(mix.comment)}</div>` : ''}</div>` : '';
        return `<div class="mix-item" data-mix-id="${escapeHtml(mixId)}">
        <button class="icon-btn" data-action="queue-add" title="Add to queue">+</button>
        <button class="icon-btn" data-action="play-now" title="Play now">▶</button>
        <span class="mix-name">${escapeHtml(mix.name)} <span class="mix-duration">(${mix.duration}${genre})</span></span>
        ${extraBtn}${favIcon}${hiddenIcon}${extraInfo}
      </div>`;
      }).join('');
}

function toggleExtraInfo(btn) {
   const info = btn.closest('.mix-item').querySelector('.mix-extra-info');
   if (info) {
     info.style.display = info.style.display === 'none' ? 'block' : 'none';
   }
}

// Delegated event handler for mix list (handles all modes)
document.getElementById('mixList').addEventListener('click', (e) => {
   const actionBtn = e.target.closest('[data-action]');
   if (!actionBtn) return;
   
   const action = actionBtn.dataset.action;
   const mixItem = actionBtn.closest('.mix-item');
   const searchIndex = mixItem?.dataset.searchIndex;
   
   const mixId = mixItem?.dataset.mixId;
   
   switch (action) {
      case 'queue-add':
         if (mixId) addToQueue(mixId);
         break;
      case 'play-now':
         if (mixId) playNow(mixId);
         break;
      case 'search-queue-add':
         if (searchIndex !== undefined) addSearchResultToQueue(parseInt(searchIndex));
         break;
      case 'search-play-now':
         if (searchIndex !== undefined) playSearchResult(parseInt(searchIndex));
         break;
      case 'search-play-stream':
         if (searchIndex !== undefined) playSearchStream(parseInt(searchIndex));
         break;
      case 'toggle-info':
         toggleExtraInfo(actionBtn);
         break;
      case 'add-all-queue':
         addAllToQueue();
         break;
      case 'add-all-search-results':
         addAllSearchResultsToQueue();
         break;
   }
   });

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
  
  // Build mixes from favourited IDs using search index Map (O(1) lookup)
  const mixes = [];
  for (const mixId of favouriteIds) {
    // mixId is like "trip/mix-name" or "haze/mix-name"
    const match = searchIndex.byId.get(mixId);
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
   byId: null,
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
       // Build Map for O(1) lookups: dj/file -> mixData
       this.byId = new Map(this.data.map(m => [`${m.dj}/${m.file}`, m]));
     } catch (e) {
       console.error('Failed to load search index:', e);
       this.data = [];
       this.byId = new Map();
     }
     this.loading = false;
     return this.data;
   },
  
  search(query) {
    if (!this.data || !query.trim()) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    
    // Search mixes
    const mixResults = this.data.filter(mix => {
      const searchable = `${mix.name} ${mix.artist} ${mix.genre} ${mix.comment} ${mix.dj}`.toLowerCase();
      return terms.every(term => searchable.includes(term));
    }).map(m => ({ ...m, type: 'mix' }));
    
    // Search live streams
    const streamResults = (liveStreams || []).filter(stream => {
      if (!stream.available) return false;
      const searchable = `${stream.name} ${stream.genre || ''}`.toLowerCase();
      return terms.every(term => searchable.includes(term));
    }).map(s => ({ ...s, type: 'stream' }));
    
    // Combine results (mixes first, then streams)
    return [...mixResults, ...streamResults];
  }
};

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
     name: config.name,
     genre: config.genre,
     url: null,
     available: false,
     reason: null
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
   
   liveStreamsInitialized = true;
   liveStreams = [];
   for (const config of getLiveStreamConfig()) {
     await probeAndAddStream(config);
     displayLiveStreams();
   }
}

function displayLiveStreams() {
   // Don't update DOM if we're no longer on Live mode
   if (browserModes.current !== 'live') return;
   
   const mixList = document.getElementById('mixList');
   
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
         <button onclick="handleAddStream()">Add</button>
         <button onclick="reloadLiveStreams()" class="reload-btn" title="Reload all streams">⟳</button>
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
    userStreamIndex++;
    
    html += `
      <div class="mix-item${unavailableClass}">
        <button class="icon-btn" onclick="playLiveStream(${index})"${disabled} title="${escapeHtml(tooltip)}">▶</button>
        <div class="stream-info">
          <span class="mix-name">${escapeHtml(stream.name)}</span>
          ${stream.genre && stream.genre !== 'Unknown' ? `<span class="stream-genre">${escapeHtml(stream.genre)}</span>` : ''}
        </div>
        ${deleteBtn}
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
    playLive(stream.url, `Live from ${stream.name}`);
  }
}

// Browser modes coordinator
const browserModes = {
  current: 'dj',
  
  switch(mode) {
    if (mode === this.current) return;
    this.current = mode;
    storage.set('browserMode', mode);
    
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    
    const djButtons = document.getElementById('djButtons');
    const djDropdown = document.getElementById('djDropdown');
    const searchBox = document.getElementById('searchBox');
    const groupFilters = document.getElementById('groupFilters');
    const mixList = document.getElementById('mixList');
    
    document.getElementById('findPlaylistsBtn').style.display = 'none';
    
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
      document.getElementById('findPlaylistsBtn').style.display = 'flex';
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
     mixList.innerHTML = '<div style="color: #888; padding: 20px;">No results found</div>';
     return;
   }
   
   displayMixedSearchResults(results);
   }

   function displayMixedSearchResults(results) {
   const mixList = document.getElementById('mixList');
   window.currentSearchResults = results;
   
   const html = results.map((item, i) => {
     if (item.type === 'stream') {
       // Live stream result with 📡 badge
       const genre = item.genre ? ` · ${escapeHtml(item.genre)}` : '';
       return `<div class="mix-item" data-search-index="${i}">
         <button class="icon-btn" style="visibility: hidden; cursor: default;" disabled>+</button>
         <button class="icon-btn" data-action="search-play-stream" title="Play stream">▶</button>
         <span class="mix-name"><span style="font-size: 0.85em;">📡</span> ${escapeHtml(item.name)}${genre}</span>
       </div>`;
     } else {
       // Mix result with ♪ badge
       const mixId = `${item.dj}/${item.file}`;
       const isFav = mixFlags.isFavourite(mixId);
       const isHidden = mixFlags.isHidden(mixId);
       const favIcon = isFav ? '<span class="fav-icon" title="Favourite">❤️</span>' : '';
       const hiddenIcon = isHidden ? '<span class="hidden-icon" title="Hidden">🚫</span>' : '';
       const genre = item.genre ? ` · ${escapeHtml(item.genre)}` : '';
       const duration = item.duration ? `(${item.duration}${genre})` : '';
       const hasExtra = item.comment;
       const extraBtn = hasExtra ? `<button class="icon-btn info-btn" data-action="toggle-info" title="More info">ⓘ</button>` : '';
       const extraInfo = hasExtra ? `<div class="mix-extra-info" style="display:none"><div><strong>Notes:</strong> ${escapeHtml(item.comment)}</div></div>` : '';
       const djLabel = item.dj ? ` - ${escapeHtml(item.dj)}` : '';
       
       return `<div class="mix-item" data-search-index="${i}">
         <button class="icon-btn" data-action="search-queue-add" title="Add to queue">+</button>
         <button class="icon-btn" data-action="search-play-now" title="Play now">▶</button>
         <span class="mix-name">♪ ${escapeHtml(item.name)}${djLabel} <span class="mix-duration">${duration}</span></span>
         ${extraBtn}${favIcon}${hiddenIcon}${extraInfo}
       </div>`;
     }
   }).join('');
   
   mixList.innerHTML = html;
   }
   
   function displayMixListWithDJ(mixes) {
     const visibleMixes = mixes.filter(mix => {
       const isHidden = mixFlags.isHidden(getMixId(mix));
       return !isHidden || state.showHiddenMixes;
     });
     
     window.currentSearchMixes = visibleMixes;
     
     const mixList = document.getElementById('mixList');
     const header = visibleMixes.length > 1 ? `<div class="mix-list-header"><button data-action="add-all-search-results" class="mix-list-btn" title="Add all to queue">Add All to Queue</button></div>` : '';
     
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
       const extraBtn = hasExtra ? `<button class="icon-btn info-btn" data-action="toggle-info" title="More info">ⓘ</button>` : '';
       const extraInfo = hasExtra ? `<div class="mix-extra-info" style="display:none">${mix.comment ? `<div><strong>Notes:</strong> ${escapeHtml(mix.comment)}</div>` : ''}</div>` : '';
       
       return `<div class="mix-item" data-search-index="${i}">
         <button class="icon-btn" data-action="search-queue-add" title="Add to queue">+</button>
         <button class="icon-btn" data-action="search-play-now" title="Play now">▶</button>
         <span class="mix-name">${escapeHtml(mix.name)}${djSuffix} <span class="mix-duration">${duration}</span></span>
         ${extraBtn}${favIcon}${hiddenIcon}${extraInfo}
       </div>`;
    }).join('');
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

async function playSearchStream(index) {
   const item = window.currentSearchResults?.[index];
   if (item && item.type === 'stream') {
     state.isLive = true;
     state.liveStreamUrl = item.url;
     state.liveDisplayText = item.name;
     storage.set('liveStreamUrl', item.url);
     storage.set('liveDisplayText', item.name);
     
     document.getElementById('nowPlaying').innerHTML = `<h1>${escapeHtml(item.name)}</h1>`;
     document.getElementById('coverArt').innerHTML = '';
     document.getElementById('trackList').innerHTML = '';
     document.title = 'Live - Player';
     loadPeaks(null);
     updateTimeDisplay();
     
     aud.src = item.url;
     aud.play();
     updatePlayPauseBtn();
   }
}

// Playlist guide modal
function showPlaylistGuide() {
  document.getElementById('playlistGuideModal').style.display = 'flex';
}

function hidePlaylistGuide() {
  document.getElementById('playlistGuideModal').style.display = 'none';
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
   setShowHiddenMixes(checked);
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

// Initialize live streams in background on page load
initLiveStreams().catch(e => console.error('Failed to initialize live streams:', e));

// Page restoration
(async function restorePlayer() {
  try {
    const savedLiveUrl = storage.get('liveStreamUrl');
    const savedLiveText = storage.get('liveDisplayText');
    
    if (savedLiveUrl && savedLiveText) {
      playLive(savedLiveUrl, savedLiveText);
      await initLiveStreams();
      // Restore browser mode and return - don't restore mix
      const savedBrowserMode = storage.get('browserMode', 'live');
      browserModes.switch(savedBrowserMode);
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
  
  // Restore browser mode for non-live restoration
  const savedBrowserMode = storage.get('browserMode', 'dj');
  browserModes.switch(savedBrowserMode);
  })();
