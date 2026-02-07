let aud = document.getElementById("audioPlayer");
let autoAdvance = document.getElementById("autoAdvance");

if (autoAdvance) {
  autoAdvance.disabled = false;

  aud.addEventListener("ended", async function () {
    if (autoAdvance.checked) {
      const nextPath = nextMix();
      if (nextPath) {
        currentQueueIndex++;
        const details = await fetchMixDetails(nextPath);
        if (details.audioSrc) {
          play(details.audioSrc);
          displayTrackList(details.trackListHeading, details.trackListTable);
        }
        displayQueue();
      }
    }
  });
}

function load(url) {
  aud.src = url;
  aud.currentTime = 0;
}

function play(url) {
  load(url);
  aud.play();
}

function nextMix() {
  if (currentQueueIndex >= 0 && currentQueueIndex < queue.length - 1) {
    return queue[currentQueueIndex + 1].htmlPath;
  }
  return null;
}

let currentMixes = [];
let currentDJ = '';
let queue = [];
let currentQueueIndex = -1;

async function loadDJ(djPath) {
  currentDJ = djPath;
  currentMixes = await fetchDJMixes(djPath);
  updateDJButtons();
  displayGroupFilters(currentMixes);
  displayMixList(currentMixes);
}

function updateDJButtons() {
  document.querySelectorAll('#djButtons button').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.replace('-', '') === currentDJ);
  });
}

let currentFilter = '';

function displayGroupFilters(mixes) {
  currentFilter = '';
  const filterDiv = document.getElementById('groupFilters');
  if (currentDJ !== 'trip') {
    filterDiv.innerHTML = '';
    return;
  }
  const groups = detectGroups(mixes);
  filterDiv.innerHTML = `<button class="active" onclick="applyFilter('')">All</button> ` +
    groups.map(g => `<button onclick="applyFilter('${g}')">${g}</button>`).join(' ');
}

function updateFilterButtons() {
  document.querySelectorAll('#groupFilters button').forEach(btn => {
    btn.classList.toggle('active', btn.textContent === (currentFilter || 'All'));
  });
}

function applyFilter(group) {
  currentFilter = group;
  updateFilterButtons();
  const filtered = filterMixes(currentMixes, group);
  displayMixList(filtered);
}

function displayMixList(mixes) {
  const mixList = document.getElementById('mixList');
  mixList.innerHTML = mixes.map((mix, i) => 
    `<div class="mix-item">
      <button class="icon-btn" onclick="addToQueue('${mix.htmlPath}')" title="Add to queue">+</button>
      <button class="icon-btn" onclick="playNow('${mix.htmlPath}')" title="Play now">▶</button>
      <span class="mix-name">${mix.name}</span>
    </div>`
  ).join('');
}

function addToQueue(htmlPath) {
  const mix = currentMixes.find(m => m.htmlPath === htmlPath);
  if (mix && !queue.some(q => q.htmlPath === htmlPath)) {
    queue.push(mix);
    displayQueue();
  }
}

let currentlyPlayingPath = null;

async function playNow(htmlPath) {
  currentlyPlayingPath = htmlPath;
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
  queueDiv.innerHTML = queue.map((mix, i) => 
    `<div class="queue-item${i === currentQueueIndex ? ' current' : ''}">
      <span class="mix-name" onclick="playFromQueue(${i})">${mix.name}</span>
      ${i !== currentQueueIndex ? `<button class="remove-btn" onclick="removeFromQueue(${i})">✕</button>` : ''}
    </div>`
  ).join('');
}

async function playFromQueue(index) {
  currentQueueIndex = index;
  const mix = queue[index];
  const details = await fetchMixDetails(mix.htmlPath);
  if (details.audioSrc) {
    play(details.audioSrc);
    displayTrackList(details.trackListHeading, details.trackListTable);
  }
  displayQueue();
}

function removeFromQueue(index) {
  if (index !== currentQueueIndex) {
    queue.splice(index, 1);
    if (index < currentQueueIndex) currentQueueIndex--;
    displayQueue();
  }
}