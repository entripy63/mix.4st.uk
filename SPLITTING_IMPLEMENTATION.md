# JavaScript File Splitting - Implementation Complete

## What Was Done

Successfully split the large `live.js` file (850 lines) into three focused modules and extracted shared modal code.

## Files Created

### 1. **modals.js** (142 lines)
**Purpose:** Shared modal UI utilities used by both browser and live stream interfaces

**Contains:**
- `loadAvailablePresets()` - Fetch available preset files from server
- `showPresetsMenu()` - Display preset selection modal
- `hidePresetsMenu()` - Close preset modal
- `showPlaylistGuide()` - Display playlist help guide
- `hidePlaylistGuide()` - Close playlist guide
- Global escape-key handler for modals

**Dependencies:** `core.js` (escapeHtml)

**Used by:** `browser.js`, `liveui.js`

**Notes:**
- Eliminates ~50 lines of duplication between old live.js and browser.js
- Generic modal positioning works for both SPAs

---

### 2. **livedata.js** (442 lines)
**Purpose:** Live stream data management, stream probing, and persistence

**Contains:**
- **Configuration:** STREAM_PROXY, BUILTIN_STREAM_DEFS
- **State:** liveStreams array, liveStreamsInitialized flag
- **User Stream Mgmt:** getUserStreams, saveUserStreams, addUserStream, removeUserStream
- **Stream Probing:** probeStream (tests if stream URL works)
- **Playlist Parsing:** parsePLS, parseM3U, fetchPlaylist
- **Stream Addition:** probeAndAddStream (async stream detection)
- **Metadata:** parseSomaFMStream (parse SomaFM titles)
- **Initialization:** loadDefaultStreamsOnFirstRun, initLiveStreams, restoreLivePlayer
- **Persistence:** saveCollectionToFile, loadCollectionFromFile, clearAllStreams, saveLiveStreamOrder

**Dependencies:** `core.js` (storage, state)

**Used by:** `liveui.js`, `player.js`

**Notes:**
- Pure data layer - no DOM manipulation
- All async operations for stream probing
- Self-contained and testable
- Auto-initializes on page load

---

### 3. **liveui.js** (245 lines)
**Purpose:** Live stream UI rendering, user interactions, and event handling

**Contains:**
- **Display:** displayLiveStreams (renders stream list with status)
- **Info Toggle:** toggleStreamInfo (show/hide stream details)
- **Playback:** playLiveStream (play selected stream)
- **Drag & Drop:** onLiveStreamDragStart, onLiveStreamDragOver, onLiveStreamDrop, onLiveStreamDragEnd
- **Collections Menu:** toggleStreamCollectionsMenu, hideStreamCollectionsMenu
- **Presets:** selectPreset, addStreamsFromPreset
- **Event Handlers:** Delegated click handlers, drag handlers, callback for data cleared

**Dependencies:** 
- `core.js` (state, storage, escapeHtml, showToast)
- `player.js` (playLive, updatePlayPauseBtn)
- `livedata.js` (stream management functions)
- `modals.js` (shared modal functions)

**Used by:** Both `player.html` and `live.html` SPAs

**Notes:**
- Pure UI/interaction layer
- Calls into livedata.js for all data operations
- Event delegation for efficient DOM handling
- Callback pattern for data layer updates

---

## Files Modified

### 1. **browser.js** (696 lines, was 703)
**Changes:**
- Removed `showPlaylistGuide()` and `hidePlaylistGuide()` functions (now in modals.js)
- Added comment noting modals are shared

**Result:** 7 lines saved by reusing modals.js

---

### 2. **player.html** 
**Script load order changed from:**
```html
<script src="core.js"></script>
<script src="mixes.js"></script>
<script src="queue.js"></script>
<script src="player.js"></script>
<script src="player-mix.js"></script>
<script src="live.js"></script>
<script src="browser.js"></script>
```

**To:**
```html
<script src="core.js"></script>
<script src="mixes.js"></script>
<script src="queue.js"></script>
<script src="player.js"></script>
<script src="player-mix.js"></script>
<script src="livedata.js"></script>
<script src="modals.js"></script>
<script src="liveui.js"></script>
<script src="browser.js"></script>
```

**Rationale:** Maintains linear dependency flow:
- core.js (no deps)
- mixes.js, queue.js, player.js (use core)
- player-mix.js (uses player)
- livedata.js (uses core)
- modals.js (uses core)
- liveui.js (uses core, player, livedata, modals)
- browser.js (uses all above + modals)

---

### 3. **live.html**
**Script load order changed from:**
```html
<script src="core.js"></script>
<script src="player.js"></script>
<script src="live.js"></script>
```

**To:**
```html
<script src="core.js"></script>
<script src="player.js"></script>
<script src="livedata.js"></script>
<script src="modals.js"></script>
<script src="liveui.js"></script>
```

**Rationale:** Live.html doesn't need browser.js, so loads only live-specific modules.

---

## Files Archived

### Old **live.js** → **live.js.bak2**
- Original file backed up for reference
- Previous backup (live.js.bak) still exists

---

## Dependency Flow (Linear, No Cycles)

### player.html (3-column DJ/Mix player)
```
core.js (utilities & global state)
  ├→ mixes.js (DJ/mix data loading)
  ├→ queue.js (queue management)
  ├→ player.js (audio playback & waveform)
      ├→ player-mix.js (DJ mix specifics)
      └→ livedata.js (stream data)
  ├→ modals.js (shared modal UI)
  └→ liveui.js (live stream UI)
      └→ browser.js (DJ browser, search, mode switching)
```

### live.html (Live streams only)
```
core.js (utilities & global state)
  ├→ player.js (audio playback)
  ├→ livedata.js (stream data & management)
  ├→ modals.js (shared modal UI)
  └→ liveui.js (live stream UI)
```

**Still linear?** ✅ YES - No circular dependencies!

---

## File Sizes Comparison

| File | Before | After | Change |
|------|--------|-------|--------|
| live.js | 850 | 0 | removed |
| livedata.js | - | 442 | new |
| liveui.js | - | 245 | new |
| modals.js | - | 142 | new |
| browser.js | 703 | 696 | -7 |
| **Total (relevant)** | **1553** | **1525** | **-28** |
| **Largest file** | **850** | **696** | **-154** |

**Benefits:**
- ✅ Largest file reduced by 18% (850 → 696 lines)
- ✅ Better separation of concerns (data vs UI)
- ✅ Modals shared between both SPAs (less duplication)
- ✅ Pure data layer (livedata.js) is easier to test/debug
- ✅ Linear dependency flow maintained
- ✅ No build tool needed
- ✅ Easy to understand module boundaries

---

## Testing Checklist

After deployment, verify:

### player.html (DJ Mixes SPA)
- [ ] Page loads without errors (check browser console)
- [ ] DJ browser loads mixes
- [ ] Mix playback works
- [ ] Queue operations work (add, remove, reorder)
- [ ] Live streams tab works (if enabled)
- [ ] Add playlist/streams works
- [ ] Settings modal works
- [ ] Help modal works
- [ ] Keyboard shortcuts work

### live.html (Live Streams SPA)
- [ ] Page loads without errors
- [ ] Streams list displays correctly
- [ ] Stream playback works
- [ ] Add stream dialog works
- [ ] Remove stream works
- [ ] Drag-drop reordering works
- [ ] Save/load collections works
- [ ] Presets menu works
- [ ] Playlist guide works

### Both SPAs
- [ ] Modal styling consistent
- [ ] Escape key closes modals
- [ ] Page restoration works (resume playing)
- [ ] No console errors

---

## Future Improvements

If `browser.js` grows beyond 800-1000 lines, consider similar split:
```
browser-mixes.js    (DJ/mix browser UI)
browser-search.js   (search functionality)
browser-shared.js   (settings, help, mode coordinator)
```

But this can wait until needed - apply splits when files become hard to maintain.

---

## Notes

- Old live.js is backed up as live.js.bak2 (previous backup was live.js.bak)
- All function calls between modules preserved
- Global state (state, storage) still centralized in core.js
- No changes to HTML structure needed
- All CSS classes/IDs remain the same
