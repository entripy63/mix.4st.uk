// settings.js - Settings and Help modal UI
// Dependencies: core.js (storage, state), ping.js (beaconNick, generateBeaconNick, setBeaconNick),
//               visualiser.js (updateVisModeButtons, startVisualiser, stopVisualiser),
//               tempo.js (startTempo, stopTempo), player.js (timedFades, volumeSlider, updateMuteBtn),
//               tips.js (initTips)

// What's New version — bump this when adding new release notes
const WHATS_NEW_VERSION = '2026-05';

function dismissNewDot() {
   storage.set('whatsNewSeen', WHATS_NEW_VERSION);
   const dot = document.getElementById('newDot');
   if (dot) dot.hidden = true;
}

// ========== SETTINGS MODAL ==========

function showSettings() {
   document.getElementById('settingsModal').style.display = 'flex';
   document.getElementById('showTipsCheckbox').checked = storage.getBool('showTips', true);
   initTips();
   const setting = storage.get('afterPlayNow', 'stop');
   const radio = document.querySelector(`input[name="afterPlayNow"][value="${setting}"]`);
   if (radio) radio.checked = true;
   document.getElementById('hideBrowserColumnCheckbox').checked = storage.getBool('hideBrowserColumn');
   document.getElementById('hideQueueColumnCheckbox').checked = storage.getBool('hideQueueColumn');
   document.getElementById('showHiddenMixesCheckbox').checked = state.showHiddenMixes;
   document.getElementById('visualiserEnabledCheckbox').checked = storage.getBool('visualiserEnabled', true);
   document.getElementById('bpmEnabledCheckbox').checked = storage.getBool('bpmEnabled', true);
   document.getElementById('nicknameInput').value = beaconNick();
   // Timed Fades settings
   const tfEnabled = storage.getBool('timedFadesEnabled');
   document.getElementById('timedFadesCheckbox').checked = tfEnabled;
   document.getElementById('timedFadesOptions').style.display = tfEnabled ? '' : 'none';
   const tfType = storage.get('timedFadesType', 'fadeout');
   document.getElementById('tfType').value = tfType;
   loadTimedFadeTypeUI(tfType);
   timedFades.updateStatus();
}

function hideSettings() {
   document.getElementById('settingsModal').style.display = 'none';
}

function updateSetting(key, value) {
   storage.set(key, value);
}

function updateShowTips(checked) {
   storage.set('showTips', checked);
   initTips();
}

function updateBpmEnabled(enabled) {
   storage.set('bpmEnabled', enabled);
   updateVisModeButtons();
   if (!enabled) {
     stopTempo();
   } else if (audioCtx && !aud.paused) {
     startTempo();
   }
}

function updateVisualiserEnabled(enabled) {
   storage.set('visualiserEnabled', enabled);
   updateVisModeButtons();
   if (!enabled) {
     stopVisualiser();
   } else if (audioCtx && !aud.paused) {
     startVisualiser();
   }
}

function updateTimedFadesEnabled(checked) {
   storage.set('timedFadesEnabled', checked);
   document.getElementById('timedFadesOptions').style.display = checked ? '' : 'none';
   if (checked) {
     // Schedule any active timers
     timedFades.schedule('fadeout');
     timedFades.schedule('fadein');
   } else {
     timedFades.cancel();
   }
}

function loadTimedFadeTypeUI(type) {
   document.getElementById('tfActive').checked = storage.getBool(`tf.${type}.active`);
   document.getElementById('tfDuration').value = storage.get(`tf.${type}.duration`, '3');
   document.getElementById('tfMode').value = storage.get(`tf.${type}.mode`, 'at');
   document.getElementById('tfTime').value = storage.get(`tf.${type}.time`, type === 'fadeout' ? '23:00' : '07:00');
   document.getElementById('tfRepeat').value = storage.get(`tf.${type}.repeat`, 'none');
   document.getElementById('tfPlayStream').checked = storage.getBool(`tf.${type}.playStream`);
   // Hide repeat for "after" mode
   const mode = storage.get(`tf.${type}.mode`, 'at');
   document.getElementById('tfRepeatRow').style.display = mode === 'at' ? '' : 'none';
   // Show stream option only for fadein
   document.getElementById('tfStreamRow').style.display = type === 'fadein' ? '' : 'none';
}

function switchTimedFadeType(type) {
   storage.set('timedFadesType', type);
   loadTimedFadeTypeUI(type);
   timedFades.updateStatus();
}

function updateTimedFadeSetting() {
   const type = document.getElementById('tfType').value;
   const active = document.getElementById('tfActive').checked;
   const duration = document.getElementById('tfDuration').value;
   const mode = document.getElementById('tfMode').value;
   const time = document.getElementById('tfTime').value;
   const repeat = document.getElementById('tfRepeat').value;
   const playStream = document.getElementById('tfPlayStream').checked;
   storage.set(`tf.${type}.active`, active);
   storage.set(`tf.${type}.duration`, duration);
   storage.set(`tf.${type}.mode`, mode);
   storage.set(`tf.${type}.time`, time);
   storage.set(`tf.${type}.repeat`, repeat);
   storage.set(`tf.${type}.playStream`, playStream);
   // Hide repeat for "after" mode
   document.getElementById('tfRepeatRow').style.display = mode === 'at' ? '' : 'none';
   if (storage.getBool('timedFadesEnabled')) {
     timedFades.schedule(type);
   }
   timedFades.updateStatus();
}

function updateHideColumn(which, hidden) {
   const cls = which === 'browser' ? 'hide-browser-col' : 'hide-queue-col';
   storage.set(which === 'browser' ? 'hideBrowserColumn' : 'hideQueueColumn', hidden);
   document.body.classList.toggle(cls, hidden);
}

function updateShowHiddenMixes(checked) {
   setShowHiddenMixes(checked);
}

document.getElementById('settingsModal')?.addEventListener('click', function(e) {
  if (e.target === this) hideSettings();
});

// ========== HELP MODAL ==========

function showHelp() {
  dismissNewDot();
  document.getElementById('helpModal').style.display = 'flex';
}

function hideHelp() {
  document.getElementById('helpModal').style.display = 'none';
}

document.getElementById('helpModal')?.addEventListener('click', function(e) {
  if (e.target === this) hideHelp();
});

// ========== INIT ==========

// Show "What's New" dot if user hasn't seen the current version
if (storage.get('whatsNewSeen') !== WHATS_NEW_VERSION) {
  const dot = document.getElementById('newDot');
  if (dot) dot.hidden = false;
}

// Apply column-hiding classes from saved settings
if (storage.getBool('hideBrowserColumn')) document.body.classList.add('hide-browser-col');
if (storage.getBool('hideQueueColumn')) document.body.classList.add('hide-queue-col');
