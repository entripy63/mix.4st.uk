// settings.js - Settings and Help modal UI
// Dependencies: core.js (storage, state), ping.js (beaconNick, generateBeaconNick, setBeaconNick),
//               visualiser.js (updateVisModeButtons, startVisualiser, stopVisualiser),
//               tempo.js (startTempo, stopTempo), player.js (timedFades, volumeSlider, updateMuteBtn),
//               tips.js (initTips)

// What's New version — bump this when adding new release notes
const WHATS_NEW_VERSION = '2026-05-15';

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
   document.getElementById('hideBrowserColumnCheckbox').checked = storage.getBool('hideBrowserColumn');
   document.getElementById('hideQueueColumnCheckbox').checked = storage.getBool('hideQueueColumn');
   document.getElementById('showHiddenMixesCheckbox').checked = state.showHiddenMixes;
   document.getElementById('visualiserEnabledCheckbox').checked = storage.getBool('visualiserEnabled', true);
   document.getElementById('bpmEnabledCheckbox').checked = storage.getBool('bpmEnabled', true);
   document.getElementById('meterEnabledCheckbox').checked = storage.getBool('meterEnabled');
   document.getElementById('nicknameInput').value = beaconNick();
}

function hideSettings() {
   document.getElementById('settingsModal').style.display = 'none';
}

// ========== TIMED FADES MODAL ==========

function showTimedFadesModal() {
   const modal = document.getElementById('timedFadesModal');
   modal.style.display = 'flex';
   const enabled = storage.getBool('timedFadesEnabled');
   document.getElementById('tfMasterCheckbox').checked = enabled;
   // Populate both columns from storage
   for (const type of ['fadeout', 'fadein']) {
     const prefix = type === 'fadeout' ? 'tfFadeout' : 'tfFadein';
     document.getElementById(`${prefix}Active`).checked = storage.getBool(`tf.${type}.active`);
     document.getElementById(`${prefix}Duration`).value = storage.get(`tf.${type}.duration`, '3');
     document.getElementById(`${prefix}Mode`).value = storage.get(`tf.${type}.mode`, 'at');
     document.getElementById(`${prefix}Time`).value = storage.get(`tf.${type}.time`, type === 'fadeout' ? '23:00' : '07:00');
     document.getElementById(`${prefix}Repeat`).value = storage.get(`tf.${type}.repeat`, 'none');
     // Hide repeat for "after" mode
     const mode = storage.get(`tf.${type}.mode`, 'at');
     document.getElementById(`${prefix}RepeatRow`).style.display = mode === 'at' ? '' : 'none';
   }
   // Fadein-only options
   document.getElementById('tfFadeinPlayStream').checked = storage.getBool('tf.fadein.playStream');
   updateTFStatuses();
}

function hideTimedFadesModal() {
   document.getElementById('timedFadesModal').style.display = 'none';
}

function updateTFField(type) {
   const prefix = type === 'fadeout' ? 'tfFadeout' : 'tfFadein';
   const active = document.getElementById(`${prefix}Active`).checked;
   const duration = document.getElementById(`${prefix}Duration`).value;
   const mode = document.getElementById(`${prefix}Mode`).value;
   const time = document.getElementById(`${prefix}Time`).value;
   const repeat = document.getElementById(`${prefix}Repeat`).value;
   storage.set(`tf.${type}.active`, active);
   storage.set(`tf.${type}.duration`, duration);
   storage.set(`tf.${type}.mode`, mode);
   storage.set(`tf.${type}.time`, time);
   storage.set(`tf.${type}.repeat`, repeat);
   if (type === 'fadein') {
     const playStream = document.getElementById('tfFadeinPlayStream').checked;
     storage.set('tf.fadein.playStream', playStream);
   }
   // Hide repeat for "after" mode
   document.getElementById(`${prefix}RepeatRow`).style.display = mode === 'at' ? '' : 'none';
   if (storage.getBool('timedFadesEnabled')) {
     timedFades.schedule(type);
   }
   updateTFStatuses();
   updateTimedFadesBtn();
}

function updateTFStatuses() {
   for (const type of ['fadeout', 'fadein']) {
     const prefix = type === 'fadeout' ? 'tfFadeout' : 'tfFadein';
     const el = document.getElementById(`${prefix}Status`);
     if (!el) continue;
     const dueTime = timedFades._dueTime[type];
     if (!dueTime) { el.textContent = ''; continue; }
     const remainMs = dueTime - Date.now();
     if (remainMs <= 0) { el.textContent = ''; continue; }
     const dueSecs = Math.round(remainMs / 1000);
     const h = Math.floor(dueSecs / 3600);
     const m = Math.floor((dueSecs % 3600) / 60);
     const s = dueSecs % 60;
     const verb = type === 'fadeout' ? 'pause' : 'play';
     const timeStr = h > 0
       ? `${h}h ${m}m ${s}s`
       : m > 0
         ? `${m}m ${s}s`
         : `${s}s`;
     el.textContent = `Will ${verb} in ${timeStr}`;
   }
   // Also update the old status element if visible (in settings modal)
   timedFades.updateStatus();
}

function updateTimedFadesBtn() {
   const btn = document.getElementById('timedFadesBtn');
   if (!btn) return;
   const enabled = storage.getBool('timedFadesEnabled');
   const fadeoutActive = enabled && storage.getBool('tf.fadeout.active');
   const fadeinActive = enabled && storage.getBool('tf.fadein.active');
   const hasScheduled = timedFades._dueTime.fadeout || timedFades._dueTime.fadein;

   btn.textContent = (enabled && hasScheduled) ? '⏰' : '🕐';

   // Build descriptive tooltip
   if (!enabled) {
     btn.title = 'Timed Fades (disabled)';
     return;
   }
   const parts = [];
   for (const type of ['fadeout', 'fadein']) {
     if (!timedFades._dueTime[type]) continue;
     const remainMs = timedFades._dueTime[type] - Date.now();
     if (remainMs <= 0) continue;
     const dueSecs = Math.round(remainMs / 1000);
     const h = Math.floor(dueSecs / 3600);
     const m = Math.floor((dueSecs % 3600) / 60);
     const s = dueSecs % 60;
     const verb = type === 'fadeout' ? 'Pause' : 'Play';
     const timeStr = h > 0
       ? `${h}h ${m}m ${s}s`
       : m > 0
         ? `${m}m ${s}s`
         : `${s}s`;
     parts.push(`${verb} in ${timeStr}`);
   }
   btn.title = parts.length > 0
     ? `Timed Fades: ${parts.join(', ')}`
     : 'Timed Fades (active, nothing scheduled)';
}

// Keep modal countdown text fresh while it is open.
function refreshTimedFadesModalStatuses() {
  const modal = document.getElementById('timedFadesModal');
  if (modal && modal.style.display !== 'none') {
    updateTFStatuses();
  }
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
   const masterCheck = document.getElementById('tfMasterCheckbox');
   if (masterCheck) masterCheck.checked = checked;
   if (checked) {
     timedFades.schedule('fadeout');
     timedFades.schedule('fadein');
   } else {
     timedFades.cancel();
   }
   updateTimedFadesBtn();
   updateTFStatuses();
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

document.getElementById('timedFadesModal')?.addEventListener('click', function(e) {
  if (e.target === this) hideTimedFadesModal();
});

// Keyboard shortcut to dismiss modals
document.addEventListener('keydown', function(e) {
  if (e.code === 'Escape') {
    hideSettings();
    hideHelp();
    hideTimedFadesModal();
  }
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

// Schedule any saved timed fades on load
if (storage.getBool('timedFadesEnabled')) {
  timedFades.schedule('fadeout');
  timedFades.schedule('fadein');
}
updateTimedFadesBtn();
setInterval(updateTimedFadesBtn, 15000);
setInterval(refreshTimedFadesModalStatuses, 15000);

// Refresh countdown text immediately before native tooltip display.
const timedFadesBtn = document.getElementById('timedFadesBtn');
timedFadesBtn?.addEventListener('mouseenter', updateTimedFadesBtn);
timedFadesBtn?.addEventListener('focus', updateTimedFadesBtn);
