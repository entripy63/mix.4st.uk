// browser.js - Browser, Search, Live Streams, and Page Restoration

// Build DJ dropdown dynamically from search-index.json
async function buildDJDropdown() {
  try {
    // Fetch main DJs list from config
    const configResponse = await fetch('mixes/audio-source-config.json');
    const config = configResponse.ok ? await configResponse.json() : {};
    const mainDJs = config.main_djs || [];

    // Fetch search index to extract unique DJs
    const indexResponse = await fetch('mixes/search-index.json');
    const searchIndex = indexResponse.ok ? await indexResponse.json() : [];

    // Extract unique DJs and paths
    const djMap = new Map();
    searchIndex.forEach(mix => {
      const dj = mix.dj;
      if (dj && !djMap.has(dj)) {
        djMap.set(dj, dj);
      }
    });

    const djSelect = document.getElementById('djSelect');
    if (!djSelect) return;

    // Separate into main and other DJs
    const mainDJsList = [];
    const otherDJsList = [];

    djMap.forEach((_, djPath) => {
      const djName = djPath.split('/').pop();
      const isMain = mainDJs.includes(djName);
      if (isMain) {
        mainDJsList.push({ name: djName, path: djPath });
      } else {
        otherDJsList.push({ name: djName, path: djPath });
      }
    });

    // Sort alphabetically
    mainDJsList.sort((a, b) => a.name.localeCompare(b.name));
    otherDJsList.sort((a, b) => a.name.localeCompare(b.name));

    // Build optgroups
    let html = '';
    
    if (mainDJsList.length > 0) {
      html += '<optgroup label="Featured DJs">';
      mainDJsList.forEach(dj => {
        html += `<option value="${dj.path}">${dj.name}</option>`;
      });
      html += '</optgroup>';
    }

    if (otherDJsList.length > 0) {
      html += '<optgroup label="More DJs">';
      otherDJsList.forEach(dj => {
        html += `<option value="${dj.path}">${dj.name}</option>`;
      });
      html += '</optgroup>';
    }

    djSelect.innerHTML = html;
  } catch (e) {
    console.error('Error building DJ dropdown:', e);
  }
}

// State setters - keep state and UI in sync
async function setCurrentDJ(djPath) {
  state.currentDJ = djPath;
  // Store DJ separately for each mode: 'dj' uses currentDJ (backwards compatible), 'all' uses currentDJ_all
  const storageKey = browserModes.current === 'all' ? 'currentDJ_all' : 'currentDJ';
  storage.set(storageKey, djPath);
  state.currentMixes = await fetchDJMixes(djPath);
  state.currentFilter = '';
  storage.set('currentFilter', '');
  state.currentGroups = detectGroups(state.currentMixes);
  state.djCompactMode = true;
  updateDJButtons();
  displayGroupFilters(state.currentMixes);
  displayMixList(state.currentMixes);
}

// Clear DJ selection and return to DJ list
function clearDJSelection() {
  state.currentDJ = '';
  state.currentFilter = '';
  state.djCompactMode = false;
  storage.remove('currentDJ');
  storage.set('currentFilter', '');
  
  const mixList = document.getElementById('mixList');
  const groupFilters = document.getElementById('groupFilters');
  mixList.innerHTML = '';
  groupFilters.innerHTML = '';
  
  const djButtons = document.getElementById('djButtons');
  const djDropdown = document.getElementById('djDropdown');
  const djSelect = document.getElementById('djSelect');
  
  if (browserModes.current === 'dj') {
    djButtons.style.display = 'flex';
    updateDJButtons();
  } else if (browserModes.current === 'all') {
    djDropdown.style.display = 'block';
    if (djSelect) {
      djSelect.value = '';
    }
  }
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
    const buttonDJ = 'mixes/' + btn.textContent.replace('-', '').toLowerCase();
    btn.classList.toggle('active', buttonDJ === state.currentDJ);
  });
}

function displayGroupFilters(mixes) {
  state.currentFilter = '';
  const filterDiv = document.getElementById('groupFilters');
  state.currentGroups = detectGroups(mixes);
  
  const hasDJSelected = state.currentDJ && state.currentDJ.trim() !== '';
  const hasGroups = state.currentGroups.length > 0;
  const isCompactMode = state.djCompactMode === true;
  
  // Only show back button and hide DJ row if there are groups to display AND we're in compact mode
  const backBtn = (hasDJSelected && hasGroups && isCompactMode) ? `<button id="backBtn" class="tab-action-btn" onclick="clearDJSelection()" title="Back to DJ selection">◀</button>` : '';
  
  // Hide DJ buttons/dropdown when DJ is selected AND there are groups AND in compact mode
  if (hasDJSelected && hasGroups && isCompactMode) {
    if (browserModes.current === 'dj') {
      document.getElementById('djButtons').style.display = 'none';
    } else if (browserModes.current === 'all') {
      document.getElementById('djDropdown').style.display = 'none';
    }
  } else {
    if (browserModes.current === 'dj') {
      document.getElementById('djButtons').style.display = 'flex';
    } else if (browserModes.current === 'all') {
      document.getElementById('djDropdown').style.display = 'block';
    }
  }
  
  if (!hasGroups) {
    filterDiv.innerHTML = '';
    return;
  }
  const otherMixes = filterMixes(mixes, 'Other', state.currentGroups);
  const otherButton = otherMixes.length > 0 ? ` <button onclick="applyFilter('Other')">Other</button>` : '';
  filterDiv.innerHTML = backBtn + (backBtn ? ' ' : '') +
    `<button class="active" onclick="applyFilter('')">All</button> ` +
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
   storage.set('currentFilter', group);
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
     
     // Heuristic: Show artist if DJ folder has 15+ unique artists
     const uniqueArtists = new Set(mixes.map(m => m.artist).filter(a => a));
     const showArtist = uniqueArtists.size >= 15;
     
     const mixList = document.getElementById('mixList');
     
     // Show/hide the "Add All" button based on mix count
     const djAddAllBtn = document.getElementById('djAddAllBtn');
     if (djAddAllBtn) {
       djAddAllBtn.style.display = visibleMixes.length > 1 ? '' : 'none';
     }
     
     mixList.innerHTML =
      visibleMixes.map((mix, i) => {
        const mixId = getMixId(mix);
        const isFav = mixFlags.isFavourite(mixId);
        const isHidden = mixFlags.isHidden(mixId);
        const favIcon = isFav ? '<span class="fav-icon" title="Favourite">❤️</span>' : '';
        const hiddenIcon = isHidden ? '<span class="hidden-icon" title="Hidden">🚫</span>' : '';
        const genre = mix.genre ? ` · ${escapeHtml(mix.genre)}` : '';
        // Show artist only if: enabled, artist exists, not "Various", and not already in mix name
        const artist = showArtist && mix.artist && mix.artist !== 'Various'
          && !mix.name.toLowerCase().includes(mix.artist.toLowerCase())
          ? ` by ${escapeHtml(mix.artist)}` : '';
        const hasExtra = mix.date || mix.comment;
        const extraBtn = hasExtra ? `<button class="icon-btn info-btn" data-action="toggle-info" title="More info">ⓘ</button>` : '';
        const extraInfo = hasExtra ? `<div class="mix-extra-info" style="display:none">${mix.date ? `<div><strong>Date:</strong> ${escapeHtml(mix.date)}</div>` : ''}${mix.comment ? `<div><strong>Notes:</strong> ${escapeHtml(mix.comment)}</div>` : ''}</div>` : '';
        return `<div class="mix-item" data-mix-id="${escapeHtml(mixId)}">
        <div class="mix-item-row">
          <span class="mix-name">${escapeHtml(mix.name)}${artist} <span class="mix-duration">(${mix.duration}${genre})</span></span>
          ${favIcon}${hiddenIcon}${extraBtn}
          <button class="icon-btn" data-action="queue-add" title="Add to queue">+</button>
          <button class="icon-btn" data-action="play-now" title="Play now">▶</button>
        </div>
        ${extraInfo}
        </div>`;
      }).join('');
}

function toggleExtraInfo(btn) {
   const info = btn.closest('.mix-item').querySelector('.mix-extra-info');
   if (info) {
      info.style.display = info.style.display === 'none' ? 'block' : 'none';
   }
}

// Wrapper for button click handler
function addAllMixesToQueue() {
  addAllToQueue();
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
       case 'preset-play-now': {
          const presetIndex = actionBtn.closest('.mix-item')?.dataset.presetStreamIndex;
          if (presetIndex !== undefined) playPresetStream(parseInt(presetIndex));
          break;
       }
       case 'preset-add-stream': {
          const presetIndex = actionBtn.closest('.mix-item')?.dataset.presetStreamIndex;
          if (presetIndex !== undefined) addPresetStreamToUserStreams(parseInt(presetIndex));
          break;
       }
       case 'preset-add-all':
          addAllPresetStreamsToUserStreams();
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



// Live stream functions are in livedata.js, livestore.js, liveui.js

// Browser modes coordinator
const browserModes = {
  current: null,
  
  async switch(mode) {
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
    
    const presetDropdown = document.getElementById('presetDropdown');
    if (presetDropdown) presetDropdown.style.display = 'none';
    groupFilters.style.display = '';
    
    if (mode === 'dj') {
      djButtons.style.display = 'flex';
      djDropdown.style.display = 'none';
      searchBox.style.display = 'none';
      groupFilters.innerHTML = '';
      mixList.innerHTML = '';
      
      // Restore DJ mode state (uses currentDJ key for backwards compatibility)
      // Fall back to deriving DJ from currentMixPath if currentDJ not set
      let savedDJ = storage.get('currentDJ');
      if (!savedDJ) {
        const mixPath = storage.get('currentMixPath');
        if (mixPath) {
          const parts = mixPath.split('/');
          parts.pop();
          savedDJ = parts.join('/');
        }
      }
      if (savedDJ) {
        await setCurrentDJ(savedDJ);
        const savedFilter = storage.get('currentFilter', '');
        if (savedFilter) {
          applyFilter(savedFilter);
        }
      }
    } else if (mode === 'all') {
      djButtons.style.display = 'none';
      djDropdown.style.display = 'block';
      searchBox.style.display = 'none';
      groupFilters.innerHTML = '';
      mixList.innerHTML = '';
      
      // Restore 'all' mode state (uses currentDJ_all key for mode-specific storage)
      const savedDJ = storage.get('currentDJ_all');
      if (savedDJ) {
        const djSelect = document.getElementById('djSelect');
        if (djSelect) {
          djSelect.value = savedDJ;
        }
        // Load mixes for the selected DJ without DJ-mode-specific UI updates
        state.currentDJ = savedDJ;
        state.currentMixes = await fetchDJMixes(savedDJ);
        displayGroupFilters(state.currentMixes);
        displayMixList(state.currentMixes);
      }
    } else if (mode === 'search') {
      djButtons.style.display = 'none';
      djDropdown.style.display = 'none';
      searchBox.style.display = 'block';
      groupFilters.innerHTML = '';
      
      const searchInput = document.getElementById('searchInput');
      const existingQuery = searchInput.value;
      
      if (searchIndex.mixData) {
        if (existingQuery.trim()) {
          const results = searchIndex.search(existingQuery);
          displaySearchResults(results, existingQuery);
        } else {
          mixList.innerHTML = '';
          const totalMixes = searchIndex.mixData?.length || 0;
          const totalStreams = searchIndex.streamData?.length || 0;
          document.getElementById('searchInfo').textContent = `${totalMixes} mixes, ${totalStreams} streams available`;
        }
        searchInput.focus();
      } else {
        mixList.innerHTML = '';
        document.getElementById('searchInfo').textContent = 'Loading search index...';
        searchIndex.load().then(() => {
          const totalMixes = searchIndex.mixData?.length || 0;
          const totalStreams = searchIndex.streamData?.length || 0;
          document.getElementById('searchInfo').textContent = `${totalMixes} mixes, ${totalStreams} streams available`;
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
      if (presetDropdown) {
        presetDropdown.style.display = 'block';
        await buildPresetDropdown();
        // Restore last selected preset
        const savedPreset = storage.get('currentPreset');
        const presetSelect = document.getElementById('presetSelect');
        if (savedPreset && presetSelect) {
          presetSelect.value = savedPreset;
          const presets = await getPresets();
          const preset = presets[parseInt(savedPreset)];
          if (preset) {
            displayPresetStreams(preset);
          } else {
            mixList.innerHTML = '<div style="padding: 20px; color: #888;">Select a preset to browse streams</div>';
          }
        } else {
          mixList.innerHTML = '<div style="padding: 20px; color: #888;">Select a preset to browse streams</div>';
        }
      }
    }
  }
};

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => browserModes.switch(btn.dataset.mode));
});

document.getElementById('djSelect')?.addEventListener('change', function() {
  if (this.value) {
    loadDJ(this.value);
  }
});

document.getElementById('presetSelect')?.addEventListener('change', async function() {
  if (this.value === '') {
    document.getElementById('mixList').innerHTML = '<div style="padding: 20px; color: #888;">Select a preset to browse streams</div>';
    storage.remove('currentPreset');
    return;
  }
  const presets = await getPresets();
  const preset = presets[parseInt(this.value)];
  if (preset) {
    storage.set('currentPreset', this.value);
    displayPresetStreams(preset);
  }
});

let searchTimeout = null;
document.getElementById('searchInput').addEventListener('input', function() {
   clearTimeout(searchTimeout);
   const query = this.value;
   storage.set('lastSearchQuery', query);
   
   searchTimeout = setTimeout(() => {
     const results = searchIndex.search(query);
     displaySearchResults(results, query);
   }, 150);
});




// Keyboard shortcuts - use capture to intercept Space early
window.addEventListener('keydown', function(e) {
  if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) && !e.target.isContentEditable) {
    e.preventDefault();
    e.stopPropagation();
    playPauseBtn.click();
    return false;
  }
}, true);

// Other shortcuts remain on document level
document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT') return;
  
  if (e.code === 'ArrowDown' && e.ctrlKey) {
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

// Initialize favourites button state
updateFavouritesButton();

// Stream collections management is in livestore.js
