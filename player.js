let aud = document.getElementById("audioPlayer");
let waveformCanvas = document.getElementById("waveform");
let waveformCtx = waveformCanvas.getContext("2d");
let currentPeaks = null;

// Generate fake waveform data for testing
function generateFakePeaks(count) {
  const peaks = [];
  for (let i = 0; i < count; i++) {
    const base = 0.3 + Math.sin(i * 0.02) * 0.2;
    const noise = Math.random() * 0.4;
    peaks.push(Math.min(1, base + noise));
  }
  return peaks;
}

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
  if (currentPeaks && aud.duration) {
    const progress = aud.currentTime / aud.duration;
    drawWaveform(currentPeaks, progress);
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
currentPeaks = null;
drawWaveform([], 0);

function loadPeaks(peaks) {
  if (peaks && peaks.length > 0) {
    currentPeaks = peaks;
    drawWaveform(currentPeaks, 0);
  } else {
    // Fallback to fake peaks if no real data
    currentPeaks = generateFakePeaks(200);
    drawWaveform(currentPeaks, 0);
  }
}

// Restore volume from localStorage, default to 50%
aud.volume = localStorage.getItem('playerVolume') !== null 
  ? parseFloat(localStorage.getItem('playerVolume')) 
  : 0.5;

// Save volume on change
aud.addEventListener("volumechange", function () {
  localStorage.setItem('playerVolume', aud.volume);
});

// Save position periodically
setInterval(function () {
  if (aud.src && !aud.paused) {
    localStorage.setItem('playerTime', aud.currentTime);
  }
}, 5000);

// Save position on pause and before unload
aud.addEventListener("pause", function () {
  localStorage.setItem('playerTime', aud.currentTime);
});
window.addEventListener("beforeunload", function () {
  localStorage.setItem('playerTime', aud.currentTime);
});

aud.addEventListener("ended", async function () {
  if (currentQueueIndex >= 0 && currentQueueIndex < queue.length - 1) {
    currentQueueIndex++;
    saveQueue();
    await playFromQueue(currentQueueIndex);
  }
});

function load(url) {
  aud.src = url;
  aud.currentTime = 0;
}

function play(url) {
  load(url);
  aud.play();
}



let currentMixes = [];
let currentDJ = '';
let queue = JSON.parse(localStorage.getItem('queue') || '[]');
let currentQueueIndex = parseInt(localStorage.getItem('currentQueueIndex') || '-1');

function saveQueue() {
  const persistableQueue = queue.filter(mix => !mix.isLocal);
  localStorage.setItem('queue', JSON.stringify(persistableQueue));
  // Recalculate index for persistable queue
  const currentMix = queue[currentQueueIndex];
  const persistedIndex = currentMix && !currentMix.isLocal 
    ? persistableQueue.findIndex(m => m.htmlPath === currentMix.htmlPath)
    : -1;
  localStorage.setItem('currentQueueIndex', persistedIndex.toString());
}

async function loadDJ(djPath) {
  currentDJ = djPath;
  currentMixes = await fetchDJMixes(djPath);
  updateDJButtons();
  displayGroupFilters(currentMixes);
  displayMixList(currentMixes);
}

function updateDJButtons() {
  document.querySelectorAll('#djButtons button').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.replace('-', '').toLowerCase() === currentDJ);
  });
}

let currentFilter = '';

let currentGroups = [];

function displayGroupFilters(mixes) {
  currentFilter = '';
  const filterDiv = document.getElementById('groupFilters');
  if (currentDJ !== 'trip') {
    filterDiv.innerHTML = '';
    currentGroups = [];
    return;
  }
  currentGroups = detectGroups(mixes);
  filterDiv.innerHTML = `<button class="active" onclick="applyFilter('')">All</button> ` +
    currentGroups.map(g => `<button onclick="applyFilter('${g}')">${g}</button>`).join(' ') +
    ` <button onclick="applyFilter('Other')">Other</button>`;
}

function updateFilterButtons() {
  document.querySelectorAll('#groupFilters button').forEach(btn => {
    btn.classList.toggle('active', btn.textContent === (currentFilter || 'All'));
  });
}

function applyFilter(group) {
  currentFilter = group;
  updateFilterButtons();
  const filtered = filterMixes(currentMixes, group, currentGroups);
  displayMixList(filtered);
}

let displayedMixes = [];

function displayMixList(mixes) {
  displayedMixes = mixes;
  const mixList = document.getElementById('mixList');
  const header = mixes.length > 1 ? `<div class="mix-list-header"><button onclick="addAllToQueue()">Add All to Queue</button></div>` : '';
  mixList.innerHTML = header +
    mixes.map((mix, i) => 
    `<div class="mix-item">
      <button class="icon-btn" onclick="addToQueue('${mix.htmlPath}')" title="Add to queue">+</button>
      <button class="icon-btn" onclick="playNow('${mix.htmlPath}')" title="Play now">▶</button>
      <span class="mix-name">${mix.name} <span class="mix-duration">(${mix.duration})</span></span>
    </div>`
  ).join('');
}

function addAllToQueue() {
  [...displayedMixes].reverse().forEach(mix => {
    if (!queue.some(q => q.htmlPath === mix.htmlPath)) {
      queue.push(mix);
    }
  });
  saveQueue();
  displayQueue();
}

function addToQueue(htmlPath) {
  const mix = currentMixes.find(m => m.htmlPath === htmlPath);
  if (mix && !queue.some(q => q.htmlPath === htmlPath)) {
    queue.push(mix);
    saveQueue();
    displayQueue();
  }
}

let currentlyPlayingPath = null;

async function playNow(htmlPath) {
  currentlyPlayingPath = htmlPath;
  localStorage.setItem('currentMixPath', htmlPath);
  currentQueueIndex = -1;
  const details = await fetchMixDetails(htmlPath);
  if (details.audioSrc) {
    play(details.audioSrc);
    displayTrackList(details.trackListHeading, details.trackListTable, details.downloadLinks);
    loadPeaks(details.peaks);
  }
  displayQueue();
}

function displayTrackList(heading, table, downloadLinks) {
  const trackListDiv = document.getElementById('trackList');
  let downloads = '';
  if (downloadLinks && downloadLinks.length > 0) {
    downloads = `<div class="downloads">
      <h2>Downloads</h2>
      ${downloadLinks.map(d => `<a class="download-btn" href="${d.href}" download>${d.label}</a>`).join('')}
    </div>`;
  }
  trackListDiv.innerHTML = heading + table + downloads;
}

let draggedIndex = null;

function displayQueue() {
  const queueDiv = document.getElementById('queue');
  const totalDuration = calculateTotalDuration();
  const durationText = totalDuration ? ` · ${totalDuration}` : '';
  const queueInfo = queue.length > 0 
    ? `<div class="queue-info">${currentQueueIndex >= 0 ? `Playing ${currentQueueIndex + 1} of ${queue.length}` : `${queue.length} mixes`}${durationText}</div>` 
    : '';
  const header = queue.length > 0 
    ? `<div class="queue-header">
        <button onclick="clearQueue()">Clear</button>
        <button onclick="shuffleQueue()">Shuffle</button>
        <button onclick="skipPrev()" title="Previous in queue">↑ Prev</button>
        <button onclick="skipNext()" title="Next in queue">↓ Next</button>
      </div>` 
    : '';
  queueDiv.innerHTML = queueInfo + header + queue.map((mix, i) => 
    `<div class="queue-item${i === currentQueueIndex ? ' current' : ''}" 
          draggable="true" 
          ondragstart="onDragStart(event, ${i})" 
          ondragover="onDragOver(event)" 
          ondrop="onDrop(event, ${i})"
          ondragend="onDragEnd()">
      <span class="drag-handle">☰</span>
      <span class="mix-name" onclick="playFromQueue(${i})">${mix.name}</span>
      ${i !== currentQueueIndex ? `<button class="remove-btn" onclick="removeFromQueue(${i})">✕</button>` : ''}
    </div>`
  ).join('');
}

function onDragStart(e, index) {
  draggedIndex = index;
  e.currentTarget.classList.add('dragging');
}

function onDragOver(e) {
  e.preventDefault();
}

function onDrop(e, dropIndex) {
  e.preventDefault();
  if (draggedIndex === null || draggedIndex === dropIndex) return;
  
  const draggedItem = queue.splice(draggedIndex, 1)[0];
  queue.splice(dropIndex, 0, draggedItem);
  
  // Update currentQueueIndex to follow the currently playing item
  if (currentQueueIndex === draggedIndex) {
    currentQueueIndex = dropIndex;
  } else if (draggedIndex < currentQueueIndex && dropIndex >= currentQueueIndex) {
    currentQueueIndex--;
  } else if (draggedIndex > currentQueueIndex && dropIndex <= currentQueueIndex) {
    currentQueueIndex++;
  }
  
  saveQueue();
  displayQueue();
}

function onDragEnd() {
  draggedIndex = null;
  document.querySelectorAll('.queue-item').forEach(el => el.classList.remove('dragging'));
}

function clearQueue() {
  queue = [];
  currentQueueIndex = -1;
  saveQueue();
  displayQueue();
}

function shuffleQueue() {
  const currentMix = currentQueueIndex >= 0 ? queue[currentQueueIndex] : null;
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  if (currentMix) {
    currentQueueIndex = queue.findIndex(m => m.htmlPath === currentMix.htmlPath);
  }
  saveQueue();
  displayQueue();
}

function calculateTotalDuration() {
  let totalMinutes = 0;
  let hasDuration = false;
  queue.forEach(mix => {
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
  if (currentQueueIndex >= 0 && currentQueueIndex < queue.length - 1) {
    playFromQueue(currentQueueIndex + 1);
  }
}

function skipPrev() {
  if (currentQueueIndex > 0) {
    playFromQueue(currentQueueIndex - 1);
  }
}

async function playFromQueue(index) {
  currentQueueIndex = index;
  saveQueue();
  const mix = queue[index];
  
  document.title = `▶ ${mix.name} - Player`;
  
  if (mix.isLocal) {
    currentlyPlayingPath = null;
    localStorage.removeItem('currentMixPath');
    play(mix.audioSrc);
    displayTrackList('', '', []);
    loadPeaks(null);
  } else {
    currentlyPlayingPath = mix.htmlPath;
    localStorage.setItem('currentMixPath', mix.htmlPath);
    const details = await fetchMixDetails(mix.htmlPath);
    if (details.audioSrc) {
      play(details.audioSrc);
      displayTrackList(details.trackListHeading, details.trackListTable, details.downloadLinks);
      loadPeaks(details.peaks);
    }
  }
  displayQueue();
}

function removeFromQueue(index) {
  if (index !== currentQueueIndex) {
    queue.splice(index, 1);
    if (index < currentQueueIndex) currentQueueIndex--;
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
document.getElementById('fileInput').addEventListener('change', function(e) {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    const audioSrc = URL.createObjectURL(file);
    queue.push({
      name: file.name.replace(/\.[^/.]+$/, ''),
      audioSrc: audioSrc,
      isLocal: true
    });
  });
  saveQueue();
  displayQueue();
  e.target.value = '';
});

// Restore last playing mix on page load
(async function restorePlayer() {
  const savedPath = localStorage.getItem('currentMixPath');
  if (savedPath) {
    currentlyPlayingPath = savedPath;
    const details = await fetchMixDetails(savedPath);
    if (details.audioSrc) {
      load(details.audioSrc);
      const savedTime = parseFloat(localStorage.getItem('playerTime') || '0');
      aud.currentTime = savedTime;
      displayTrackList(details.trackListHeading, details.trackListTable, details.downloadLinks);
      loadPeaks(details.peaks);
    }
  }
})();