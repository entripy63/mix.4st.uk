# Player.js Split Plan

## Overview
Split `player.js` (1752 lines) into 5 separate files with simple script loading order (no bundler needed).

**Load Order in HTML:**
```html
<script src="core.js"></script>        <!-- Utilities, state -->
<script src="mixes.js"></script>       <!-- Mix data loading (already separate) -->
<script src="queue.js"></script>       <!-- Queue management -->
<script src="player.js"></script>      <!-- Playback controls -->
<script src="browser.js"></script>     <!-- Mix browser & live streams -->
```

---

## File 1: core.js (LINES 1-103 from player.js)

**Purpose:** Shared utilities and global state used by all other modules

**Contains:**
- `escapeHtml()` - L1-4
- `storage` object - L6-30 (localStorage abstraction)
- DOM element references (audio, waveform, controls) - L32-34
- `state` object (shared global state) - L36-57
- `mixFlags` object (favourites/hidden) - L60-97
- `updateFavouritesButton()` - L99-102

**Dependencies:** None

**Used by:** All other modules

**Notes:**
- `state` object contains all mutable app state (queue, current mix, live stream info)
- `storage` is the only localStorage accessor
- DOM refs are created here so all modules can access them


---

## File 2: queue.js (LINES 464-926 from player.js)

**Purpose:** Queue management, track ordering, drag-and-drop

**Contains:**
- `generateQueueId()` - L464-469
- `showToast()` - L475-483
- `saveQueue()` - L485-494
- `updateQueueInfo()` - L776-788
- `displayQueue()` - L789-820
- `onDragStart()`, `onDragOver()`, `onDrop()`, `onDragEnd()` - L822-854
- `clearQueue()` - L856-861
- `shuffleQueue()` - L863-874
- `toggleLoop()` - L876-880
- `calculateTotalDuration()` - L882-896
- `skipNext()` - L898-902
- `skipPrev()` - L904-908
- `playFromQueue()` - L910-914 ⚠️ **CALLS player.playMix()**
- `removeFromQueue()` - L916-925

**DOM Elements Needed from HTML:**
- `#queue` - queue display container

**Dependencies:**
- `core.js` (state, storage, escapeHtml, updateFavouritesButton)
- Uses `playMix()` from player.js

**Used by:**
- player.js (calls `playFromQueue()` on playback end)
- browser.js (calls `addToQueue()`, `displayQueue()` after adding mixes)

**Notes:**
- `displayQueue()` calls `playFromQueue()` via onclick handler
- `saveQueue()` updates `state.queue` and localStorage


---

## File 3: player.js (LINES 104-631 from original)

**Purpose:** Audio playback controls and waveform rendering

**Contains:**
- Waveform functions - L105-225
  - `resizeWaveformCanvas()`, `drawWaveform()`, `updateWaveformCursor()`, `startResize()`, `doResize()`, `stopResize()`, `loadPeaks()`
- Audio control UI - L227-333
  - `updateTimeDisplay()`, `updatePlayPauseBtn()`, `updateMuteBtn()`
  - `pauseLive()`, `resumeLive()`, `playLive()`, `stopLive()`
- Audio element event handlers - L335-441
  - Play/pause/mute/volume handlers, ended event, timeupdate, metadata
- Core playback - L443-460, 595-620
  - `load()`, `play()`, `playMix()`, `playNow()`
- Track list display - L633-707
  - `displayTrackList()`, `toggleCurrentFavourite()`, `toggleCurrentHidden()`

**DOM Elements Needed:**
- `#audioPlayer`, `#waveform`, `#playPauseBtn`, `#muteBtn`, `#volumeSlider`, `#timeDisplay`
- `#nowPlaying`, `#coverArt`, `#trackList`

**Dependencies:**
- `core.js` (state, storage, escapeHtml, formatTime)
- `mixes.js` (fetchDJMixes, fetchMixDetails)
- Uses `displayQueue()` from queue.js
- Uses `displayQueue()` from queue.js

**Used by:**
- browser.js (calls `playNow()` from mix list)
- queue.js (calls `playMix()` on queue playback)

**Notes:**
- `playNow()` at L622 calls functions from browser.js - needs refactoring
- Live stream functions are separate concern that could move to browser.js later


---

## File 4: browser.js (LINES 496-1752 from original)

**Purpose:** Mix browser, DJ selection, search, live streams, discovery modes

**Contains:**
- DJ/Mix browser - L496-768
  - `loadDJ()`, `updateDJButtons()`, `displayGroupFilters()`, `updateFilterButtons()`, `applyFilter()`, `getMixId()`, `displayMixList()`, `toggleMixInfo()`, `addAllToQueue()`, `addToQueue()`, `refreshBrowserList()`, `displayFavourites()`, `getDJName()`
- Live streams - L967-1294
  - `STREAM_PROXY`, `BUILTIN_STREAM_DEFS`
  - `getUserStreams()`, `saveUserStreams()`, `addUserStream()`, `removeUserStream()`, `probeAndAddStream()`
  - `initializeBuiltinStreams()`, `getLiveStreamConfig()`
  - `liveStreams`, `liveStreamsInitialized`
  - `probeStream()`, `parsePLS()`, `parseM3U()`, `fetchPlaylist()`, `initLiveStreams()`, `displayLiveStreams()`, `playLiveStream()`, `toggleAddStreamForm()`, `handleAddStream()`, `handleRemoveStream()`
- Browser modes - L1296-1370
  - `browserModes` object (switch between DJ, All, Favorites, Live, Search)
- Search - L928-962, 1383-1505
  - `searchIndex` object
  - `displaySearchResults()`, `displayMixListWithDJ()`, `toggleSearchMixInfo()`, `addSearchResultToQueue()`, `addAllSearchResultsToQueue()`, `playSearchResult()`
- UI modals - L1541-1586
  - `showSettings()`, `hideSettings()`, `updateSetting()`, `updateShowHiddenMixes()`
  - `showHelp()`, `hideHelp()`

**DOM Elements Needed:**
- `#mixBrowser`, `#browserModeSelector`, `#mixList`
- `#djDropdown`, `#searchInput`
- `#settingsModal`, `#helpModal`, `#showHiddenMixesCheckbox`

**Dependencies:**
- `core.js` (state, storage, escapeHtml, mixFlags)
- `mixes.js` (getActiveDJs, loadMixes, searchMixes)
- `queue.js` (addToQueue, displayQueue)
- `player.js` (playNow) ⚠️ CALLS `playNow()`

**Used by:**
- None (terminal module)

**Notes:**
- Large module with 3 distinct concerns: mix browser, live streams, search
- Could be split further later if needed
- `playNow()` call at L1503 - needs player.js to be loaded first
- Handles mode switching which coordinates all other modules


---

## File 5: Extract from original player.js to keep

**Lines to DELETE (moved to core.js):** 1-103

**Lines to DELETE (moved to queue.js):** 464-926

**Lines to DELETE (moved to player.js):** 104-631

**Lines to DELETE (moved to browser.js):** 496-768, 927-1752

**Lines to DELETE (moved to mixes.js):** None - already separate

**Lines to KEEP in player.js:** 
- L32-34: DOM element refs (moved to core.js actually)
- Actually, NEW player.js is much smaller

---

## DOM Requirements by File

### HTML needs these IDs for each file:

**core.js:**
- (none - state only)

**queue.js:**
- `#queue`

**player.js:**
- `#audioPlayer` (audio element)
- `#waveform` (canvas)
- `#waveformResizeHandle` (resize grip)
- `#playPauseBtn`, `#muteBtn`, `#volumeSlider`, `#timeDisplay`
- `#nowPlaying`, `#coverArt`, `#trackList`

**browser.js:**
- `#mixBrowser`, `#browserModeSelector`, `.mode-btn` buttons
- `#mixList` (main content area)
- `#djDropdown`, `#newStreamName`, `#newStreamM3U`, `#newStreamGenre`
- `#settingsModal`, `#helpModal`, `#addStreamFields`

---

## Call Graph

```
core.js
  └── (no dependencies)

queue.js
  ├── uses: core.js (state, storage)
  └── calls: player.playMix()

player.js
  ├── uses: core.js (state, storage, formatTime)
  ├── uses: mixes.js (fetchMixDetails)
  └── calls: queue.displayQueue()

browser.js
  ├── uses: core.js (state, storage, escapeHtml, mixFlags)
  ├── uses: mixes.js (loadMixes, searchMixes)
  ├── uses: queue.js (addToQueue, displayQueue)
  └── calls: player.playNow()
```

---

## Detailed Line Number Reference

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                    PLAYER.JS SPLIT - LINE NUMBER REFERENCE                   ║
╚══════════════════════════════════════════════════════════════════════════════╝

CURRENT: player.js (1752 lines)

core.js (~100 lines) FROM ORIGINAL L1-103
─────────────────────────────────────────
• escapeHtml()                                      L1-4
• storage object                                    L6-30
• DOM element refs (audio, waveform)                L32-34
• state object (global mutable state)               L36-57
• mixFlags (favourites/hidden management)           L60-97
• updateFavouritesButton()                          L99-102

queue.js (~300 lines) FROM ORIGINAL L464-926
─────────────────────────────────────────────
• generateQueueId()                                 L464-469
• showToast()                                       L475-483
• saveQueue()                                       L485-494
• updateQueueInfo()                                 L776-788
• displayQueue()                                    L789-820 (CORE UI)
• onDragStart/Over/Drop/End()                       L822-854 (INTERACTIONS)
• clearQueue(), shuffleQueue(), toggleLoop()        L856-880
• calculateTotalDuration()                          L882-896
• skipNext(), skipPrev()                            L898-908
• playFromQueue()                                   L910-914 (CALLS PLAYER)
• removeFromQueue()                                 L916-925

player.js (~350 lines) FROM ORIGINAL L104-631
────────────────────────────────────────────
Waveform: resizeWaveformCanvas() L105-114, drawWaveform() L118-146,
          updateWaveformCursor() L148-153, startResize/doResize/stopResize() L186-215,
          loadPeaks() L217-225

Controls: updateTimeDisplay() L250-261, updatePlayPauseBtn() L264-268,
          updateMuteBtn() L271-279

Live: pauseLive() L282-290, resumeLive() L292-301, playLive() L303-319,
      stopLive() L322-333 (LIVE STREAM)

Events: play/pause/mute/volume handlers L335-441, ended event L369-441

Core: load() L443-460, play() L457-460, playMix() L595-620 (CORE),
      playNow() L622-631 (FROM BROWSER)

Track: displayTrackList() L633-684, toggleCurrentFavourite() L686-697,
       toggleCurrentHidden() L698-708

browser.js (~1000 lines) FROM ORIGINAL L496-1752
─────────────────────────────────────────────────
MIX BROWSER: loadDJ() L496-502, updateDJButtons() L504-508,
             displayGroupFilters() L510-523, updateFilterButtons() L525-529,
             applyFilter() L531-536, getMixId() L538-540,
             displayMixList() L542-570 (CORE UI), toggleMixInfo() L571-576,
             addAllToQueue() L578-584, addToQueue() L586-593,
             refreshBrowserList() L710-720, displayFavourites() L722-767,
             getDJName() L769-774

SEARCH: searchIndex object L928-962, displaySearchResults() L1396-1429,
        displayMixListWithDJ() L1432-1465, toggleSearchMixInfo() L1467-1472,
        addSearchResultToQueue() L1474-1481, addAllSearchResultsToQueue() L1483-1489,
        playSearchResult() L1491-1504 (CALLS PLAYER)

BROWSER MODES: browserModes object L1296-1370 (COORDINATOR)

LIVE STREAMS: STREAM_PROXY L967, BUILTIN_STREAM_DEFS L971-974,
              getUserStreams() L978-980, saveUserStreams() L982-984,
              addUserStream() L986-996, probeAndAddStream() L999-1072 (ASYNC),
              removeUserStream() L1074-1083, initializeBuiltinStreams() L1086-1094,
              getLiveStreamConfig() L1097-1099, liveStreams/liveStreamsInitialized L1102-1104,
              probeStream() L1106-1128, parsePLS() L1131-1153, parseM3U() L1155-1173,
              fetchPlaylist() L1176-1187, initLiveStreams() L1191-1199 (INIT),
              displayLiveStreams() L1201-1254 (CORE UI), toggleAddStreamForm() L1258-1260,
              handleAddStream() L1263-1280, handleRemoveStream() L1282-1287,
              playLiveStream() L1289-1294

MODALS: showSettings() L1541-1547, hideSettings() L1551-1553,
        updateSetting() L1555-1557, updateShowHiddenMixes() L1559-1570,
        showHelp() L1578-1580, hideHelp() L1582-1584

OTHER: Keyboard shortcuts L1507-1532, File input L1591-1615,
       checkAudioSupport() L1623-1635, guessMimeType() L1638-1650,
       probeAudioPlayback() L1651-1677, restorePlayer() L1689-1755 (INIT)

HTML LOAD ORDER:
<script src="core.js"></script>      <!-- utilities & state (no deps) -->
<script src="mixes.js"></script>     <!-- mix loading (already separate) -->
<script src="queue.js"></script>     <!-- queue mgmt (needs core, mixes) -->
<script src="player.js"></script>    <!-- playback (needs core, mixes) -->
<script src="browser.js"></script>   <!-- browser (needs all above) -->
```

---

## Migration Steps

1. Create `core.js` with lines 1-103 (utilities & state)
2. Create new `queue.js` with queue-related functions
3. Update `player.js` to keep only playback functions
4. Create `browser.js` with browser/browser/live/search functions
5. Update `player.html` to load scripts in order:
   ```html
   <script src="core.js"></script>
   <script src="mixes.js"></script>
   <script src="queue.js"></script>
   <script src="player.js"></script>
   <script src="browser.js"></script>
   ```
6. Test thoroughly - especially:
   - Adding to queue
   - Playing from queue
   - Playing Now from browser
   - Adding live streams
   - Switching browser modes

---

## Benefits of Split

✅ Smaller files = easier to maintain and understand
✅ Clear separation of concerns
✅ Each file ~200-400 lines (vs 1752)
✅ No build tool needed
✅ Dependency flow is linear (no circular deps)
✅ Each module can be tested/debugged independently
✅ Future refactoring easier (e.g., split browser.js into browser-mixes.js + browser-live.js)
