// tips.js - Data-driven tip popover system
// Add data-tip="tipId" to any element to auto-append a 💡 icon with a popover.
// Tips registry maps IDs to HTML content strings.

const TIPS = {
  timedFades: `
    <p>Use Timed Fades as a <strong>sleep timer</strong> or <strong>alarm clock</strong>.</p>
    <p><strong>Fadeout then Pause</strong> gradually lowers the volume and pauses playback — perfect for falling asleep to music without it playing all night.</p>
    <p><strong>Play then Fade In</strong> starts playback at zero volume and slowly raises it — a gentle way to wake up. Enable "Play First User Stream" to auto-start a different stream to that which you fell sleep to.</p>
    <p>Use <strong>At</strong> to trigger at a clock time (e.g. 23:00), or <strong>After</strong> to trigger after a delay from now. Set <strong>Repeat</strong> to run it every day or on weekdays only.</p>
  `,
  afterPlayNow: `
    <p>Controls what happens after a mix you played directly (via "Play Now") finishes.</p>
    <p><strong>Stop</strong> — Playback stops after the mix ends.</p>
    <p><strong>Loop</strong> — The same mix repeats.</p>
    <p><strong>Continue with Queue</strong> — Playback moves to the next item in your Mix Queue, so you can audition a mix and still have your queue lined up afterwards.</p>
  `,
  hideColumns: `
    <p>On mobile or narrow windows the player switches to a single-column layout. These options let you hide the Browser and/or Queue/Streams so that only the player controls and play history are visible.</p>
    <p>Useful when you often only play a few streams and just want a clean listening view.</p>
  `,
  nickname: `
    <p>Your nickname allows us to estimate how many users we have. It's randomly generated but you can set your own. Hit ⟳ to generate a new random one.</p>
  `,
  visualiser: `
    <p>Draws a real-time audio visualisation above the player controls. Choose between spectrum bars, waveform, spectral flux, and autocorrelation views using the mode buttons.</p>
    <p>Disable to save CPU on low-power devices.</p>
  `,
  showHiddenMixes: `
    <p>Mixes can be hidden using the Hide button beneath the play history. Hidden mixes completely vanish from the display.</p>
    <p>Enable this setting to reveal hidden mixes so you can see and unhide them if you change your mind.</p>
  `,
  bpm: `
    <p>Analyses the audio in real time to estimate beats per minute. The BPM is shown next to the time display when detected.</p>
    <p>Works best with rhythmic music. Disable to save CPU if you don't need it.</p>
  `,
  browserModes: `
    <p>The Browser has five modes for finding music:</p>
    <p><strong>👤 DJ</strong> — Browse mixes from featured DJs using the quick-select buttons.</p>
    <p><strong>📋 All</strong> — Browse all DJs from a dropdown, including guest contributors.</p>
    <p><strong>📡 Live</strong> — Browse and add live radio streams from curated presets.</p>
    <p><strong>🔍 Search</strong> — Search across all mixes and streams by name, genre, or artist.</p>
    <p><strong>❤️ Favourites</strong> — Quick access to mixes you've marked as favourites.</p>
    <p>From the Browser you can <strong>▶ Play Now</strong> any mix or stream, <strong>+</strong> add DJ mixes to the Mix Queue, or add live streams to your User Streams collection.</p>
  `,
  mixQueue: `
    <p>The Mix Queue is your playlist. Add mixes from the Browser using the <strong>+</strong> button, or drag to reorder.</p>
    <p><strong>▲ ▼</strong> skip to the previous or next mix. <strong>⇄</strong> shuffles the queue. <strong>⟳</strong> toggles looping.</p>
    <p><strong>↥ ↧</strong> load and save your queue as a file, so you can restore it later or share it.</p>
    <p>You can also add local audio files from your device using the button at the bottom. For technical reasons these cannot autoplay so will not be saved.</p>
  `,
  userStreams: `
    <p>User Streams is your personal collection of live radio streams.</p>
    <p>Browse curated streams via the <strong>📡 Live</strong> browser mode, where you can add presets or individual streams to your collection. You can also paste a playlist URL (M3U or PLS) or direct media URL into the input at the bottom to add any stream.</p>
    <p><strong>⟳</strong> reloads all streams to check availability. <strong>↥ ↧</strong> load and save your collection as a file.</p>
    <p>Click <strong>ⓘ</strong> on a stream to edit its name, genre, and website. Drag streams to reorder them.</p>
  `,
  playHistory: `
    <p>Play History shows your recently played mixes and streams. Click any entry to play it again.</p>
    <p>Use the <strong>Recent</strong>, <strong>Tracks</strong>, and <strong>Art</strong> tabs to switch between play history, track listings, and cover art views when available.</p>
  `,
  visualiserModes: `
    <p>Choose how the audio is visualised:</p>
    <p><strong>▮▮▮ Spectrum</strong> — Frequency spectrum bars showing bass to treble.</p>
    <p><strong>∿ Waveform</strong> — Oscilloscope-style waveform of the audio signal.</p>
    <p><strong>⚡ Spectral Flux</strong> and <strong>∞ Autocorrelation</strong> — BPM analysis views (requires BPM Detection enabled in Settings).</p>
    <p><strong>◐ Full Range</strong> — Toggles between zoomed half range and full range Autocorrelation views.</p>
  `
};

// Shared popover element — created once, repositioned per tip
let tipPopover = null;
let activeTipBtn = null;

function ensureTipPopover() {
  if (tipPopover) return;
  tipPopover = document.createElement('div');
  tipPopover.className = 'tip-popover';
  tipPopover.style.display = 'none';
  tipPopover.innerHTML = '<div class="tip-popover-content"></div>';
  document.body.appendChild(tipPopover);
}

function showTip(tipId, btn) {
  const content = TIPS[tipId];
  if (!content) return;

  ensureTipPopover();

  // If same tip is open, close it
  if (activeTipBtn === btn && tipPopover.style.display !== 'none') {
    hideTip();
    return;
  }

  const inner = tipPopover.querySelector('.tip-popover-content');
  inner.innerHTML = content;
  tipPopover.style.display = '';
  if (activeTipBtn) activeTipBtn.title = 'Tip';
  activeTipBtn = btn;
  btn.title = '';

  // Position near the button
  requestAnimationFrame(() => {
    const btnRect = btn.getBoundingClientRect();
    const popRect = tipPopover.getBoundingClientRect();

    // Try to position below the button
    let top = btnRect.bottom + 6;
    let left = btnRect.left + btnRect.width / 2 - popRect.width / 2;

    // If it would go below viewport, position above
    if (top + popRect.height > window.innerHeight - 10) {
      top = btnRect.top - popRect.height - 6;
    }

    // Clamp to viewport
    left = Math.max(10, Math.min(left, window.innerWidth - popRect.width - 10));
    top = Math.max(10, top);

    tipPopover.style.left = left + 'px';
    tipPopover.style.top = top + 'px';
  });
}

function hideTip() {
  if (tipPopover) {
    tipPopover.style.display = 'none';
  }
  if (activeTipBtn) activeTipBtn.title = 'Tip';
  activeTipBtn = null;
}

// Close on click outside
document.addEventListener('click', (e) => {
  if (!tipPopover || tipPopover.style.display === 'none') return;
  // Don't close if clicking inside the popover or on a tip button
  if (tipPopover.contains(e.target) || e.target.closest('.tip-btn')) return;
  hideTip();
});

// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && tipPopover && tipPopover.style.display !== 'none') {
    hideTip();
  }
});

// Auto-inject tip buttons for elements with data-tip (not already a .tip-btn).
// The icon is appended to the first label found inside the element
// (so it sits next to the label text, not after sub-options).
// If no label is found, it appends to the element itself.
//
// Manually placed .tip-btn elements in HTML should have data-tip="tipId".
// They are shown/hidden (not removed) based on the showTips setting.
//
// Respects the showTips setting — hides/removes tip buttons when disabled.
function initTips() {
  const enabled = storage.getBool('showTips', true);

  if (!enabled) {
    // Hide manually placed tip buttons, remove auto-injected ones
    document.querySelectorAll('.tip-btn[data-injected]').forEach(btn => btn.remove());
    document.querySelectorAll('.tip-btn[data-tip]').forEach(btn => { btn.style.display = 'none'; });
    hideTip();
    return;
  }

  // Show manually placed tip buttons
  document.querySelectorAll('.tip-btn[data-tip]').forEach(btn => { btn.style.display = ''; });

  // Auto-inject for container elements with data-tip (not .tip-btn themselves)
  document.querySelectorAll('[data-tip]:not(.tip-btn)').forEach(el => {
    // Don't inject twice
    if (el.querySelector('.tip-btn')) return;

    const tipId = el.getAttribute('data-tip');
    if (!TIPS[tipId]) return;

    const btn = document.createElement('button');
    btn.className = 'tip-btn';
    btn.type = 'button';
    btn.title = 'Tip';
    btn.textContent = '💡';
    btn.setAttribute('data-injected', '');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showTip(tipId, btn);
    });

    // Find the best target: first .setting-label, first .checkbox-label, or first label
    const target = el.querySelector('.setting-label, .checkbox-label') || el.querySelector('label') || el;
    target.appendChild(btn);
  });
}

initTips();
