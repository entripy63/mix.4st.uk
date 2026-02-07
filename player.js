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

async function loadDJ(djPath) {
  currentMixes = await fetchDJMixes(djPath);
  displayMixList(currentMixes);
}

function displayMixList(mixes) {
  const mixList = document.getElementById('mixList');
  mixList.innerHTML = mixes.map(mix => 
    `<div class="mix-item">${mix.name}</div>`
  ).join('');
}