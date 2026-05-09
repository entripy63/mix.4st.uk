// ping.js - Lightweight usage tracking
// Dependencies: core.js (storage)

const beaconAdjectives = ['Cosmic','Lazy','Velvet','Neon','Fuzzy','Mystic','Turbo','Groovy','Silent','Rusty','Wobbly','Sparkly','Crunchy','Breezy','Funky','Zesty','Bouncy','Cloudy','Dizzy','Crispy','Galactic','Lunar','Mellow','Nimble','Peppy','Quirky','Snappy','Toasty','Vivid','Wacky'];
const beaconNouns = ['Panda','Falcon','Owl','Fox','Otter','Penguin','Tiger','Hedgehog','Dolphin','Koala','Badger','Raven','Gecko','Moose','Sloth','Walrus','Parrot','Lynx','Bison','Quokka','Narwhal','Flamingo','Wombat','Capybara','Mantis','Toucan','Ferret','Platypus','Ibex','Newt'];

function generateBeaconNick() {
  const adj = beaconAdjectives[Math.floor(Math.random() * beaconAdjectives.length)];
  const noun = beaconNouns[Math.floor(Math.random() * beaconNouns.length)];
  return adj + noun;
}

function beaconNick() {
  let nick = storage.get('beaconNick');
  if (!nick) {
    nick = generateBeaconNick();
    storage.set('beaconNick', nick);
  }
  return nick;
}

function setBeaconNick(name) {
  storage.set('beaconNick', name);
}

function beacon(event, detail) {
  try {
    if (!window.location.hostname.endsWith('.4st.uk')) return;
    const body = JSON.stringify({ event, nick: beaconNick(), detail, ts: new Date().toISOString() });
    navigator.sendBeacon('/ping.php', new Blob([body], { type: 'text/plain' }));
  } catch { /* silent */ }
}

function beaconDaily(event, detail) {
  const today = new Date().toISOString().slice(0, 10);
  const key = 'beaconDay_' + event;
  if (storage.get(key) === today) return;
  storage.set(key, today);
  beacon(event, detail);
}

let beaconSearchTimer = null;

function beaconSearch(query) {
  if (beaconSearchTimer) clearTimeout(beaconSearchTimer);
  beaconSearchTimer = setTimeout(() => {
    beaconSearchTimer = null;
    beacon('search', query);
  }, 2000);
}
