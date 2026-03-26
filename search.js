// search.js - Search index, search results, and favourites display

// Search index cache
const searchIndex = {
  mixData: null,
  streamData: null,
  byId: null,
  loading: false,

  async load() {
    if (this.mixData && this.streamData) return { mixes: this.mixData, streams: this.streamData };
    if (this.loading) {
      // Wait for existing load to complete
      while (this.loading) await new Promise(r => setTimeout(r, 50));
      return { mixes: this.mixData, streams: this.streamData };
    }

    this.loading = true;
    try {
      // Load both indexes in parallel
      const [mixResponse, streamResponse] = await Promise.all([
        fetch('mixes/search-index.json'),
        fetch('streams/search-index.json')
      ]);
      
      this.mixData = await mixResponse.json();
      this.streamData = await streamResponse.json();
      
      // Build Map for O(1) lookups: dj/file -> mixData
      this.byId = new Map(this.mixData.map(m => [`${m.dj}/${m.file}`, m]));
    } catch (e) {
      console.error('Failed to load search index:', e);
      this.mixData = [];
      this.streamData = [];
      this.byId = new Map();
    }
    this.loading = false;
    return { mixes: this.mixData, streams: this.streamData };
  },

  search(query) {
    if (!this.mixData || !query.trim()) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);

    // Search mixes
    const mixResults = this.mixData.filter(mix => {
      const searchable = `${mix.name} ${mix.artist} ${mix.genre} ${mix.comment} ${mix.dj}`.toLowerCase();
      return terms.every(term => searchable.includes(term));
    }).map(m => ({ ...m, type: 'mix' }));

    // Search indexed streams (from streams/search-index.json)
    const indexedStreamResults = (this.streamData || []).filter(stream => {
      const searchable = `${stream.name} ${stream.genre || ''} ${stream.presetLabel || ''}`.toLowerCase();
      return terms.every(term => searchable.includes(term));
    }).map(s => ({ ...s, type: 'stream', url: s.url }));

    // Combine results (mixes first, then indexed streams)
    return [...mixResults, ...indexedStreamResults];
  }
};

async function displayFavourites() {
  const mixList = document.getElementById('mixList');
  const favouriteIds = [...mixFlags._favourites];

  if (favouriteIds.length === 0) {
    mixList.innerHTML = '<div style="color: #888; padding: 20px;">No favourites yet. Play a mix and click the Fav button to add it here.</div>';
    return;
  }

  // Load search index to get mix metadata
  if (!searchIndex.mixData) {
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

function displaySearchResults(results, query) {
  const mixList = document.getElementById('mixList');
  const searchInfo = document.getElementById('searchInfo');

  if (!query.trim()) {
    mixList.innerHTML = '';
    const totalMixes = searchIndex.mixData?.length || 0;
    const totalStreams = searchIndex.streamData?.length || 0;
    searchInfo.textContent = `${totalMixes} mixes, ${totalStreams} streams available`;
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

  // Separate mixes and streams for proper handling
  const mixes = results.filter(item => !item.type || item.type === 'mix');
  const streams = results.filter(item => item.type === 'stream');
  window.currentSearchMixes = mixes;
  window.currentSearchResults = results;

  const html = results.map((item, i) => {
    if (item.type === 'stream') {
      // Live stream result with 📡 badge
      const genre = item.genre ? ` · ${escapeHtml(item.genre)}` : '';
      const streamIndex = streams.indexOf(item);
      return `<div class="mix-item" data-search-index="${streamIndex}">
   <div class="mix-item-row">
   <span class="mix-name"><span style="font-size: 0.85em;">📡</span> ${escapeHtml(item.name)}${genre}</span>
   <button class="icon-btn" data-action="search-play-stream" title="Play stream">▶</button>
   </div>
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
      const mixIndex = mixes.indexOf(item);

      return `<div class="mix-item" data-search-index="${mixIndex}">
   <div class="mix-item-row">
   <span class="mix-name">♪ ${escapeHtml(item.name)}${djLabel} <span class="mix-duration">${duration}</span></span>
   ${favIcon}${hiddenIcon}${extraBtn}
   <button class="icon-btn" data-action="search-queue-add" title="Add to queue">+</button>
   <button class="icon-btn" data-action="search-play-now" title="Play now">▶</button>
   </div>
   ${extraInfo}
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
   <div class="mix-item-row">
   <span class="mix-name">${escapeHtml(mix.name)}${djSuffix} <span class="mix-duration">${duration}</span></span>
   ${favIcon}${hiddenIcon}${extraBtn}
   <button class="icon-btn" data-action="search-queue-add" title="Add to queue">+</button>
   <button class="icon-btn" data-action="search-play-now" title="Play now">▶</button>
   </div>
   ${extraInfo}
   </div>`;
  }).join('');
}

function addSearchResultToQueue(index) {
  const item = window.currentSearchMixes[index];
  if (item) {
    const mix = { ...item, djPath: item.dj || item.djPath };
    state.queue.push({ ...mix, queueId: generateQueueId() });
    saveQueue();
    displayQueue();
    if (typeof switchMiddleTab === 'function') switchMiddleTab('queue');
  }
}

function addAllSearchResultsToQueue() {
  window.currentSearchMixes.forEach(mix => {
    state.queue.push({ ...mix, queueId: generateQueueId() });
  });
  saveQueue();
  displayQueue();
  if (typeof switchMiddleTab === 'function') switchMiddleTab('queue');
}

async function playSearchResult(index) {
  const item = window.currentSearchMixes[index];
  if (item) {
    // Normalize search result to have djPath
    const mix = { ...item, djPath: item.dj || item.djPath };

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
    playStream(item.url, item.name, true);
  }
}
