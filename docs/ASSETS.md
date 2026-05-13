# Assets Documentation

## HTML Entry Points

### player.html
- **Purpose**: Main DJ mix player SPA (mixes.4st.uk)
- **Layout**: 3 columns (player, queue/user-streams tabbed, browser)
- **Features**: Mix playback, queue management, search, live streams, settings
- **Responsive**: Yes (mobile, tablet, desktop)

---

## Stylesheets

### common.css
- **Purpose**: Shared styling
- **Used by**: player.html
- **Contains**: Colors, layout grid, modals, buttons, responsive design

### player.css
- **Purpose**: Styling specific to player.html
- **Size**: Waveform, queue, browser columns, responsive layout
- **Depends on**: common.css

---

## JavaScript Modules

### Core Modules (Shared)

#### core.js (140 lines)
- **Purpose**: Shared utilities, global state, DOM references
- **Used by**: All modules
- **Functions**: UI helpers, event handling, DOM utilities, state management

#### player.js (250+ lines)
- **Purpose**: Playback controls, waveform rendering, audio handling
- **Dependencies**: core.js
- **Used by**: player.html
- **Features**: Play/pause, volume, progress, waveform display

### Player-Specific Modules

#### mixes.js
- **Purpose**: Load mix data from `manifest.json` files
- **Used by**: player.html
- **Data Source**: DJ folder manifest files

#### queue.js
- **Purpose**: Queue management, drag-drop operations
- **Dependencies**: core.js
- **Used by**: player.html
- **Features**: Add/remove tracks, reorder, shuffle

#### stream-player.js
- **Purpose**: IcecastMetadataPlayer wrapper for stream playback (MSE)
- **Dependencies**: core.js, player.js
- **Used by**: player.html
- **Features**: Stream play/stop, ICY metadata events, error handling with restart limits

#### visualiser.js
- **Purpose**: Audio visualisation overlay (spectrum, waveform, spectral flux, autocorrelation)
- **Dependencies**: core.js
- **Used by**: player.html
- **Features**: Real-time analyser rendering on overlay canvas, multiple visualiser modes, works for both DJ mixes and streams

#### tempo.js
- **Purpose**: BPM detection via spectral flux autocorrelation (main thread coordinator)
- **Dependencies**: core.js (storage, aud, audioCtx, analyserNode)
- **Used by**: player.html
- **Features**: Spectral flux computation (log-compressed), Web Worker lifecycle (start/pause/resume/stop), BPM display updates

#### tempo-worker.js
- **Purpose**: Web Worker for BPM autocorrelation and subharmonic summation
- **Dependencies**: None (standalone worker)
- **Used by**: tempo.js (via `new Worker()`)
- **Features**: Autocorrelation with EMA smoothing, subharmonic summation (SHS), division detection (halving/thirding), periodicity detection (4-beat vs 6-beat), sub-sample peak refinement, adaptive sample rate

#### player-mix.js (300 lines)
- **Purpose**: Mix-specific playback logic extracted from player.js
- **Dependencies**: core.js, player.js, visualiser.js
- **Used by**: player.html
- **Features**: Track switching, queue integration

#### history.js
- **Purpose**: Play history tracking and resume
- **Dependencies**: core.js, player.js, player-mix.js
- **Used by**: player.html
- **Features**: Record/display recently played mixes and streams, resume from history with position, periodic position updates (30s), deduplication, max 20 entries

#### ping.js
- **Purpose**: Lightweight usage tracking via sendBeacon
- **Dependencies**: core.js (storage)
- **Used by**: player.html
- **Features**: Anonymous nickname generation, daily-deduplicated beacons, debounced search tracking

#### queuestore.js
- **Purpose**: Queue collection persistence (save/load to .mixes files)
- **Dependencies**: core.js, queue.js, modals.js
- **Used by**: player.html
- **Features**: Export queue to .mixes file with metadata modal, import with deduplication

#### browser.js
- **Purpose**: DJ/All/Favorites browser modes, mode switching, keyboard shortcuts
- **Dependencies**: core.js, mixes.js
- **Used by**: player.html
- **Features**: Mode tabs, DJ selection, filtering, keyboard shortcuts (Ctrl+D/A/F/V/L)

#### search.js
- **Purpose**: Search functionality and results display
- **Dependencies**: core.js, mixes.js
- **Used by**: player.html
- **Features**: Search index querying, result rendering, sorting

#### tips.js
- **Purpose**: Data-driven tip popover system
- **Dependencies**: core.js (storage)
- **Used by**: player.html
- **Features**: Tip registry mapping IDs to HTML content, shared popover element, auto-injection of 💡 buttons via `data-tip` attributes, show/hide respects `showTips` setting

#### settings.js
- **Purpose**: Settings and Help modal UI
- **Dependencies**: core.js (storage, state), ping.js, visualiser.js, tempo.js, player.js, tips.js
- **Used by**: player.html
- **Features**: Settings modal (tips, BPM, visualiser, timed fades, column hiding, nickname, hidden mixes), Help modal, What's New version dot, timed fade scheduling UI

#### restore.js
- **Purpose**: Page state restoration on page load
- **Dependencies**: core.js, browser.js
- **Used by**: player.html
- **Features**: Restore mix playback, browser mode, search query, DJ selection, filters

### Live Streaming Modules

#### livedata.js
- **Purpose**: Live stream data management, probing, persistence
- **Dependencies**: core.js
- **Used by**: player.html
- **Features**:
  - Stream probing (timeout handling)
  - Playlist parsing (M3U, PLS)
  - Audio detection
  - SomaFM stream parsing
  - Persistent storage (localStorage)
  - Proxy-based CORS handling

#### livestore.js
- **Purpose**: Stream collection persistence (save/load/clear)
- **Dependencies**: core.js, livedata.js, modals.js
- **Used by**: player.html
- **Features**:
  - Save streams to JSON file (with metadata modal)
  - Load streams from JSON file
  - Clear all streams (with confirmation)
  - Collection metadata tracking (name, category)

#### liveui.js
- **Purpose**: Live stream UI rendering and interactions
- **Dependencies**: core.js, livedata.js, modals.js
- **Used by**: player.html
- **Features**:
  - User stream list rendering (`displayLiveStreams()` → targets `#userStreamsList`)
  - Middle column tab switching (`switchMiddleTab()` — Mix Queue / User Streams)
  - Preset browser (`buildPresetDropdown()`, `displayPresetStreams()`) for browsing streams by preset
  - Per-stream actions: play from preset, add to user streams
  - Drag-drop reordering of user streams
  - Stream editing (name, genre)
  - Collections menu
  - Display guard (`shouldRedisplayStreams()`)
  - Preset category buttons

#### modals.js
- **Purpose**: Modal dialogs and confirmation UI
- **Dependencies**: core.js
- **Used by**: player.html
- **Features**: Confirmation dialogs, playlist guide, presets menu

---

## Data Files

### manifest.json (per DJ folder)
- **Purpose**: List of tracks, cover art, metadata for each DJ
- **Location**: `mixes/trip/`, `mixes/izmar/`, `mixes/aboo/`, `mixes/jx3p/`, `mixes/gmanual/`, `mixes/haze/`, `mixes/rpfr/` (main DJs), or `mixes/moreDJs/*/` (additional DJs)
- **Format**: JSON with track metadata
- **Note**: Two-level directory structure is intentional. Main DJs go in `mixes/`, others go in `mixes/moreDJs/`

### .tracks.txt (per DJ folder)
- **Purpose**: Human-readable track list with timestamps
- **Format**: CSV with `time,title,artist[,remixer]`

### .peaks.json (per DJ folder)
- **Purpose**: Waveform data for audio visualization
- **Generated by**: `generate-peaks.py`

### search-index.json
- **Purpose**: Search index for mix discovery
- **Generated by**: `generate-search-index.py`

### audio-source-config.json
- **Purpose**: Configuration for external audio sources

### streams/proxy-config.json
- **Purpose**: Stream proxy routing configuration (named vs raw-IP streams)
- **Format**: JSON array of proxy endpoints with capability tags
- **See**: [PROXY.md](PROXY.md) for full documentation

---

## Configuration & Metadata

### .htaccess
- **Purpose**: DirectoryIndex configuration, MP3 download forcing
- **Location**: Root directory

### AGENTS.md
- **Purpose**: Project architecture and build instructions
- **Audience**: Developers, automated systems

---

## Python Scripts

⚠️ **IMPORTANT**: These scripts can take **many hours** to run on the entire collection (7-10+ hours). You almost never want to process all folders. **Only process newly added DJ folders** to keep runtime manageable.

### Audio Source Configuration

Audio files are stored separately from the generated metadata (manifests, peaks, etc.). Their location is defined in `mixes/audio-source-config.json`:

```json
{
  "source_directory": "/path/to/audio/mixes",
  "main_djs": ["trip", "haze", "izmar", ...]
}
```

The scripts automatically read this config and process audio from the source directory, writing generated artifacts (manifest.json, .peaks.json, etc.) to the local DJ folders.

### Understanding DJ Folder Structure

**All generate scripts process BOTH directory levels:**
- `mixes/` — Main DJ folders (trip, haze, izmar, rpfr, aboo, jx3p, gmanual)
- `mixes/moreDJs/` — Additional DJ folders (estimulo, claptone, Mushroom Boyz, Various, etc.)

This two-level structure is **intentional** and has meaning for the JavaScript apps. **Do NOT move folders between these directories.**

### Usage

**Process specific DJ folders only** (RECOMMENDED):
```bash
# Process only newly added folders (manifest goes to correct location: mixes/ or mixes/moreDJs/)
./tools/generate-manifest.py mixes "Mushroom Boyz" Various
./tools/generate-covers.py mixes "Mushroom Boyz" Various
./tools/generate-peaks.py mixes "Mushroom Boyz" Various
cd mixes && ../tools/generate-search-index.py .
```

**Process all folders** (NOT recommended - takes 7-10+ hours):
```bash
./tools/generate-manifest.py .
./tools/generate-covers.py .
./tools/generate-peaks.py .
./tools/generate-search-index.py
```

**Override audio source location** (if needed):
```bash
./tools/generate-manifest.py --source /alternate/audio/path .
```

### Individual Scripts

#### generate-covers.py
- **Purpose**: Extract embedded cover art images from audio files
- **Input**: Reads audio from `source_directory` (defined in config)
- **Output**: `.jpg`, `.png`, `.bmp`, `.gif` files in DJ folders
- **Run**: Once when adding new DJ folders or to extract covers from newly added audio
- **Performance**: Fast (image extraction is quick)

#### generate-manifest.py
- **Purpose**: Regenerate `manifest.json` in each DJ folder with track metadata
- **Input**: Audio file metadata (title, duration, artist, etc.)
- **Output**: `manifest.json` with list of mixes and their properties
- **Run**: After adding/updating audio files
- **Performance**: Medium (metadata extraction via ffprobe)

#### generate-peaks.py
- **Purpose**: Generate `.peaks.json` waveform data for audio visualization
- **Input**: Audio files (reads raw samples via ffmpeg)
- **Output**: `.peaks.json` with normalized waveform data (4000 samples per mix)
- **Run**: After adding audio files
- **Performance**: SLOW - This is the bottleneck. Can take 2-3 seconds per mix.
- **Note**: Skips if `.peaks.json` already exists

#### generate-search-index.py
- **Purpose**: Regenerate `search-index.json` for search functionality
- **Input**: All `manifest.json` files
- **Output**: `search-index.json` (consolidated search index)
- **Run**: After any manifest changes
- **Performance**: Fast (reads existing manifests, no audio processing)

#### generate-streams-manifest.py
- **Purpose**: Regenerate `manifest.json` for stream presets in `/streams/` directory
- **Input**: JSON stream files in `/streams/` directory
- **Output**: `streams/manifest.json` (consolidated stream metadata)
- **Run**: After uploading new stream files to `/streams/`
- **Performance**: Very fast (simple JSON parsing)

#### fix-metadata.py
- **Purpose**: Metadata cleanup and validation
- **Run**: As needed for data corrections

---

## Architecture Diagram

### player.html Load Order
```
core.js           (shared: state, storage, utilities, Web Audio graph)
ping.js           (usage tracking, sendBeacon)
mixes.js          (load mix manifests)
queue.js          (queue management)
queuestore.js     (queue save/load to file)
stream-player.js  (IcecastMetadataPlayer wrapper for streams)
player.js         (audio playback engine)
tempo.js          (BPM detection, spawns tempo-worker.js Web Worker)
visualiser.js     (audio visualisation overlay)
player-mix.js     (mix-specific playback)
history.js        (play history tracking and resume)
livedata.js       (stream data, probing, parsing)
modals.js         (modal dialogs)
livestore.js      (collection persistence)
liveui.js         (stream UI, rendering)
search.js         (search index, results)
tips.js           (data-driven tip popovers)
settings.js       (settings & help modals, timed fades)
browser.js        (DJ/All/Favorites modes, filtering)
restore.js        (restore state on page load)
player.html       (3-column SPA layout)
```

### Dependency Graph (Simplified)
```
player.html
    ↓
core.js ←─ (used by all modules)
    ↓
ping.js ←─ (usage tracking)
    ↓
player.js ←─ (playback engine)
    ↓
tempo.js ←─ (BPM detection, spawns tempo-worker.js)
    ↓
player-mix.js ←─ (mix-specific playback)
    ↓
history.js ←─ (play history tracking)
    ↓
livedata.js ←─ (stream management, probing)
    ↓
modals.js ←─ (dialogs)
    ↓
livestore.js ←─ (collection persistence)
    ↓
liveui.js ←─ (stream rendering, guards)
    ↓
player.html adds: mixes.js → queue.js → queuestore.js → search.js → tips.js → settings.js → browser.js → restore.js
```

---

## Directory Structure

```
/
├── HTML Entry Point
│   └── player.html          # Main DJ mix player SPA (mixes.4st.uk)
│
├── Stylesheets
│   ├── common.css           # Colors, layout, modals, buttons
│   └── player.css           # Player-specific: waveform, queue, columns
│
├── JavaScript Modules
│   ├── core.js             # Global state, storage, utilities
│   ├── ping.js             # Usage tracking (sendBeacon)
│   ├── player.js           # Audio playback, controls, waveform
│   ├── stream-player.js    # IcecastMetadataPlayer wrapper
│   ├── tempo.js            # BPM detection (main thread)
│   ├── tempo-worker.js     # BPM detection (Web Worker)
│   ├── visualiser.js       # Audio visualisation overlay
│   ├── history.js          # Play history tracking and resume
│   ├── livedata.js         # Stream probing, parsing, persistence
│   ├── livestore.js        # Collection persistence (save/load/clear)
│   ├── liveui.js           # Stream rendering, drag-drop, guards
│   ├── modals.js           # Modal dialogs, confirmations, help
│   ├── tips.js             # Data-driven tip popovers
│   └── settings.js         # Settings & help modals, timed fades
│
├── player.html-Specific Modules
│   ├── mixes.js            # Load DJ manifests
│   ├── queue.js            # Queue management
│   ├── queuestore.js       # Queue save/load to file
│   ├── player-mix.js       # Mix-specific playback logic
│   ├── browser.js          # Browser modes (DJ/All/Favorites)
│   ├── search.js           # Search functionality
│   └── restore.js          # State restoration on load
│
├── Configuration & Metadata
│   ├── package.json         # npm config, ESLint, scripts
│   ├── eslint.config.js     # Linter configuration
│   ├── .eslintrc.json       # (deprecated, replaced by eslint.config.js)
│   ├── search-index.json    # Generated search index
│   ├── audio-source-config.json  # Audio source config
│   └── .htaccess           # Server: DirectoryIndex, MP3 forcing
│
├── DJ Folders (contain mix data)
│   ├── trip/               # DJ folder (manifest.json, .tracks.txt, cover.jpg, .peaks.json)
│   ├── izmar/
│   ├── aboo/
│   ├── jx3p/
│   ├── gmanual/
│   ├── haze/
│   ├── rpfr/
│   └── moreDJs/            # Additional DJ folders
│       ├── Aaron Ross/
│       ├── Andy Grant/
│       └── ...
│
├── Documentation
│   ├── docs/
│   │   ├── AGENTS.md       # Architecture, modules, design principles
│   │   ├── ASSETS.md       # This file
│   │   └── (other docs)
│   └── tools/              # Various analysis/reference docs
│
└── Python Build Scripts
    ├── generate-covers.py           # Extract cover art from MP3s
    ├── generate-manifest.py         # Generate DJ manifests
    ├── generate-peaks.py            # Generate waveform data
    ├── generate-search-index.py     # Generate search index
    ├── generate-streams-manifest.py # Generate stream presets manifest
    └── (other utilities)
```

---

## Development Workflow

1. **Add DJ Folder**: Create new folder under `mixes/` (main DJs) or `mixes/moreDJs/` (additional DJs). Keep it in the appropriate directory — **do not move between directories**.
2. **Generate Metadata** (specific folders only):
   - `./tools/generate-manifest.py . "NewDJ"`
   - `./tools/generate-covers.py . "NewDJ"`
   - `./tools/generate-peaks.py . "NewDJ"`
3. **Update Search Index**: `./tools/generate-search-index.py` (automatically scans both `mixes/` and `mixes/moreDJs/`, runs on all manifests)
4. **Test**: Load `player.html` in browser
5. **Commit & Deploy**: Push to git, deploy to server

⚠️ **Performance Tip**: By passing DJ folder names to the scripts, you only process new content. Processing the entire collection takes 7-10+ hours.

⚠️ **Directory Structure**: The two-level structure (`mixes/` and `mixes/moreDJs/`) is intentional and has meaning for the JavaScript apps. All generate scripts understand both levels. Do not move folders between directories.

---

## File Sizes & Performance

| File | Size | Purpose |
|------|------|---------|
| **player.html** | ~5KB | Main entry point (DJ mixes SPA) |
| **common.css** | ~35KB | Shared styling |
| **player.css** | ~40KB | Player-specific styling |
| **core.js** | ~6KB | Shared utilities, state |
| **player.js** | ~25KB | Playback engine, waveform |
| **player-mix.js** | ~12KB | Mix-specific playback |
| **queue.js** | ~18KB | Queue management, drag-drop |
| **mixes.js** | ~4KB | DJ manifest loading |
| **browser.js** | ~12KB | Browser modes, keyboard shortcuts |
| **search.js** | ~8KB | Search functionality |
| **restore.js** | ~2KB | State restoration |
| **tempo.js** | ~6KB | BPM detection (main thread) |
| **tempo-worker.js** | ~17KB | BPM detection (Web Worker) |
| **history.js** | ~9KB | Play history and resume |
| **ping.js** | ~2KB | Usage tracking |
| **queuestore.js** | ~5KB | Queue save/load to file |
| **livedata.js** | ~11KB | Stream probing, parsing |
| **livestore.js** | ~5KB | Collection persistence |
| **liveui.js** | ~10KB | Stream rendering, UI |
| **modals.js** | ~8KB | Modal dialogs |
| **tips.js** | ~9KB | Tip popovers |
| **settings.js** | ~6KB | Settings & help modals |
| **eslint.config.js** | <1KB | Linter config |
| **package.json** | <1KB | npm config |
| **Total JS (player.html)** | **~170KB** | Uncompressed |
| **Total CSS** | **~95KB** | Uncompressed |
| **Total (player.html)** | **~270KB** | JS + CSS + HTML |

---

## Hosting

### mixes.4st.uk (DJ Mixes SPA)
- **Entry Point**: player.html
- **JavaScript Modules**: core, ping, mixes, queue, queuestore, stream-player, player, tempo, visualiser, player-mix, history, livedata, modals, livestore, liveui, search, tips, settings, browser, restore
- **Stylesheets**: common.css, player.css
- **Data**: DJ folders with manifests, track lists, cover art, waveform data
- **Size**: ~200MB+ (includes all DJ music archives)
- **Features**: Full player with queue, mix browser, search, live streams, state restoration

---

## Important Design Notes

### Code Sharing
- **core.js & player.js**: Shared utilities and playback engine
- **livedata.js, livestore.js & liveui.js**: Live streaming modules, designed to work independently of browser modes
- **modals.js**: Generic confirmation/dialog logic
- **tempo.js & tempo-worker.js**: BPM detection (main thread + Web Worker)
- **history.js**: Play history tracking and resume from history
- **ping.js**: Lightweight usage tracking
- **queuestore.js**: Queue collection file I/O
- **tips.js**: Tip popover system (data-driven, auto-injected icons)
- **settings.js**: Settings and Help modal UI, timed fade scheduling
- **player-mix.js, mixes.js, queue.js, browser.js, search.js, restore.js**: Player-specific modules

### Guard Callbacks
- **shouldRedisplayStreams()** in liveui.js prevents stream display updates from overwriting other browser tabs
- Implementation: Checks `browserModes.current === 'live'`
- Pattern: Pass callback config to functions that loop over streams

### Script Loading Order
- Simple sequential loading (no bundler)
- Order matters: core.js must load first, then dependencies, then entry point
- Check `<script>` tags in player.html for correct order

### No External Dependencies
- Vanilla JavaScript only
- ESLint for syntax checking (dev only, not shipped)
- npm used for tooling (linting), not for runtime dependencies
