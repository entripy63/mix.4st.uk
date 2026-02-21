# AGENTS.md

## Documentation
- **[ASSETS.md](ASSETS.md)** — Comprehensive asset documentation (HTML, CSS, JavaScript modules, data files)
- This file — Development instructions and architecture overview

## Build/Test Commands
- No build system - static HTML/CSS website
- DON'T USE `python3 -m http.server 8000` to test locally, too flakey
- (axc) mirror -R -x .git/ -x .gitignore -x docs/ -x tools/
- (live) mirror -R --only-existing

## Architecture
- Static website with two SPAs: DJ mixes (mixes.4st.uk) and live streams (live.4st.uk)
- Always remember the two SPAs when modifying code. i.e. don't add live stream stuff to browser.js which isn't part of both SPAs.

### player.html (DJ Mixes SPA)
- **Location**: mixes.4st.uk
- **Layout**: Landing page, Player, Queue, Browser columns, responsive design
- **Stylesheet**: `player.css`
- **JavaScript modules** (no bundler, simple script loading):
  - `core.js` - Shared utilities, global state, DOM references
  - `mixes.js` - Loads mix data from `manifest.json` files
  - `queue.js` - Queue management, drag-drop, queue operations
  - `player.js` - Playback controls, waveform rendering, audio handling
  - `player-mix.js` - Mix-specific playback logic
  - `browser.js` - Mix browser, search, live streams, settings, page restoration

### live.html (Live Streams SPA)
- **Location**: live.4st.uk (independent hosting)
- **Layout**: Single column, mobile-first
- **Stylesheet**: `live.css`
- **JavaScript modules**:
  - `core.js` - Shared utilities (same as player.html)
  - `player.js` - Playback controls (same as player.html)
  - `live.js` - Live stream management, collections, drag-drop reordering

### Data & Configuration
- DJ folders contain `manifest.json`, `.tracks.txt` files, `.peaks.json` files, and cover images
- `trip/`, `izmar/`, `aboo/`, `jx3p/`, `gmanual/`, `haze/`, `rpfr/` - Main DJ folders
- `moreDJs/` - Additional DJ folders
- `.htaccess` - DirectoryIndex and MP3 download forcing
- `audio-source-config.json` - External audio source configuration

**For complete asset documentation, see [ASSETS.md](ASSETS.md)**

## Python Scripts
- `generate-covers.py` - Run after adding audio files to extract embedded cover art images
- `generate-manifest.py` - Run after adding/updating audio files to regenerate `manifest.json` in each DJ folder
- `generate-peaks.py` - Run after adding audio files to generate `.peaks.json` waveform data
- `generate-search-index.py` - Run after manifest changes to regenerate `search-index.json` for search mode

## Code Style
- HTML: HTML5 doctype, UTF-8, 2-space indent, external stylesheet
- Track lists: `.tracks.txt` CSV files with format `time,title,artist[,remixer]`

## Git
- Remote: git@github.com:entripy63/mix.4st.uk.git
- Push: `git push origin main`
