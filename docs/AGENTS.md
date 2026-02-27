# AGENTS.md

## Documentation
- **[ASSETS.md](ASSETS.md)** — Comprehensive asset documentation (HTML, CSS, JavaScript modules, data files)
- This file — Development instructions and architecture overview

## Build/Test/Deploy Commands
- No build system - static HTML/CSS website
- DON'T USE `python3 -m http.server 8000` to test locally, too flakey
- **ESLint**: `npm run lint` — syntax checking, `npm run lint:fix` — auto-fix formatting
- ./tools/deploy.sh [target]
- Targets: mixes-test, mixes-prod, live-test, live-prod, all-test, all-prod

## Architecture
- Static website with two SPAs: DJ mixes (mixes.4st.uk) and live streams (live.4st.uk)
- Always remember the two SPAs when modifying code. i.e. don't add live stream stuff to browser.js which isn't part of both SPAs.

### player.html (DJ Mixes SPA)
- **Location**: mixes.4st.uk
- **Layout**: Landing page, Player, Queue/User Streams (tabbed), Browser columns, responsive design
- **Stylesheets**: `common.css`, `player.css`
- **JavaScript modules** (no bundler, simple script loading):
  - `core.js` - Shared utilities, global state, DOM references
  - `mixes.js` - Loads mix data from `manifest.json` files
  - `queue.js` - Queue management, drag-drop, queue operations
  - `player.js` - Playback controls, waveform rendering, audio handling
  - `player-mix.js` - Mix-specific playback logic
  - `livedata.js` - Live stream data management, probing, persistence
  - `modals.js` - Modal dialogs, settings, help, playlists
  - `livestore.js` - Stream collection persistence (save/load/clear)
  - `liveui.js` - Live stream UI rendering, preset browser, middle column tab switching
  - `browser.js` - DJ/All/Live/Favorites browser modes, mode switching, keyboard shortcuts
  - `search.js` - Search functionality and results display
  - `restore.js` - Page state restoration on load

### live.html (Live Streams SPA)
- **Location**: live.4st.uk (independent hosting)
- **Layout**: Single column, mobile-first
- **Stylesheets**: `common.css`, `live.css`
- **JavaScript modules**:
  - `core.js` - Shared utilities (same as player.html)
  - `player.js` - Playback controls (same as player.html)
  - `livedata.js` - Live stream data management, probing, persistence
  - `modals.js` - Modal dialogs, playlist guide
  - `livestore.js` - Stream collection persistence (save/load/clear)
  - `liveui.js` - Live stream UI rendering and interactions

### Shared Modules (Both SPAs)
- `core.js` - State object, storage helpers, utility functions
- `player.js` - Audio playback, controls, muting, live stream playback
- `livedata.js` - Stream probing, parsing (M3U/PLS), persistence
- `livestore.js` - Stream collection persistence (save/load/clear)
- `liveui.js` - Stream rendering, drag-drop reordering, collections menu
- `modals.js` - Confirmation dialogs, settings, help, playlist guide

### Stylesheets
- `common.css` - Shared colors, layout, modals, buttons (used by both SPAs)
- `player.css` - Waveform, queue, browser columns, responsive layout (player.html only)
- `live.css` - Mobile-first layout, stream list styling (live.html only)

### Data & Configuration
- All DJ content organized under `mixes/` container directory
- `mixes/trip/`, `mixes/izmar/`, `mixes/aboo/`, `mixes/jx3p/`, `mixes/gmanual/`, `mixes/haze/`, `mixes/rpfr/` - Main DJ folders
- `mixes/moreDJs/` - Additional DJ folders (estimulo, claptone, etc.)
- DJ folders contain `manifest.json`, `.tracks.txt` files, `.peaks.json` files, and cover images
- `mixes/audio-source-config.json` - External audio source configuration
- `mixes/search-index.json` - Generated search index
- `.htaccess` - DirectoryIndex and MP3 download forcing

**For complete asset documentation, see [ASSETS.md](ASSETS.md)**

## Python Scripts
⚠️ **Performance Tip**: By passing DJ folder names to the scripts, you only process new content. Processing the entire collection takes 7-10+ hours.
Generate covers and peaks before manifest so it can reference them.
- `generate-covers.py` - Run after adding audio files to extract embedded cover art images
- `generate-peaks.py` - Run after adding audio files to generate `.peaks.json` waveform data
- `generate-manifest.py` - Run after adding/updating audio files to regenerate `manifest.json` in each DJ folder
- `generate-search-index.py` - Run after manifest changes to regenerate `search-index.json` for search mode

## Important Design Principles
- **Two SPAs, Shared Code**: Code used by both player.html and live.html should not reference browserModes or mix-specific features
- **Guard Callbacks**: When stream operations could interfere with other browser tabs, use `shouldRedisplayStreams()` guard to prevent unwanted redisplays
- **Simple Module Loading**: No bundler — script order matters. Check player.html and live.html `<script>` tags for load order
- **Callback Pattern**: Use callbacks (not monkey-patching) for cross-module behavior (see livedata.js `shouldRedisplayAfterProbe` pattern)

## Code Style
- HTML: HTML5 doctype, UTF-8, 2-space indent, external stylesheet
- JavaScript: ESLint configured, run `npm run lint` before pushing
- Track lists: `.tracks.txt` CSV files with format `time,title,artist[,remixer]`

## Git
- Remote: git@github.com:entripy63/mix.4st.uk.git
- Push: `git push origin main`
