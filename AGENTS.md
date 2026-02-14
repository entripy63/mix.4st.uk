# AGENTS.md

## Build/Test Commands
- No build system - static HTML/CSS website
- DON'T USE `python3 -m http.server 8000` to test locally, too flakey

## Architecture
- Static website for DJ mixes at mixes.4st.uk
- SPA using `player.html` as entry point
- `player.html` - Landing page, Player, Queue, Browser columns, responsive design
- `player.css` - Stylesheet
- **JavaScript modules** (no bundler, simple script loading):
  - `core.js` - Shared utilities, global state, DOM references
  - `queue.js` - Queue management, drag-drop, queue operations
  - `player.js` - Playback controls, waveform rendering, audio handling
  - `browser.js` - Mix browser, search, live streams, settings, page restoration
  - `mixes.js` - Loads mix data from `manifest.json` files
- `.htaccess` - DirectoryIndex and MP3 download forcing
- DJ folders contain `manifest.json`, `.tracks.txt` files, `.peaks.json` files, and cover images
- `trip/`, `izmar/`, `aboo/`, `jx3p/`, `gmanual/`, `haze/`, `rpfr/` - Main DJ folders
- `moreDJs/` - Additional DJ folders

## Python Scripts
- `generate-covers.py` - Run after adding audio files to extract embedded cover art images
- `generate-manifest.py` - Run after adding/updating audio files to regenerate `manifest.json` in each DJ folder
- `generate-peaks.py` - Run after adding audio files to generate `.peaks.json` waveform data
- `generate-search-index.py` - Run after manifest changes to regenerate `search-index.json` for search mode
- `extract-tracklists.py` - One-time migration: extracts track lists from legacy HTML files to `.tracks.txt` CSV format

## Code Style
- HTML: HTML5 doctype, UTF-8, 2-space indent, external stylesheet
- Track lists: `.tracks.txt` CSV files with format `time,title,artist[,remixer]`

## Git
- Remote: git@github.com:entripy63/mix.4st.uk.git
- Push: `git push origin main`
