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
        <div class="mix-item-row">
          <button class="icon-btn" data-action="queue-add" title="Add to queue">+</button>
          <button class="icon-btn" data-action="play-now" title="Play now">▶</button>
          <span class="mix-name">${escapeHtml(mix.name)} <span class="mix-duration">(${mix.duration}${genre})</span></span>
          ${extraBtn}${favIcon}${hiddenIcon}
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
    
    document.querySelector('.findPlaylistsBtnContainer').style.display = 'none';
    
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
      document.querySelector('.findPlaylistsBtnContainer').style.display = 'flex';
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

// Initialize favourites button state
updateFavouritesButton();

// Stream collections management is now in live.js
