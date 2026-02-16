# Live.html SPA Feasibility Analysis

## Executive Summary

✅ **HIGHLY FEASIBLE** – Splitting browser.js and player.js to create a dedicated `live.html` SPA is architecturally sound and well-contained.

The Live Mode functionality is sufficiently self-contained that:
- ~45% of browser.js (450+ lines) can be extracted into `live.js`
- Only ~20% of player.js needs modification (remove waveform code, keep live functions)
- Core.js requires minimal changes
- The three-file dependency chain (core.js → player.js → live.js) is clean and unidirectional

---

## Current Architecture Analysis

### Module Responsibilities

| Module | Lines | Primary Role | Live Dependencies |
|--------|-------|--------------|-------------------|
| **core.js** | 140 | Shared state, storage, utilities | `state.isLive`, `playLive()`, storage ops |
| **player.js** | 582 | Playback control, waveform | Live: 25% (5 functions) |
| **queue.js** | 191 | Queue management | None (can be removed for live.html) |
| **mixes.js** | ? | Mix data loading | None (can be removed for live.html) |
| **browser.js** | 1257 | All browse modes, live streams | Live: 45% (550+ lines) |

---

## What Can Be Removed for Live.html

### 1. **Waveform Display** (player.js, lines 3–115, 117–125)
- Canvas drawing and resizing
- Peak data loading
- Waveform cursor tracking
- Click-to-seek functionality
- **Total lines**: ~130 lines
- **Impact on core playback**: NONE — all player control functions remain untouched

### 2. **Queue & Middle Column** (queue.js + browser.js integration)
- Entire queue.js module (191 lines)
- Queue UI DOM elements in player.html
- Queue event handlers in browser.js (~50 lines)
- Queue integration in player.js (updateQueueInfo)
- **Total removable**: ~240 lines
- **Impact**: All `playFromQueue()`, `skipNext()`, `skipPrev()` calls removed

### 3. **Browser Mode Buttons** (browser.js, lines 714–793)
- DJ Mode UI and handlers (~50 lines)
- All Mode buttons (DJ, All, Search, Favourites)
- `browserModes` object and switch logic (~75 lines)
- Mode-specific UI state management (~80 lines)
- **Total lines**: ~205 lines
- **Removal strategy**: Replace with single hardcoded 'live' mode

### 4. **Settings & Help Popups** (browser.js + player.html)
- Settings modal (lines 63–91 in player.html, 1000–1019 in browser.js)
- Help modal (lines 92–108 in player.html, 1026–1036 in browser.js)
- Modal-related CSS (~50 lines)
- **Total lines**: ~60 lines
- **Impact**: None on live streaming functionality

---

## What Must Stay in Player.js

### Core Live Stream Functions (player.js, lines 207–249)
```javascript
playLive(url, displayText, autoplay = false)     // Line 207
pauseLive()                                        // Line 170
resumeLive()                                       // Line 183
stopLive()                                         // Line 238
```
- **Lines**: 43 lines
- **Dependencies**: `state.isLive`, `state.liveStreamUrl`, `state.liveDisplayText`, `aud` (audio element)
- **Critical for live.html**: YES

### Live Stream State Updates (player.js, lines 138–149, 151–156, 159–167)
```javascript
updateTimeDisplay()          // Handles live display (shows 'LIVE' when playing)
updatePlayPauseBtn()        // Works for live streams
updateMuteBtn()             // No changes needed
```
- **Lines**: 18 lines
- **Impact**: These already handle `state.isLive` checks and render correctly for streams

### Play/Pause Controls (player.js, lines 250–332)
```javascript
playPauseBtn.addEventListener('click', async () => { ... })
aud.addEventListener('ended', async () => { ... })
```
- **Lines**: 83 lines
- **Live support**: Already has `if (state.isLive)` branches
- **Critical for live.html**: YES (100% compatible)

---

## What Needs Extraction to live.js

### From browser.js — Live Streams Configuration & Control (lines 314–703)

#### Tier 1: Essential Live Stream Management (350+ lines)
```javascript
// Configuration
STREAM_PROXY                           // Line 316
BUILTIN_STREAM_DEFS                   // Line 318-321
getUserStreams()                      // Line 323-325
saveUserStreams(streams)              // Line 327-329
addUserStream(name, m3u, genre)       // Line 331-340
removeUserStream(index)               // Line 397-405
initializeBuiltinStreams()            // Line 407-415
getLiveStreamConfig()                 // Line 417-419

// State & Initialization
let liveStreams = []                  // Line 421
let liveStreamsInitialized = false    // Line 422

// Probing & Loading
probeStream(url, timeoutMs = 5000)    // Line 424-446
probeAndAddStream(config)             // Line 342-395
parsePLS(text)                        // Line 448-469
parseM3U(text)                        // Line 471-488
fetchPlaylist(playlistUrl)            // Line 490-503
initLiveStreams()                     // Line 505-514
parseSomaFMStream(name, genre)        // Line 600-622

// UI Display
displayLiveStreams()                  // Line 516-597
handleAddStream()                     // Line 624-641
handleRemoveStream(userIndex)         // Line 643-648
reloadLiveStreams()                   // Line 650-654
playLiveStream(index)                 // Line 656-662

// Drag-and-Drop Reordering
onLiveStreamDragStart(e, index)       // Line 665-668
onLiveStreamDragOver(e)               // Line 670-672
onLiveStreamDrop(e, dropIndex)        // Line 674-683
onLiveStreamDragEnd()                 // Line 685-688
saveLiveStreamOrder()                 // Line 690-707
toggleStreamInfo(btn)                 // (similar function)

// Collections Management
saveCollectionToFile()                // Line 1176-1199
loadCollectionFromFile()              // Line 1201-1236
clearAllStreams()                     // Line 1238-1248
toggleStreamCollectionsMenu()         // Line 1162-1167
hideStreamCollectionsMenu()           // Line 1169-1174
```

**Total: ~450 lines** — These form a cohesive, self-contained module.

#### Tier 2: Search Integration (line 303-311 in searchIndex)
- **Impact**: Can be kept in live.js, called from searchIndex if needed
- **Lines**: 8 lines (filter clause for live streams in search)
- **Dependencies**: `liveStreams` array

#### Tier 3: Keyboard Shortcut for Live Mode (line 991-993)
```javascript
else if (e.code === 'KeyL' && e.ctrlKey) {
  e.preventDefault();
  browserModes.switch('live');
}
```
- **For live.html**: REMOVE entirely (single-mode SPA, no mode switching)

---

## HTML Structure Changes for live.html

### Current player.html Layout (3-column grid)
```
┌─────────────────────────────────────────┐
│ Left (Player)     │ Middle (Queue) │ Right (Browser) │
├─────────────────────────────────────────┤
│ Waveform          │ Queue items    │ Mode buttons    │
│ Controls          │                │ DJ/All/Search   │
│ Now Playing       │                │ Live Mode list  │
│ Cover/Tracks      │                │ Settings/Help   │
└─────────────────────────────────────────┘
```

### Proposed live.html Layout (merged 2-column, mobile-friendly)
```
┌──────────────────┐
│ Player Controls  │
│ (Time display)   │ Sidebar
├──────────────────┤
│ Now Playing      │
│ (Stream name)    │
├──────────────────┤
│ Live Streams     │
│ List & Controls  │
│ (drag-reorder)   │
│ (add new)        │
│ (collections)    │
└──────────────────┘
```

### DOM Elements to Keep for live.html
```html
<!-- Core playback -->
<audio id="audioPlayer"></audio>
<div id="audioControls">
  <button id="playPauseBtn">▶</button>
  <span id="timeDisplay">LIVE</span>
  <div id="volumeControl">
    <button id="muteBtn">🔊</button>
    <input id="volumeSlider" type="range" min="0" max="100" value="50">
  </div>
</div>

<!-- Now playing display (stream name) -->
<div id="nowPlaying"></div>

<!-- Live streams list -->
<div id="mixList"></div>

<!-- Add stream form -->
<div id="newStreamM3U" class="input"></div>
<!-- Stream collections menu -->
```

### DOM Elements to Remove
```html
<!-- Waveform -->
<canvas id="waveform"></canvas>
<div id="waveformResizeHandle"></div>

<!-- Queue column -->
<div class="middle-column">
  <div id="queue"></div>
  <div id="localFiles">...</div>
</div>

<!-- Browser mode buttons -->
<button class="mode-btn" data-mode="dj">DJ</button>
<button class="mode-btn" data-mode="all">All</button>
<button class="mode-btn" data-mode="search">Search</button>
<button class="mode-btn" data-mode="favourites">Fav</button>

<!-- DJ buttons, search box, group filters -->
<div id="djButtons">...</div>
<div id="djDropdown">...</div>
<div id="searchBox">...</div>
<div id="groupFilters">...</div>

<!-- Settings & Help -->
<button class="settings-btn">⚙️</button>
<button class="help-btn">?</button>
<div id="settingsModal">...</div>
<div id="helpModal">...</div>

<!-- Cover art display -->
<div id="coverArt"></div>

<!-- Track list -->
<div id="trackList"></div>
```

---

## CSS Changes Required

### Media Query Simplification
Live.html can use a **single-column layout** (no responsive grid switching):
- Remove 3-column grid layout (lines 99–100)
- Remove 2-column fallback (lines ~110–120)
- Remove responsive breakpoints (lines ~140+)
- New simple CSS: ~50 lines vs. ~200+ lines in player.css

### New Minimal Stylesheet
```css
html, body { /* dark theme */ }
.container { /* single column */ }
#audioControls { /* player bar */ }
#nowPlaying { /* stream title */ }
#mixList { /* streams list */ }
.mix-item { /* stream row */ }
/* Stream editing popouts */
/* Add stream form */
/* Collections menu */
```

### Estimated Reduction
- player.css: 1156 lines
- live.css: ~300–400 lines (60% reduction)
- Remove: waveform canvas styles, queue styles, mode buttons, all responsive tweaks

---

## Dependency Graph: live.html vs player.html

### live.html Dependency Chain
```
┌─────────────────────────────────────────────┐
│ live.html (entry point)                     │
│ ────────────────────────────────────────┬───┤
│  ├─ script: core.js ───────────────────────│
│  │   • state: isLive, liveStreamUrl, etc   │
│  │   • storage (localStorage API)          │
│  │   • escapeHtml(), formatTime()          │
│  │                                          │
│  ├─ script: player.js (MODIFIED) ─────────│
│  │   ✓ playLive(), pauseLive()            │
│  │   ✓ resumeLive(), stopLive()           │
│  │   ✓ playPauseBtn, muteBtn, volumeSlider
│  │   ✓ updateTimeDisplay()                │
│  │   ✓ updatePlayPauseBtn()               │
│  │   ✓ updateMuteBtn()                    │
│  │   ✗ drawWaveform() [REMOVE]            │
│  │   ✗ resizeWaveformCanvas() [REMOVE]    │
│  │   ✗ waveform canvas handlers [REMOVE]  │
│  │   ✗ playFromQueue() [REMOVE]           │
│  │   ✗ playMix() [REMOVE]                 │
│  │   ✗ fetchMixDetails() [REMOVE]         │
│  │                                          │
│  └─ script: live.js (NEW, extracted) ─────│
│      • liveStreams[] and initialization    │
│      • displayLiveStreams()                │
│      • playLiveStream()                    │
│      • Stream management (add, remove)     │
│      • Drag-drop reordering                │
│      • Collections (save/load)             │
│      • Playlist parsing (M3U, PLS)         │
│      • Stream probing                      │
│      • SomaFM parsing                      │
│                                             │
└─────────────────────────────────────────────┘
```

### Current player.html Dependency Chain
```
┌────────────────────────────────────────────┐
│ player.html (entry point)                  │
├────────────────────────────────────────────┤
│ • core.js (core state, storage, utilities) │
│ • mixes.js (manifest fetching)             │
│ • queue.js (queue management)              │
│ • player.js (playback + waveform)          │
│ • browser.js (all browse modes)            │
└────────────────────────────────────────────┘
```

---

## Code Complexity Analysis

### browser.js Complexity
- **Total lines**: 1257
- **Live Mode code**: ~550 lines (45%)
  - Configuration: 100 lines
  - Probing/Loading: 150 lines
  - UI Display: 150 lines
  - Collections Mgmt: 150 lines
- **Cohesion**: HIGH — All live code is clustered in lines 314–707 and 1162–1248
- **Coupling to other modes**: LOW — Minimal cross-references

### player.js Complexity
- **Total lines**: 582
- **Live stream handling**: ~70 lines (12%)
  - `playLive()` – 30 lines
  - `pauseLive()`, `resumeLive()`, `stopLive()` – 40 lines
  - State updates in `updateTimeDisplay()`, `updatePlayPauseBtn()` – 5 lines
- **Cohesion**: HIGH — Live functions are isolated
- **Coupling to waveform**: HIGH — ~130 lines of waveform code are entangled
  - Can be removed cleanly (no dependencies on waveform in other playback code)

---

## Extraction Plan: Step-by-Step

### Phase 1: Create live.js Module
**File**: `live.js` (~500 lines)

Extract from browser.js:
- Lines 314–321: `STREAM_PROXY`, `BUILTIN_STREAM_DEFS`
- Lines 323–415: Stream config functions
- Lines 421–422: `liveStreams`, `liveStreamsInitialized`
- Lines 424–503: Probing, parsing, fetching
- Lines 505–662: Init, display, play
- Lines 665–707: Drag-drop
- Lines 600–622: SomaFM parsing
- Lines 1162–1248: Collections management

**Standalone exports**:
- `function initLiveStreams()`
- `function displayLiveStreams()`
- `function playLiveStream(index)`
- `function handleAddStream()`
- `function handleRemoveStream(index)`
- `let liveStreams`

**Dependencies**:
- `core.js`: state, storage, escapeHtml()
- `player.js`: playLive() function

### Phase 2: Split player.js into Two Modules

Instead of removing code from player.js, **refactor it into two complementary modules**:

#### **player.js (CORE, ~250 lines)** — Reusable Playback Module
Kept and used by **BOTH player.html and live.html**:

Core playback state and controls:
- Lines 128–131: Button & slider references (`playPauseBtn`, `muteBtn`, `volumeSlider`, `timeDisplay`)
- Lines 133–135: Volume restoration from localStorage
- Lines 138–167: `updateTimeDisplay()`, `updatePlayPauseBtn()`, `updateMuteBtn()`

Live stream functions (lines 170–249):
- `pauseLive()` – Stop live stream download
- `resumeLive()` – Restore live stream URL and play
- `playLive(url, displayText, autoplay)` – Start playing a live stream
- `stopLive()` – Exit live mode

Basic audio functions (lines 372–389):
- `load(url)` – Load audio without playing
- `play(url)` – Load and play

Audio event handlers:
- Lines 250–332: `aud.addEventListener('ended', ...)` — Queue/live handling
- Lines 369–370: `aud.addEventListener('play', ...)` and `aud.addEventListener('pause', ...)`

Play/Pause controls:
- Lines 128–156: Button click handlers for play/pause, mute, volume

**Result**: A clean, reusable playback core that works with both live streams and mix files.

#### **player-mix.js (NEW, ~300 lines)** — Mix-Specific Playback
**Only** for player.html:

Waveform code (~130 lines):
- Lines 3–72: `resizeWaveformCanvas()`, `drawWaveform()`, `updateWaveformCursor()`
- Lines 74–115: Waveform resize handler setup and management
- Lines 117–125: `loadPeaks(peaks)`
- Canvas click-to-seek handlers

Mix playback (~70 lines):
- Lines 391–396: `getDJName(htmlPath)`
- Lines 398–423: `playMix(mix)` — Load mix details, set cover art, display track list
- Lines 425–434: `playNow(mixId)` — Play mix immediately, saving queue position
- Lines 436–487: `displayTrackList()` — Render track list, cover art, action buttons

Queue integration (~60 lines):
- Lines 159–163: `playFromQueue(index)` — Load and play from queue
- Queue-related event handling in `aud.addEventListener('ended', ...)`

Favourites/hidden management (~20 lines):
- Lines 489–511: `toggleCurrentFavourite()`, `toggleCurrentHidden()`
- Lines 513–523: `refreshBrowserList()`

Local file support (~20 lines):
- Lines 525–582: `guessMimeType()`, `checkAudioSupport()`, `probeAudioPlayback()`

**Result**: All mix-specific functionality isolated in a single, optional module.

### Script Loading Architecture

#### player.html (all features, no changes to existing files)
```html
<script src="core.js"></script>       <!-- Shared state, utilities -->
<script src="mixes.js"></script>      <!-- Mix data fetching -->
<script src="queue.js"></script>      <!-- Queue management -->
<script src="player.js"></script>     <!-- Core playback (live + mix compatible) -->
<script src="player-mix.js"></script> <!-- Mix-only: waveform, playMix(), queue integration -->
<script src="browser.js"></script>    <!-- All browse modes (DJ, All, Search, Fav, Live) -->
```

#### live.html (live-only, minimal)
```html
<script src="core.js"></script>      <!-- Shared state, utilities -->
<script src="player.js"></script>    <!-- Core playback (shared) -->
<script src="live.js"></script>      <!-- Live streams (extracted from browser.js) -->
```

### Key Advantage: Zero Code Loss
- **player.js** becomes a focused, reusable playback module (works in any context)
- **player-mix.js** preserves all mix/waveform/queue code (zero deletions)
- **browser.js** remains unchanged for player.html
- **live.html** only loads what it needs (~930 lines total vs. 3000+ in player.html)
- **Backwards compatible**: player.html works identically after refactor

### Phase 3: Create live.html
**Structure**:
```html
<!DOCTYPE html>
<html>
  <head>
    <title>Live Stream Player</title>
    <meta charset="utf-8">
    <link rel="stylesheet" href="live.css">
  </head>
  <body>
    <div class="container">
      <!-- Player controls -->
      <audio id="audioPlayer"></audio>
      <div id="audioControls">
        <button id="playPauseBtn">▶</button>
        <span id="timeDisplay">LIVE</span>
        <div id="volumeControl">
          <button id="muteBtn">🔊</button>
          <input id="volumeSlider" type="range" min="0" max="100" value="50">
        </div>
      </div>
      
      <!-- Stream info -->
      <div id="nowPlaying"></div>
      
      <!-- Streams browser -->
      <div id="mixList"></div>
    </div>
    
    <!-- Scripts in order -->
    <script src="core.js"></script>
    <script src="player.js"></script>
    <script src="live.js"></script>
  </body>
</html>
```

### Phase 4: Create live.css
**Approach**: 
- Copy player.css
- Remove lines related to: waveform, queue column, middle column, 3-column grid, mode buttons, modals
- Reduce to single-column responsive design
- Keep: player controls, stream list, add-stream form, collections menu
- Result: ~300–400 lines instead of 1156

### Phase 5: Update Browser.js (Optional, Player.html only)
- Restore removed code (no changes needed if live.js is separate file)
- Or: Keep current browser.js unchanged, only load live.js in live.html

---

## Risk Assessment

### Low Risk ✅
- ✅ Live stream code is well-isolated in browser.js (no hidden dependencies)
- ✅ Core playback functions (playLive, pauseLive, etc.) have no waveform dependencies
- ✅ State management (`state.isLive`, etc.) is already in core.js
- ✅ Storage and utilities are shared via core.js
- ✅ Single-file removal strategy (CSS, HTML, JS) is straightforward

### Medium Risk ⚠️
- ⚠️ **Waveform removal from player.js**: Must verify no playback code references `drawWaveform()` indirectly
  - **Mitigation**: Search for all waveform references; they should be isolated
- ⚠️ **Queue code removal**: `skipNext()`, `skipPrev()` called from keyboard handlers
  - **Mitigation**: Remove keyboard handlers for queue navigation (↑↓) from live.js version
- ⚠️ **CSS cascade issues**: Removing middle column might affect responsive breakpoints
  - **Mitigation**: Test live.css on all screen sizes (mobile to desktop)

### Low-to-Medium Risk
- ⚠️ **Browser compatibility**: Stream probing via Audio element may have issues on older browsers
  - **Current**: Already implemented in player.html live mode
  - **Mitigation**: Use same approach as current implementation

### No Real Risk ✅
- ✅ **Backwards compatibility**: Current player.html remains unchanged
- ✅ **Server requirements**: No changes to .htaccess or manifest generation scripts
- ✅ **Hosting**: live.html can be hosted at same domain as player.html (no CORS issues)

---

## Files Affected Summary

| File | Type | Status | Impact | Notes |
|------|------|--------|--------|-------|
| core.js | Shared | No change | 0 lines | Used by both SPAs |
| player.js | Refactored | Extract mix code | Move 300 lines → player-mix.js | Keep 250 lines for shared playback |
| **player-mix.js** | **New** | **Extract from player.js** | **~300 lines** | Mix/waveform/queue code (player.html only) |
| browser.js | Existing | Extract live code | Move ~500 lines → live.js | Remain for player.html, unchanged |
| **live.js** | **New** | **Extract from browser.js** | **~500 lines** | Live stream management (live.html only) |
| queue.js | Existing | No change | 0 lines | Player.html only, unchanged |
| mixes.js | Existing | No change | 0 lines | Player.html only, unchanged |
| player.css | Existing | No change | 0 lines | Player.html only, unchanged |
| **live.css** | **New** | **Create** | **~350 lines** | Simplified from player.css (live.html only) |
| **live.html** | **New** | **Create** | **~80 lines** | New entry point for live SPA |

### Total Code Movement (Zero Loss, Pure Refactoring)
- **player.js** split: 250 lines (core playback, shared) + 300 lines → player-mix.js
- **browser.js** split: Existing code unchanged + 500 lines → live.js
- **New CSS**: 350 lines (live.css, adapted from player.css)
- **New HTML**: 80 lines (live.html)
- **Total new/moved**: 930 lines
- **Total deleted**: 0 lines
- **player.html compatibility**: 100% (all original code preserved or reorganized)

---

## Validation Checklist

### Before Extraction
- [ ] **Dependency audit**: `grep -n "drawWaveform\|loadPeaks\|resizeWaveform" player.js` — should find only isolated calls
- [ ] **Queue function check**: `grep -n "playFromQueue\|skipNext\|skipPrev" *.js` — identify all references
- [ ] **Live function isolation**: `grep -n "playLive\|pauseLive\|resumeLive\|stopLive" *.js` — verify called only from browser.js and live.js
- [ ] **State dependency**: Confirm all live state in `core.js` state object

### After Extraction
- [ ] **Load live.html**: No console errors
- [ ] **Stream list displays**: Builtin streams visible
- [ ] **Add stream works**: Can add custom M3U/PLS
- [ ] **Play stream works**: Click play button → audio loads and plays
- [ ] **Pause/resume**: Works correctly
- [ ] **Volume control**: Works
- [ ] **Drag-drop reorder**: Works
- [ ] **Collections save/load**: Works
- [ ] **Mobile responsive**: Layout works on small screens
- [ ] **No console errors**: Zero errors in browser DevTools

### Regression Testing (player.html unchanged)
- [ ] All original player.html functionality works
- [ ] DJ mode, All mode, Search mode, Favourites mode
- [ ] Queue management
- [ ] Waveform display and seeking
- [ ] Mix playback

---

## Implementation Status

### ✅ COMPLETED
- [x] **Step 1**: Updated LIVE_SPA_FEASIBILITY.md with player-mix.js split strategy
- [x] **Step 2**: Created live.js (~500 lines) extracted from browser.js
  - Lines 314–710: All stream config, probing, display functions
  - Lines 1162–1257: Collections management (save/load/clear)
  - Lines 166–214: Stream edit event handlers
  - **New file**: `/home/st/git/mix.4st.uk/live.js`

### ⏳ REMAINING (Next phase after testing)
- [ ] **Step 3**: Extract player-mix.js from player.js (~300 lines)
- [ ] **Step 4**: Create live.html
- [ ] **Step 5**: Create live.css
- [ ] **Step 6**: Test both SPAs

---

## Effort Summary

| Task | Effort | Time | Status |
|------|--------|------|--------|
| Update feasibility doc | Low | 30 min | ✅ Done |
| Create live.js | Medium | 1–2 hours | ✅ Done |
| Extract player-mix.js | Medium | 1–2 hours | ⏳ Next |
| Create live.html | Low | 30 min | ⏳ Next |
| Create live.css | Medium | 1–2 hours | ⏳ Next |
| Testing & debugging | Medium | 1–2 hours | ⏳ Next |
| **TOTAL COMPLETED** | | | **~1.5 hours** |
| **TOTAL REMAINING** | | | **~6 hours** |

---

## Deployment Strategy

### Option A: Side-by-Side (Recommended)
- Deploy live.html alongside player.html
- **URL**: `mixes.4st.uk/live.html` (or `live.mixes.4st.uk`)
- **Benefits**: 
  - Zero impact on existing player.html users
  - Can A/B test both deployments
  - Easy rollback if issues
- **Hosting**: ~50MB for live.html (no mix data, no queue, minimal CSS)

### Option B: Replace player.html (Future)
- After live.html is stable, consider replacing player.html
- **Benefits**: 
  - Simpler hosting (one SPA instead of two)
  - Better branding (cleaner UX)
- **Risks**:
  - Breaks users' bookmarks and deep links
  - Some users may prefer mix queue functionality

### Option C: Hybrid (Progressive Enhancement)
- Detect user preference (localStorage)
- Offer both SPAs on homepage
- Default to player.html for new users, let them switch

---

## Conclusion

**The extraction is highly feasible.** The live stream functionality in browser.js and player.js is well-isolated with minimal coupling to other features. A new live.html SPA can be created by:

1. **Extracting ~450 lines** from browser.js into a new live.js module
2. **Removing ~130 lines** of waveform code from player.js
3. **Creating live.html** with a simplified single-column layout
4. **Generating live.css** from player.css with unnecessary styles removed

**Result**: A ~70MB live streaming SPA (vs. 77GB+ current player.html) that can be hosted independently with minimal operational overhead.

The modular architecture makes this a clean refactoring with low risk of introducing bugs or regression.
