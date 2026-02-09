function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const storage = {
  get(key, defaultVal = null) {
    const val = localStorage.getItem(key);
    return val !== null ? val : defaultVal;
  },
  getNum(key, defaultVal = 0) {
    const val = localStorage.getItem(key);
    return val !== null ? parseFloat(val) : defaultVal;
  },
  getJSON(key, defaultVal = null) {
    try {
      const val = localStorage.getItem(key);
      return val !== null ? JSON.parse(val) : defaultVal;
    } catch { return defaultVal; }
  },
  getBool(key, defaultVal = false) {
    return localStorage.getItem(key) === 'true' || (localStorage.getItem(key) === null && defaultVal);
  },
  set(key, val) {
    localStorage.setItem(key, typeof val === 'object' ? JSON.stringify(val) : val);
  },
  remove(key) {
    localStorage.removeItem(key);
  }
};

const aud = document.getElementById("audioPlayer");
const waveformCanvas = document.getElementById("waveform");
const waveformCtx = waveformCanvas.getContext("2d");

const state = {
  currentPeaks: null,
  isResizing: false,
  currentMixes: [],
  currentDJ: '',
  currentFilter: '',
  currentGroups: [],
  displayedMixes: [],
  draggedIndex: null,
  queue: storage.getJSON('queue', []),
  currentQueueIndex: storage.getNum('currentQueueIndex', -1),
  loopQueue: storage.getBool('loopQueue'),
  queueIdCounter: storage.getNum('queueIdCounter', 0)
};

// Set canvas resolution to match CSS size
function resizeWaveformCanvas() {
  const w = waveformCanvas.offsetWidth || 500;
  const h = waveformCanvas.offsetHeight || 60;
  if (waveformCanvas.width !== w) waveformCanvas.width = w;
  if (waveformCanvas.height !== h) waveformCanvas.height = h;
  if (state.currentPeaks) {
    const progress = aud.duration ? aud.currentTime / aud.duration : 0;
    drawWaveform(state.currentPeaks, progress);
  }
}
resizeWaveformCanvas();
window.addEventListener('load', resizeWaveformCanvas);

function drawWaveform(peaks, progress = 0) {
  const w = waveformCanvas.width;
  const h = waveformCanvas.height;
  const barWidth = w / peaks.length;
  
  waveformCtx.clearRect(0, 0, w, h);
  
  peaks.forEach((peak, i) => {
    const x = i * barWidth;
    const barHeight = peak * h * 0.9;
    const y = (h - barHeight) / 2;
    
    // Played portion in accent color, unplayed in muted
    const playedX = w * progress;
    waveformCtx.fillStyle = x < playedX ? '#5c6bc0' : '#3d3d5c';
    waveformCtx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight);
  });
  
  // Draw cursor line
  if (progress > 0) {
    const cursorX = w * progress;
    waveformCtx.strokeStyle = '#fff';
    waveformCtx.lineWidth = 2;
    waveformCtx.beginPath();
    waveformCtx.moveTo(cursorX, 0);
    waveformCtx.lineTo(cursorX, h);
    waveformCtx.stroke();
  }
}

function updateWaveformCursor() {
  if (state.currentPeaks && aud.duration) {
    const progress = aud.currentTime / aud.duration;
    drawWaveform(state.currentPeaks, progress);
  }
}

// Update waveform cursor during playback
setInterval(updateWaveformCursor, 100);

// Click on waveform to seek
waveformCanvas.addEventListener('click', function(e) {
  if (aud.duration) {
    const rect = waveformCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = x / waveformCanvas.width;
    aud.currentTime = progress * aud.duration;
    updateWaveformCursor();
  }
});

// Initialize with empty waveform
state.currentPeaks = null;
drawWaveform([], 0);

// Waveform resize handling
const resizeHandle = document.getElementById('waveformResizeHandle');

// Restore saved height
const savedHeight = storage.getNum('waveformHeight', 0);
if (savedHeight) {
  waveformCanvas.style.height = savedHeight + 'px';
  waveformCanvas.height = savedHeight;
}

resizeHandle.addEventListener('mousedown', startResize);
resizeHandle.addEventListener('touchstart', startResize, { passive: false });

function startResize(e) {
  e.preventDefault();
  state.isResizing = true;
  document.addEventListener('mousemove', doResize);
  document.addEventListener('mouseup', stopResize);
  document.addEventListener('touchmove', doResize, { passive: false });
  document.addEventListener('touchend', stopResize);
}

function doResize(e) {
  if (!state.isResizing) return;
  e.preventDefault();
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const rect = waveformCanvas.getBoundingClientRect();
  let newHeight = clientY - rect.top;
  newHeight = Math.max(30, Math.min(200, newHeight));
  waveformCanvas.style.height = newHeight + 'px';
  waveformCanvas.height = newHeight;
  if (state.currentPeaks) drawWaveform(state.currentPeaks, aud.currentTime / aud.duration || 0);
}

function stopResize() {
  if (!state.isResizing) return;
  state.isResizing = false;
  document.removeEventListener('mousemove', doResize);
  document.removeEventListener('mouseup', stopResize);
  document.removeEventListener('touchmove', doResize);
  document.removeEventListener('touchend', stopResize);
  storage.set('waveformHeight', waveformCanvas.height);
}

function loadPeaks(peaks) {
  if (peaks && peaks.length > 0) {
    state.currentPeaks = peaks;
    drawWaveform(state.currentPeaks, 0);
  } else {
    state.currentPeaks = null;
    waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
  }
}

// Restore volume from localStorage, default to 50%
aud.volume = storage.getNum('playerVolume', 0.5);

// Save volume on change
aud.addEventListener("volumechange", function () {
  storage.set('playerVolume', aud.volume);
});

// Save position periodically
setInterval(function () {
  if (aud.src && !aud.paused) {
    storage.set('playerTime', aud.currentTime);
  }
}, 5000);

// Save position on pause and before unload
aud.addEventListener("pause", function () {
  storage.set('playerTime', aud.currentTime);
});
window.addEventListener("beforeunload", function () {
  storage.set('playerTime', aud.currentTime);
});

aud.addEventListener("ended", async function () {
  if (state.currentQueueIndex >= 0 && state.currentQueueIndex < state.queue.length - 1) {
    state.currentQueueIndex++;
    saveQueue();
    await playFromQueue(state.currentQueueIndex);
  } else if (state.loopQueue && state.queue.length > 0) {
    state.currentQueueIndex = 0;
    saveQueue();
    await playFromQueue(state.currentQueueIndex);
  }
});

aud.addEventListener("play", updateQueueInfo);
aud.addEventListener("pause", updateQueueInfo);

function load(url) {
  aud.src = url;
  aud.currentTime = 0;
}

function play(url) {
  load(url);
  aud.play();
}



function generateQueueId() {
  state.queueIdCounter++;
  storage.set('queueIdCounter', state.queueIdCounter);
  return state.queueIdCounter;
}

// Ensure existing queue items have IDs
state.queue.forEach(item => {
  if (!item.queueId) item.queueId = generateQueueId();
});

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function saveQueue() {
  const persistableQueue = state.queue.filter(mix => !mix.isLocal);
  storage.set('queue', persistableQueue);
  // Recalculate index for persistable queue
  const currentMix = state.queue[state.currentQueueIndex];
  const persistedIndex = currentMix && !currentMix.isLocal 
    ? persistableQueue.findIndex(m => getMixId(m) === getMixId(currentMix))
    : -1;
  storage.set('currentQueueIndex', persistedIndex);
}

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
  filterDiv.innerHTML = `<button class="active" onclick="applyFilter('')">All</button> ` +
    state.currentGroups.map(g => `<button onclick="applyFilter('${g}')">${g}</button>`).join(' ') +
    ` <button onclick="applyFilter('Other')">Other</button>`;
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

function getMixId(mix) {
  return mix.htmlPath || `${mix.djPath}/${mix.file}`;
}

function displayMixList(mixes) {
  state.displayedMixes = mixes;
  const mixList = document.getElementById('mixList');
  const header = mixes.length > 1 ? `<div class="mix-list-header"><button onclick="addAllToQueue()">Add All to Queue</button></div>` : '';
  mixList.innerHTML = header +
    mixes.map((mix, i) => {
      const mixId = getMixId(mix);
      const genre = mix.genre ? ` · ${escapeHtml(mix.genre)}` : '';
      const hasExtra = mix.date || mix.comment;
      const extraBtn = hasExtra ? `<button class="icon-btn info-btn" onclick="event.stopPropagation(); toggleMixInfo(this)" title="More info">ⓘ</button>` : '';
      const extraInfo = hasExtra ? `<div class="mix-extra-info" style="display:none">${mix.date ? `<div><strong>Date:</strong> ${escapeHtml(mix.date)}</div>` : ''}${mix.comment ? `<div><strong>Notes:</strong> ${escapeHtml(mix.comment)}</div>` : ''}</div>` : '';
      return `<div class="mix-item">
      <button class="icon-btn" onclick="addToQueue('${mixId}')" title="Add to queue">+</button>
      <button class="icon-btn" onclick="playNow('${mixId}')" title="Play now">▶</button>
      <span class="mix-name">${escapeHtml(mix.name)} <span class="mix-duration">(${mix.duration}${genre})</span></span>
      ${extraBtn}${extraInfo}
    </div>`;
    }).join('');
}

function toggleMixInfo(btn) {
  const info = btn.parentElement.querySelector('.mix-extra-info');
  if (info) {
    info.style.display = info.style.display === 'none' ? 'block' : 'none';
  }
}

function addAllToQueue() {
  state.displayedMixes.forEach(mix => {
    state.queue.push({ ...mix, queueId: generateQueueId() });
  });
  saveQueue();
  displayQueue();
}

function addToQueue(mixId) {
  const mix = state.currentMixes.find(m => getMixId(m) === mixId);
  if (mix) {
    state.queue.push({ ...mix, queueId: generateQueueId() });
    saveQueue();
    displayQueue();
  }
}

async function playMix(mix) {
  document.title = `${mix.name} - Player`;
  state.currentMix = mix;
  
  if (mix.isLocal) {
    storage.remove('currentMixPath');
    play(mix.audioSrc);
    displayTrackList(mix, '', [], null);
    loadPeaks(null);
  } else {
    // Store mix identifier for restore (works with both manifest and HTML-based mixes)
    const mixId = mix.htmlPath || `${mix.djPath}/${mix.file}`;
    storage.set('currentMixPath', mixId);
    const details = await fetchMixDetails(mix);
    if (details.audioSrc) {
      play(details.audioSrc);
      displayTrackList(mix, details.trackListTable, details.downloadLinks, details.coverSrc);
      loadPeaks(details.peaks);
    }
  }
  displayQueue();
}

async function playNow(mixId) {
  state.currentQueueIndex = -1;
  const mix = state.currentMixes.find(m => getMixId(m) === mixId);
  await playMix(mix || { name: mixId.split('/').pop(), htmlPath: mixId });
}

function displayTrackList(mix, table, downloadLinks, coverSrc) {
  const trackListDiv = document.getElementById('trackList');
  const coverArtDiv = document.getElementById('coverArt');
  
  let downloads = '';
  if (downloadLinks && downloadLinks.length > 0) {
    downloads = `<div class="downloads">
      <h2>Downloads</h2>
      ${downloadLinks.map(d => `<a class="download-btn" href="${d.href}" download>${d.label}</a>`).join('')}
    </div>`;
  }
  // Always show mix name and artist
  const mixName = mix ? escapeHtml(mix.name) : '';
  const djName = mix ? escapeHtml(mix.artist || getDJName(mix.htmlPath || mix.djPath)) : '';
  const heading = mixName ? `<h1>${mixName} by ${djName}</h1>` : '';
  const trackListSection = table ? `<h2>Track List</h2>${table}` : '';
  trackListDiv.innerHTML = heading + trackListSection + downloads;
  
  // Show cover art only if there's no track list (track list takes precedence)
  if (coverSrc && !table) {
    coverArtDiv.innerHTML = `<img src="${coverSrc}" alt="Cover art">`;
  } else {
    coverArtDiv.innerHTML = '';
  }
}

function getDJName(htmlPath) {
  if (!htmlPath) return '';
  const dir = htmlPath.split('/')[0];
  const djNames = { 'trip': 'trip-', 'izmar': 'Izmar', 'aboo': 'Aboo' };
  return djNames[dir] || dir;
}

function updateQueueInfo() {
  const infoDiv = document.querySelector('.queue-info');
  if (!infoDiv || state.queue.length === 0) return;
  
  const totalDuration = calculateTotalDuration();
  const durationText = totalDuration ? ` · ${totalDuration}` : '';
  const playState = aud.paused ? 'Stopped' : 'Playing';
  
  infoDiv.textContent = state.currentQueueIndex >= 0 
    ? `${playState} ${state.currentQueueIndex + 1} of ${state.queue.length}${durationText}`
    : `${state.queue.length} mixes${durationText}`;
}

function displayQueue() {
  const queueDiv = document.getElementById('queue');
  const totalDuration = calculateTotalDuration();
  const durationText = totalDuration ? ` · ${totalDuration}` : '';
  const playState = aud.paused ? 'Stopped' : 'Playing';
  const queueInfo = state.queue.length > 0 
    ? `<div class="queue-info">${state.currentQueueIndex >= 0 ? `${playState} ${state.currentQueueIndex + 1} of ${state.queue.length}` : `${state.queue.length} mixes`}${durationText}</div>` 
    : '';
  const header = state.queue.length > 0 
    ? `<div class="queue-header">
        <button onclick="clearQueue()">Clear</button>
        <button onclick="shuffleQueue()">Shuffle</button>
        <button class="loop-btn${state.loopQueue ? ' active' : ''}" onclick="toggleLoop()">Loop</button>
        <button onclick="skipPrev()" title="Previous in queue">↑ Prev</button>
        <button onclick="skipNext()" title="Next in queue">↓ Next</button>
      </div>` 
    : '';
  queueDiv.innerHTML = queueInfo + header + state.queue.map((mix, i) => {
    const djName = mix.artist || getDJName(mix.htmlPath || mix.djPath);
    const djSuffix = mix.isLocal ? '' : ` - ${escapeHtml(djName)}`;
    return `<div class="queue-item${i === state.currentQueueIndex ? ' current' : ''}" 
          draggable="true" 
          ondragstart="onDragStart(event, ${i})" 
          ondragover="onDragOver(event)" 
          ondrop="onDrop(event, ${i})"
          ondragend="onDragEnd()">
      <span class="drag-handle">☰</span>
      <span class="mix-name" onclick="playFromQueue(${i})">${escapeHtml(mix.name)}${djSuffix}</span>
      ${i !== state.currentQueueIndex ? `<button class="remove-btn" onclick="removeFromQueue(${i})">✕</button>` : ''}
    </div>`;
  }).join('');
}

function onDragStart(e, index) {
  state.draggedIndex = index;
  e.currentTarget.classList.add('dragging');
}

function onDragOver(e) {
  e.preventDefault();
}

function onDrop(e, dropIndex) {
  e.preventDefault();
  if (state.draggedIndex === null || state.draggedIndex === dropIndex) return;
  
  const draggedItem = state.queue.splice(state.draggedIndex, 1)[0];
  state.queue.splice(dropIndex, 0, draggedItem);
  
  // Update currentQueueIndex to follow the currently playing item
  if (state.currentQueueIndex === state.draggedIndex) {
    state.currentQueueIndex = dropIndex;
  } else if (state.draggedIndex < state.currentQueueIndex && dropIndex >= state.currentQueueIndex) {
    state.currentQueueIndex--;
  } else if (state.draggedIndex > state.currentQueueIndex && dropIndex <= state.currentQueueIndex) {
    state.currentQueueIndex++;
  }
  
  saveQueue();
  displayQueue();
}

function onDragEnd() {
  state.draggedIndex = null;
  document.querySelectorAll('.queue-item').forEach(el => el.classList.remove('dragging'));
}

function clearQueue() {
  state.queue = [];
  state.currentQueueIndex = -1;
  saveQueue();
  displayQueue();
}

function shuffleQueue() {
  const currentMix = state.currentQueueIndex >= 0 ? state.queue[state.currentQueueIndex] : null;
  for (let i = state.queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
  }
  if (currentMix) {
    state.currentQueueIndex = state.queue.findIndex(m => m.queueId === currentMix.queueId);
  }
  saveQueue();
  displayQueue();
}

function toggleLoop() {
  state.loopQueue = !state.loopQueue;
  storage.set('loopQueue', state.loopQueue);
  displayQueue();
}

function calculateTotalDuration() {
  let totalMinutes = 0;
  let hasDuration = false;
  state.queue.forEach(mix => {
    if (mix.duration && mix.duration !== '0:00:00') {
      const parts = mix.duration.split(':');
      totalMinutes += parseInt(parts[0]) * 60 + parseInt(parts[1]);
      hasDuration = true;
    }
  });
  if (!hasDuration) return '';
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${hours}:${mins.toString().padStart(2, '0')}:00`;
}

function skipNext() {
  if (state.currentQueueIndex >= 0 && state.currentQueueIndex < state.queue.length - 1) {
    playFromQueue(state.currentQueueIndex + 1);
  }
}

function skipPrev() {
  if (state.currentQueueIndex > 0) {
    playFromQueue(state.currentQueueIndex - 1);
  }
}

async function playFromQueue(index) {
  state.currentQueueIndex = index;
  saveQueue();
  await playMix(state.queue[index]);
}

function removeFromQueue(index) {
  if (index !== state.currentQueueIndex) {
    state.queue.splice(index, 1);
    if (index < state.currentQueueIndex) state.currentQueueIndex--;
    saveQueue();
    displayQueue();
  }
}

displayQueue();

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (aud.paused) {
      aud.play();
    } else {
      aud.pause();
    }
  } else if (e.code === 'ArrowRight' && e.ctrlKey) {
    skipNext();
  } else if (e.code === 'ArrowLeft' && e.ctrlKey) {
    skipPrev();
  }
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

async function checkAudioSupport(file) {
  const mimeType = file.type || guessMimeType(file.name);
  if (!mimeType) return 'maybe';
  
  const testAudio = document.createElement('audio');
  let result = testAudio.canPlayType(mimeType);
  
  // For M4A, try to detect codec by probing playback
  if (mimeType.includes('m4a') || mimeType.includes('mp4')) {
    result = await probeAudioPlayback(file);
  }
  
  return result;
}

function guessMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const types = {
    'mp3': 'audio/mpeg',
    'm4a': 'audio/mp4',
    'ogg': 'audio/ogg',
    'wav': 'audio/wav',
    'flac': 'audio/flac',
    'webm': 'audio/webm'
  };
  return types[ext] || '';
}

function probeAudioPlayback(file) {
  return new Promise(resolve => {
    const testAudio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    
    const cleanup = () => {
      testAudio.src = '';
      URL.revokeObjectURL(url);
    };
    
    testAudio.addEventListener('canplay', () => {
      cleanup();
      resolve('probably');
    }, { once: true });
    
    testAudio.addEventListener('error', () => {
      cleanup();
      resolve('');
    }, { once: true });
    
    setTimeout(() => {
      cleanup();
      resolve('maybe');
    }, 3000);
    
    testAudio.src = url;
    testAudio.load();
  });
}

// Restore last playing mix on page load
(async function restorePlayer() {
  try {
    const savedPath = storage.get('currentMixPath');
    if (savedPath) {
      // savedPath could be "dj/file.html" (legacy) or "dj/file" (manifest)
      const isLegacy = savedPath.endsWith('.html');
      let mix;
      if (isLegacy) {
        mix = { htmlPath: savedPath, name: savedPath.split('/').pop().replace('.html', '') };
      } else {
        const parts = savedPath.split('/');
        const file = parts.pop();
        const djPath = parts.join('/');
        // Try to get full mix data from manifest
        try {
          const mixes = await fetchDJMixes(djPath);
          mix = mixes.find(m => m.file === file);
        } catch (e) {
          // Manifest not available, build minimal object
        }
        if (!mix) {
          mix = { djPath, file, audioFile: `${file}.mp3`, peaksFile: `${file}.peaks.json`, name: file };
        }
      }
      const details = await fetchMixDetails(mix);
      if (details.audioSrc) {
        load(details.audioSrc);
        aud.currentTime = storage.getNum('playerTime', 0);
        state.currentMix = mix;
        displayTrackList(mix, details.trackListTable, details.downloadLinks, details.coverSrc);
        loadPeaks(details.peaks);
        // Ensure waveform draws after layout is ready
        requestAnimationFrame(resizeWaveformCanvas);
      }
    }
  } catch (e) {
    console.error('Error restoring player:', e);
  }
})();