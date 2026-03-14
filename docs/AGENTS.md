# AGENTS.md

## Documentation
- **[ASSETS.md](ASSETS.md)** — Comprehensive asset documentation (HTML, CSS, JavaScript modules, data files)
- **[PROXY.md](PROXY.md)** — Stream proxy architecture, deployment, and configuration
- This file — Development instructions and architecture overview

## Build/Test/Deploy Commands
- No build system - static HTML/CSS website
- DON'T USE `python3 -m http.server 8000` to test locally, too flakey
- **ESLint**: `npm run lint` — syntax checking, `npm run lint:fix` — auto-fix formatting
- ./tools/deploy.sh [target]
- Targets: test, prod, test-backup, prod-backup, all-test, all-prod

## Architecture
- Static website with a single SPA (player.html)

### player.html
- **Location**: https://mixes.4st.uk
- **Layout**: Player, Queue/User Streams (tabbed), Browser columns, responsive design
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

### Stylesheets
- `common.css` - Shared colors, layout, modals, buttons
- `player.css` - Waveform, queue, browser columns, responsive layout

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
- `generate-streams-manifest.py` - Run after uploading streams to `/streams/` directory to regenerate `manifest.json` for stream presets

## Important Design Principles
- **Guard Callbacks**: When stream operations could interfere with other browser tabs, use `shouldRedisplayStreams()` guard to prevent unwanted redisplays
- **Simple Module Loading**: No bundler — script order matters. Check player.html `<script>` tags for load order
- **Callback Pattern**: Use callbacks (not monkey-patching) for cross-module behavior (see livedata.js `shouldRedisplayAfterProbe` pattern)

## UI Conventions
- **No browser alerts**: Never use `alert()` — use `showAlertDialog(title, message)` from core.js for informational messages and `showConfirmDialog(title, message)` for destructive confirmations. Both use the in-app modal styling.

## Code Style
- HTML: HTML5 doctype, UTF-8, 2-space indent, external stylesheet
- JavaScript: ESLint configured, run `npm run lint` before pushing
- Track lists: `.tracks.txt` CSV files with format `time,title,artist[,remixer]`

## Git
- Remote: git@github.com:entripy63/mix.4st.uk.git
- Push: `git push origin main`
