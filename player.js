let aud = document.getElementById("audioPlayer");
let autoAdvance = document.getElementById("autoAdvance");

if (autoAdvance) {
  autoAdvance.disabled = false;

  aud.addEventListener("ended", function () {
    if (autoAdvance.checked) {
      play(nextMix());
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
  return urls[1];
}

let urls = [
  "trip/D201223.flac",
  "trip/D201223.mp3",
];

load(urls[0]);

let currentMixes = [];
let currentDJ = '';
let queue = [];
let currentQueueIndex = -1;

async function loadDJ(djPath) {
  currentDJ = djPath;
  currentMixes = await fetchDJMixes(djPath);
  displayGroupFilters(currentMixes);
  displayMixList(currentMixes);
}

function displayGroupFilters(mixes) {
  const filterDiv = document.getElementById('groupFilters');
  if (currentDJ !== 'trip') {
    filterDiv.innerHTML = '';
    return;
  }
  const groups = detectGroups(mixes);
  filterDiv.innerHTML = `<button onclick="applyFilter('')">All</button> ` +
    groups.map(g => `<button onclick="applyFilter('${g}')">${g}</button>`).join(' ');
}

function applyFilter(group) {
  const filtered = filterMixes(currentMixes, group);
  displayMixList(filtered);
}

function displayMixList(mixes) {
  const mixList = document.getElementById('mixList');
  mixList.innerHTML = mixes.map((mix, i) => 
    `<div class="mix-item">
      <span class="mix-name">${mix.name}</span>
      <button onclick="addToQueue('${mix.htmlPath}')">+Queue</button>
      <button onclick="playNow('${mix.htmlPath}')">Play</button>
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

function playNow(htmlPath) {
  // Step 6: will fetch audio src and play directly, bypassing queue
  console.log('Play:', htmlPath);
}

function displayQueue() {
  const queueDiv = document.getElementById('queue');
  queueDiv.innerHTML = queue.map((mix, i) => 
    `<div class="queue-item${i === currentQueueIndex ? ' current' : ''}">
      <span class="mix-name">${mix.name}</span>
      ${i !== currentQueueIndex ? `<button class="remove-btn" onclick="removeFromQueue(${i})">✕</button>` : ''}
    </div>`
  ).join('');
}

function removeFromQueue(index) {
  if (index !== currentQueueIndex) {
    queue.splice(index, 1);
    if (index < currentQueueIndex) currentQueueIndex--;
    displayQueue();
  }
}