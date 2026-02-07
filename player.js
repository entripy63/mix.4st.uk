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
  mixList.innerHTML = mixes.map(mix => 
    `<div class="mix-item">${mix.name}</div>`
  ).join('');
}