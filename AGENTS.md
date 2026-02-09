# AGENTS.md

## Build/Test Commands
- No build system - static HTML/CSS website
- DON'T USE `python3 -m http.server 8000` to test locally, too flakey

## Architecture
- Static website for DJ mixes at mix.4st.uk

- new SPA version using `player.html`
- `player.html` - SPA Landing page, Player, Queue, Browser columns, responsive design reducing to 2 columns when required
- `player.css` - Shared stylesheet
- `player.js` - Shared Javascript
- `mixes.js` - derives mix data from legacy html files and media file metadata
-
- legacy MPA version using `index.html`
- `index.html` - MPA Landing page with spinning vinyl animation, links to DJ folders
- `styles.css` - Shared stylesheet (tables, audio player, download links)
- `mix.js` - minimal JS requirement support
-
- Files common to SPA and MPA versions
- `.htaccess` - DirectoryIndex and MP3 download forcing
- `trip/` - trip-'s mixes (21 mix HTML files + audio)
- `izmar/` - Izmar's mixes (3 mix HTML files + audio, FLAC/M4A/MP3)
- `aboo/` - Aboo's mixes (1 mix HTML file + MP3)
- `jx3p/` - jx3p's mixes (3)
- `gmanual/` - gmanual's mix (1)
- `haze/` - haze's mixes (58)
- `rpfr/` - rpfr's mixes (34)

## Python Scripts
- `generate-covers.py` - Run after adding audio files to extract embedded cover art images
- `generate-manifest.py` - Run after adding/updating audio files to regenerate `manifest.json` in each DJ folder
- `generate-peaks.py` - Run after adding audio files to generate `.peaks.json` waveform data
- `generate-search-index.py` - Run after manifest changes to regenerate `search-index.json` for search mode

## Code Style
- HTML: HTML5 doctype, UTF-8, 2-space indent, external stylesheet  
- Mix HTML structure: audio player, Downloads section, Track List table
- Tables: `class="border"`, columns vary (Title/Artist/Remixer or Time/Title/Artist)
- Download links: `<a class="download-link" href="file" download>FORMAT</a>`

## Git
- Remote: git@github.com:entripy63/mix.4st.uk.git
- Push: `git push origin master:main`
