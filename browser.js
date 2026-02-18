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

// Delegated event handler for mix list (handles DJ/All/Search modes)
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

   // Track pointer origin and temporarily disable dragging when in popout inputs
   window.lastPointerDownTarget = null;
   document.getElementById('mixList').addEventListener('pointerdown', (e) => {
      window.lastPointerDownTarget = e.target;
      
      // Temporarily disable dragging if pointer is down in input/popout
      const inputInPopout = e.target.closest('.stream-extra-info input, .stream-extra-info textarea');
      if (inputInPopout) {
         const row = e.target.closest('.mix-item');
         if (row && row.draggable) {
            row.dataset.wasDraggable = '1';
            row.draggable = false;
         }
      }
   }, true);
   document.getElementById('mixList').addEventListener('pointerup', () => {
      window.lastPointerDownTarget = null;
      
      // Re-enable dragging
      const rows = document.querySelectorAll('.mix-item[data-was-draggable="1"]');
      rows.forEach(row => {
         row.draggable = true;
         delete row.dataset.wasDraggable;
      });
   }, true);

   // Stream edit event handlers are now in live.js

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

// Live stream functions are now in live.js (shared with live.html)
// browser.js references these functions but doesn't define them

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
      groupFilters.style.display = 'none';
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

// Page restoration
(async function restorePlayer() {
   try {
     // Try restoring live stream first (handles both mix and live restoration)
     const liveRestored = await restoreLivePlayer();
     if (liveRestored) {
       // Clear player.html-specific DOM after playLive() call
       loadPeaks(null);
       document.getElementById('coverArt').innerHTML = '';
       document.getElementById('trackList').innerHTML = '';
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
         state.isRestoring = true;
         load(details.audioSrc);
         const savedTime = storage.getNum('playerTime', 0);
         const wasPlaying = storage.getBool('wasPlaying', false);
         
         // Set currentTime after metadata is loaded
         const handleMetadataLoaded = () => {
           aud.currentTime = savedTime;
           aud.removeEventListener('loadedmetadata', handleMetadataLoaded);
           state.isRestoring = false;
           
           if (wasPlaying) {
             aud.play().catch(() => {});
           }
         };
         aud.addEventListener('loadedmetadata', handleMetadataLoaded, { once: true });
         
         // Fallback in case loadedmetadata never fires
         setTimeout(() => {
           if (state.isRestoring) {
             state.isRestoring = false;
             if (wasPlaying && aud.paused) {
               aud.play().catch(() => {});
             }
           }
         }, 2000);
         
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

// Stream collections management is now in live.js
