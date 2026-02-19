# JavaScript File Splitting Analysis

## Current File Sizes (Feb 2026)
```
browser.js      703 lines  (18 functions, 2 const modules)
live.js         850 lines  (23 functions, 2 const modules)  ← LARGEST
player-mix.js   388 lines  
player.js       261 lines  
mixes.js        290 lines
queue.js        197 lines
core.js         172 lines
─────────────────────────────
Total:         2861 lines
```

**Problem:** `live.js` is now the largest file (850 lines).

---

## Code Organization Analysis

### browser.js (703 lines) - CURRENT STRUCTURE
**Functions by Category:**
- **UI Functions (15):** displayMixList, toggleExtraInfo, displaySearchResults, showSettings/hideSettings, showHelp/hideHelp, showPlaylistGuide/hidePlaylistGuide, updateDJButtons, displayGroupFilters, updateFilterButtons, setShowHiddenMixes, updateShowHiddenMixes
- **Data Functions (3):** applyFilter, addSearchResultToQueue, addAllSearchResultsToQueue
- **Modules (2):** searchIndex (object), browserModes (object)

**Concerns:**
- Mix browser UI (DJ/filter/list display) - ~200 lines
- Search UI & logic - ~250 lines
- Settings/Help modals - ~100 lines

**Current loads:** `core.js`, `mixes.js`, `queue.js`, `player.js`, `live.js`

---

### live.js (850 lines) - LARGEST FILE
**Functions by Category:**
- **UI Functions (7):** displayLiveStreams, toggleStreamInfo, toggleStreamCollectionsMenu, hideStreamCollectionsMenu, showPlaylistGuide, hidePlaylistGuide, hidePresetsMenu
- **Data/Parse Functions (10):** getUserStreams, saveUserStreams, getLiveStreamConfig, probeStream, parsePLS, parseM3U, parseSomaFMStream, saveCollectionToFile, loadCollectionFromFile, saveLiveStreamOrder
- **Logic Functions (6):** removeUserStream, playLiveStream, onLiveStreamDragStart, onLiveStreamDragOver, onLiveStreamDrop, onLiveStreamDragEnd
- **Modules (2):** STREAM_PROXY, mixList

**Breakdown:**
- Stream management (parse, probe, add/remove) - ~400 lines
- Stream UI display - ~200 lines
- Collections/presets UI & save/load - ~200 lines
- Drag-drop interactions - ~50 lines

**Current loads:** `core.js`, `player.js`

---

## Splitting Options Analysis

### OPTION A: Split live.js into liveui.js + livedata.js
**Rationale:** Separate UI rendering from stream management logic

**livedata.js (350-400 lines):**
- STREAM_PROXY, BUILTIN_STREAM_DEFS
- getUserStreams, saveUserStreams, removeUserStream
- getLiveStreamConfig, probeStream
- parsePLS, parseM3U, parseSomaFMStream
- saveCollectionToFile, loadCollectionFromFile, saveLiveStreamOrder
- Constants & config

**liveui.js (400-450 lines):**
- displayLiveStreams (uses livedata.js data)
- toggleStreamInfo
- Stream drag-drop handlers
- Collections menu UI
- Playlists guide modal
- Presets modal

**Dependencies:**
```
core.js
player.js
livedata.js ── (uses player state, core utils)
liveui.js ──── (uses livedata.js, core.js, player.js)
```

**Load order:** `core.js`, `player.js`, `livedata.js`, `liveui.js`

**Verdict:** ✅ **GOOD** - Clean separation. livedata.js is self-contained data layer.

---

### OPTION B: Split live.js into livestream.js + liveui.js
**Difference from A:** Similar but different boundary - separate the "add/manage streams" from UI

**livestream.js (Smaller, ~250 lines):**
- Stream management: add/remove/probe/parse streams
- Collection save/load
- Stream order persistence

**liveui.js (Larger, ~550 lines):**
- All UI rendering
- Drag-drop
- Modals & guides

**Verdict:** ❌ **WEAKER** - Unbalanced split (100:550 is skewed). UI still very large.

---

### OPTION C: Split browser.js into browsermix.js + browsersearch.js + browserui.js
**Rationale:** Separate DJ/mix browsing from search from shared UI

**browsermix.js (~200 lines):**
- loadDJ, updateDJButtons
- displayGroupFilters, updateFilterButtons, applyFilter
- displayMixList, toggleExtraInfo
- getMixId, addToQueue, addAllToQueue
- refreshBrowserList, displayFavourites, getDJName

**browsersearch.js (~150 lines):**
- searchIndex object
- displaySearchResults
- displayMixListWithDJ
- toggleSearchMixInfo
- addSearchResultToQueue, addAllSearchResultsToQueue
- playSearchResult

**browserui.js (~200 lines):**
- showSettings, hideSettings, updateSetting
- updateShowHiddenMixes
- showHelp, hideHelp
- showPlaylistGuide, hidePlaylistGuide
- browserModes object (coordinator)

**Dependencies:**
```
core.js
mixes.js
queue.js
player.js

browsermix.js ───────┐
browsersearch.js ────┼→ browserui.js (coordinator)
                     │  └─ (all use core, mixes, queue, player)
```

**Verdict:** ❌ **COMPLEX** - 3-way split adds complexity. browserui.js becomes a thin coordinator. Doesn't simplify much.

---

### OPTION D: Keep browser.js, but split live.js only (RECOMMENDED)
**Rationale:** Browser.js is manageable at 700 lines. Live.js at 850 is the real problem.

**Approach:**
```
live.js → livedata.js (400 lines) + liveui.js (450 lines)
browser.js → keep as-is (703 lines)
```

**Load order both SPAs:**
```
player.html:  core.js → mixes.js → queue.js → player.js → player-mix.js → livedata.js → liveui.js → browser.js
live.html:    core.js → player.js → livedata.js → liveui.js
```

**Benefits:**
- Solves the largest file problem
- Linear dependency flow maintained
- Minimal disruption
- Easy to debug: livedata.js is pure data layer
- Future: if browser.js grows, split it then

**Verdict:** ✅ **BEST BALANCE**

---

## Dependency Flow Analysis

### Current (All files are linear)
```
core.js (no deps)
  ↓
mixes.js
  ↓
queue.js
  ↓
player.js
  ↓
player-mix.js
  ↓
live.js ─────┐
  ↓          │ (both use player state)
browser.js ←┘
```

### With Option D (live.js split)
```
core.js (no deps)
  ↓
mixes.js
  ↓
queue.js
  ↓
player.js
  ↓
player-mix.js
  ↓
livedata.js ──────┐
  ↓               │
liveui.js ────────┼─┐
  ↓               │ │ (all use player state/mixes)
browser.js ←──────┘ │
                    │
live.html: ─────────┘ (live.html doesn't load browser.js)
```

**Still Linear?** ✅ **YES** - No circular dependencies.

**Why still linear:**
- livedata.js has no UI dependencies (doesn't need anything after player.js)
- liveui.js only depends on livedata.js + core.js + player.js
- browser.js can still load after liveui.js without issues

---

## Function Interdependencies in live.js

### Cross-function calls (within live.js)
```
displayLiveStreams()
  ├─ getLiveStreamConfig() - returns config object
  ├─ getUserStreams() - gets stored streams
  ├─ STREAM_PROXY - constant
  ├─ generateQueueId() [from core.js or queue.js?] -- CHECK THIS
  ├─ showToast() [from queue.js] -- MOVE TO UI layer

toggleStreamInfo()
  ├─ displayLiveStreams() - refresh after toggle

playLiveStream()
  ├─ player.playLive() [from player.js]
  └─ saveCollectionToFile() - restore state

Stream drag-drop handlers
  ├─ saveLiveStreamOrder() - persist order
  ├─ displayLiveStreams() - refresh

Collections modal
  ├─ saveCollectionToFile() - write data
  ├─ loadCollectionFromFile() - read data
  └─ displayLiveStreams() - refresh
```

**Key insight:** 
- **livedata.js** functions mostly self-contained (parse, probe, save/load)
- **liveui.js** functions all call back to livedata.js for data
- Clean separation possible

---

## Better Splitting Ideas?

### Alternative: livecore.js + liveui.js
(Similar to Option A, different naming)
- `livecore.js` = stream management, parsing, config, persistence
- `liveui.js` = all rendering and interaction

Would be same as Option A.

### Alternative: Consolidate some functions?
Currently `showPlaylistGuide()` and `hidePlaylistGuide()` are in BOTH browser.js and live.js.
- They're identical HTML/CSS modals
- **Could extract to shared `modals.js`?**
  - Would need to make showPlaylistGuide/hidePlaylistGuide generic
  - Could support multiple modal types
  - Reduces ~50 lines duplication

**This would be a GOOD side improvement** with Option D:
```
modals.js (100 lines) - Modal utility functions
  ├─ showModal(id), hideModal(id)
  ├─ toggleModal(id)
  └─ Modal event handlers

browser.js ─┐
live.js ────┼─→ modals.js
player.js ──┘    (shared UI utilities)
```

Load order: `core.js → ... → modals.js → live.js → browser.js`

**Verdict:** ✅ **Worth doing with Option D**

---

## Summary Table

| Option | Change | Files After | Largest | Linear | Effort | Benefit |
|--------|--------|-------------|---------|--------|--------|---------|
| **Do nothing** | None | 7 | 850 | ✅ | 0 | 0 |
| **A: Split live.js** | live→livedata+liveui | 8 | 703 | ✅ | Low | High |
| **A+: Add modals.js** | +dedupe modals | 9 | 703 | ✅ | Low | Medium |
| **B: livestream+liveui** | Different boundary | 8 | 550 | ✅ | Low | Medium |
| **C: Split both** | browser+live split | 10 | 600 | ✅ | High | Low |

---

## Recommendation

**DO: Option D (Split live.js only) + Bonus: Extract modals**

### Implementation Plan

1. **Create `livedata.js`** (370-400 lines)
   - Move stream management functions
   - Move parse/probe functions
   - Move persistence (save/load)
   - Keep: STREAM_PROXY, BUILTIN_STREAM_DEFS, mixList
   - Imports: core.js only

2. **Create `liveui.js`** (380-420 lines)
   - Move all UI rendering functions
   - Move drag-drop handlers
   - Move modal code (showPlaylistGuide/hidePlaylistGuide/hidePresetsMenu)
   - Imports: core.js, player.js, livedata.js
   - Functions mostly call livedata.js for data

3. **Update live.html** load order
   ```html
   <script src="core.js"></script>
   <script src="player.js"></script>
   <script src="livedata.js"></script>
   <script src="liveui.js"></script>
   ```

4. **Update player.html** load order
   ```html
   <script src="core.js"></script>
   <script src="mixes.js"></script>
   <script src="queue.js"></script>
   <script src="player.js"></script>
   <script src="player-mix.js"></script>
   <script src="livedata.js"></script>
   <script src="liveui.js"></script>
   <script src="browser.js"></script>
   ```

5. **Optional: Extract shared modals** (future refinement)
   - If the same modal code appears in browser.js + liveui.js
   - Extract to `modalutils.js`
   - Removes ~50 lines duplication

### File Sizes After Split
```
livedata.js  ~380 lines  (pure data layer, easy to test)
liveui.js    ~420 lines  (UI + interaction, depends on livedata)
browser.js   ~700 lines  (keep as-is for now)
player.js    ~260 lines
player-mix.js ~390 lines
mixes.js     ~290 lines
queue.js     ~200 lines
core.js      ~170 lines
─────────────────────────
Total:      ~2860 lines (same total, better organized)
```

### Maintainability Improvements
✅ Largest file reduced from 850 → 420 lines  
✅ Clear separation: data layer vs UI layer  
✅ Linear dependency flow maintained  
✅ Both SPAs work independently  
✅ No build tool needed  
✅ Easy to debug livedata.js in isolation  
✅ Future-proof: browser.js can split similarly if it grows  

---

## Why NOT Split browser.js Now?

1. **Still manageable** - 703 lines is large but readable
2. **Mixed concerns less tangled** - Mix browser, search, and settings aren't as interdependent as stream management + UI
3. **Split would be more complex** - 3-way split (mix browser + search + settings) creates more coordination overhead
4. **Cleaner to split later** - Once we split live.js, we can apply same pattern to browser.js if needed
5. **Dependency becomes clearer** - If browser.js needs livedata.js to access live data, a split would be easier to design

**Future option:** If browser.js reaches 1000+ lines:
```
browsermix.js    (mix browser UI)
browsersearch.js (search UI + logic)
browser-shared.js (settings, help, browserModes coordinator)
```

But that's a future decision.

