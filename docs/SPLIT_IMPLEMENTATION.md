# Player.js Split Implementation Guide

## Quick Answer to Your Questions

### 1. **Can we split without a bundler?**
✅ **YES** - No bundler needed. Simple script loading order works perfectly.

### 2. **Will the load order work?**
✅ **YES** - The dependency flow is linear with no circular dependencies:
```
core.js → queue.js → player.js → browser.js
(utils)   (queues)  (playback)  (browser/live/search)
```

### 3. **Are the inter-module interactions minimal?**
✅ **YES** - Only 3 key cross-module calls:
- `queue.playFromQueue()` → calls `player.playMix()`
- `browser.playSearchResult()` → calls `player.playNow()`
- `browser.playLiveStream()` → calls `player.playLive()`

---

## Implementation Checklist

### Phase 1: Prepare
- [ ] Back up current player.js
- [ ] Create SPLIT_PLAN.md (reference guide) ✅ Done
- [ ] Create this guide ✅ Done

### Phase 2: Extract Files
- [ ] Create `core.js` (lines 1-103)
- [ ] Create `queue.js` (lines 464-926, reordered)
- [ ] Create new `player.js` (lines 104-631, extracted)
- [ ] Create `browser.js` (lines 496-1752, extracted)
- [ ] Keep original `player.js` as backup (rename to `player.js.bak`)

### Phase 3: Update HTML
- [ ] Update `player.html` script tags with new load order
- [ ] Test page loads without errors

### Phase 4: Test All Features
- [ ] Queue: Add mixes, play from queue, skip, shuffle
- [ ] Player: Play/pause, waveform, seek, volume
- [ ] Browser: Switch tabs (DJ/All/Favorites/Live/Search)
- [ ] Live: Add stream, delete stream, play live
- [ ] Search: Search for mixes, play from search
- [ ] Settings: Open/close modals, change settings
- [ ] Local files: Add local files to queue
- [ ] Restore: Refresh page, check queue and playback restored

---

## What Goes Where - Summary Table

| Code Section | Original Lines | Goes To | Size |
|---|---|---|---|
| Utilities & State | 1-103 | `core.js` | ~100 lines |
| Waveform & Canvas | 105-225 | `player.js` | ~120 lines |
| Audio Controls | 227-441 | `player.js` | ~180 lines |
| Queue Management | 464-926 | `queue.js` | ~280 lines |
| DJ Browser | 496-768 | `browser.js` | ~270 lines |
| Search | 928-1504 | `browser.js` | ~450 lines |
| Live Streams | 967-1294 | `browser.js` | ~280 lines |
| Browser Modes | 1296-1370 | `browser.js` | ~70 lines |
| Modals & Settings | 1541-1586 | `browser.js` | ~50 lines |
| Page Init & Restore | 1689-1755 | `browser.js` | ~60 lines |
| Event Handlers | Throughout | `queue.js`, `player.js`, `browser.js` | Distributed |

---

## File-by-File Creation Guide

### core.js - The Foundation
**Size:** ~100 lines  
**Contains:** Utilities, global state, DOM refs  
**Dependencies:** None  
**Used by:** All other modules  

```javascript
// core.js
function escapeHtml(str) { ... }
const storage = { ... }
const aud = ...
const state = { ... }
const mixFlags = { ... }
function updateFavouritesButton() { ... }
```

**Create by:** Extracting lines 1-103 from original player.js

---

### queue.js - Queue Management
**Size:** ~300 lines  
**Contains:** Queue display, drag-drop, queue operations  
**Dependencies:** core.js  
**Calls:** `player.playMix()` (in playFromQueue)  

```javascript
// queue.js
// Import from core.js (already loaded)
// All queue-related functions
function displayQueue() { ... }
async function playFromQueue(index) { ... }
// etc.
```

**DOM elements needed:**
- `#queue` - queue display container

**Create by:** Extracting lines 464-926 from original, reorganizing

---

### player.js - Playback Controls
**Size:** ~350 lines  
**Contains:** Waveform rendering, audio controls, playback  
**Dependencies:** core.js, mixes.js  
**Calls:** `queue.displayQueue()`  
**Called by:** `queue.playFromQueue()`, `browser.playNow()`  

```javascript
// player.js
// Uses: core.js, mixes.js (already loaded)
// Waveform functions
function drawWaveform(peaks, progress) { ... }

// Audio control functions
function updateTimeDisplay() { ... }

// Core playback
async function playMix(mix) { ... }
async function playNow(mixId) { ... }
```

**DOM elements needed:**
- `#audioPlayer`, `#waveform`, `#waveformResizeHandle`
- `#playPauseBtn`, `#muteBtn`, `#volumeSlider`, `#timeDisplay`
- `#nowPlaying`, `#coverArt`, `#trackList`

**Create by:** Extracting lines 104-631 from original

---

### browser.js - The Complex One
**Size:** ~1000 lines  
**Contains:** Mix browser, live streams, search, modals, modes  
**Dependencies:** core.js, mixes.js, queue.js, player.js  
**Calls:** `player.playNow()`, `queue.addToQueue()`, `queue.displayQueue()`  

```javascript
// browser.js
// Uses: core.js, mixes.js, queue.js, player.js (all already loaded)

// Mix browser functions
function displayMixList(mixes) { ... }
async function loadDJ(djPath) { ... }

// Live stream functions
const STREAM_PROXY = '...'
const BUILTIN_STREAM_DEFS = [...]
async function initLiveStreams() { ... }
function displayLiveStreams() { ... }

// Browser modes coordinator
const browserModes = { ... }

// Search functions
const searchIndex = { ... }
function displaySearchResults(results) { ... }

// Modals
function showSettings() { ... }
function showHelp() { ... }

// Page initialization
(async function restorePlayer() { ... })()
```

**DOM elements needed:**
- `#mixBrowser`, `#browserModeSelector`, `.mode-btn` buttons
- `#mixList` (main content area)
- `#djDropdown`, `#searchInput`
- `#settingsModal`, `#helpModal`
- `#addStreamFields`, `#newStreamName`, `#newStreamM3U`, `#newStreamGenre`

**Create by:** Extracting remaining code from original

---

## HTML Updates Required

### Current player.html
```html
<script src="mixes.js"></script>
<script src="player.js"></script>
```

### New player.html
```html
<script src="core.js"></script>       <!-- Utilities & state -->
<script src="mixes.js"></script>      <!-- Mix data loading -->
<script src="queue.js"></script>      <!-- Queue management -->
<script src="player.js"></script>     <!-- Playback controls -->
<script src="browser.js"></script>    <!-- Browser & live streams -->
```

---

## Testing Strategy

### Unit Tests (Manual)
Each file should work independently:

**core.js**
- `storage` object works (get/set)
- `state` object initializes
- `escapeHtml()` escapes properly

**queue.js**
- Queue displays correctly
- Drag-drop works
- Skip next/prev works
- Loop toggle works

**player.js**
- Audio plays/pauses
- Waveform renders
- Time display updates
- Volume/mute work

**browser.js**
- DJ selection loads mixes
- Mix list displays
- Live streams display
- Search works
- Mode switching works

### Integration Tests
- Add mix to queue from browser, play from queue
- Play mix directly from browser (playNow)
- Add live stream, play live stream
- Search for mix, add to queue
- All the above after page refresh (restore)

---

## Potential Issues & Solutions

### Issue 1: Order of Initialization
**Problem:** Some code in `restorePlayer()` runs immediately on page load.  
**Solution:** Put `restorePlayer()` in browser.js, it runs last when all modules are ready.

### Issue 2: Cross-Module Function Calls
**Problem:** `queue.js` calls `player.playMix()` before `player.js` loads.  
**Solution:** The `playFromQueue()` function is async. By the time it's called, `player.js` is already loaded.

### Issue 3: Global State in Multiple Files
**Problem:** Both `queue.js` and `browser.js` modify `state.queue`.  
**Solution:** `state` is in `core.js`, shared by all. This is fine - it's shared global state.

### Issue 4: Live Streams Globals
**Problem:** `liveStreams` and `liveStreamsInitialized` are globals in browser.js.  
**Solution:** Keep them in browser.js. They're only used by browser functions.

---

## Success Criteria

After split, the application should:
1. ✅ Load all 5 scripts without errors
2. ✅ All features work exactly as before
3. ✅ No console errors
4. ✅ Each file < 400 lines (easier to understand)
5. ✅ Dependency order is clear (core → queue → player → browser)
6. ✅ Can modify one file without touching others
7. ✅ Page restore works on refresh

---

## Next Steps

1. **Backup:** `cp player.js player.js.bak`
2. **Extract:** Follow file-by-file extraction above
3. **Update HTML:** Change script tags
4. **Test:** Run through all features manually
5. **Commit:** `git add core.js queue.js player.js browser.js && git commit -m "Split player.js into modules"`
6. **Future:** Can further split browser.js into browser-mixes.js + browser-live.js if needed

---

## Notes for Future Refactoring

After this split works, consider:
- [ ] Further split browser.js into browser-mixes.js + browser-live.js
- [ ] Move settings/modals to separate file
- [ ] Move keyboard shortcuts to separate file
- [ ] Create utils.js for audio support functions
- [ ] Consider ES6 modules if bundler is added later

But **NOT NOW** - keep it simple with this split first.
