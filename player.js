let aud = document.getElementById("audioPlayer");

// Restore volume from localStorage
if (localStorage.getItem('playerVolume') !== null) {
  aud.volume = parseFloat(localStorage.getItem('playerVolume'));
}

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
  localStorage.setItem('queue', JSON.stringify(queue));
  localStorage.setItem('currentQueueIndex', currentQueueIndex.toString());
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
      <span class="mix-name">${mix.name}</span>
    </div>`
  ).join('');
}

function addAllToQueue() {
  displayedMixes.forEach(mix => {
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
    displayTrackList(details.trackListHeading, details.trackListTable);
  }
  displayQueue();
}

function displayTrackList(heading, table) {
  const trackListDiv = document.getElementById('trackList');
  trackListDiv.innerHTML = heading + table;
}

function displayQueue() {
  const queueDiv = document.getElementById('queue');
  const header = queue.length > 0 ? `<div class="queue-header"><button onclick="clearQueue()">Clear Queue</button></div>` : '';
  queueDiv.innerHTML = header + queue.map((mix, i) => 
    `<div class="queue-item${i === currentQueueIndex ? ' current' : ''}">
      <span class="mix-name" onclick="playFromQueue(${i})">${mix.name}</span>
      ${i !== currentQueueIndex ? `<button class="remove-btn" onclick="removeFromQueue(${i})">✕</button>` : ''}
    </div>`
  ).join('');
}

function clearQueue() {
  queue = [];
  currentQueueIndex = -1;
  saveQueue();
  displayQueue();
}

async function playFromQueue(index) {
  currentQueueIndex = index;
  saveQueue();
  const mix = queue[index];
  
  if (mix.isLocal) {
    currentlyPlayingPath = null;
    localStorage.removeItem('currentMixPath');
    play(mix.audioSrc);
    displayTrackList('', '');
  } else {
    currentlyPlayingPath = mix.htmlPath;
    localStorage.setItem('currentMixPath', mix.htmlPath);
    const details = await fetchMixDetails(mix.htmlPath);
    if (details.audioSrc) {
      play(details.audioSrc);
      displayTrackList(details.trackListHeading, details.trackListTable);
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
      displayTrackList(details.trackListHeading, details.trackListTable);
    }
  }
})();