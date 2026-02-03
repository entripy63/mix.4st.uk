# AGENTS.md

## Build/Test Commands
- No build system - static HTML/CSS website
- Test locally: `python3 -m http.server 8000`

## Architecture
- Static website for DJ mixes at mix.4st.uk
- `index.html` - Landing page with spinning vinyl animation, links to DJ folders
- `styles.css` - Shared stylesheet (tables, audio player, download links)
- `.htaccess` - DirectoryIndex and MP3 download forcing
- `trip/` - trip-'s mixes (21 mix HTML files + audio)
- `izmar/` - Izmar's mixes (3 mix HTML files + audio, FLAC/M4A/MP3)
- `aboo/` - Aboo's mixes (1 mix HTML file + MP3)

## Code Style
- HTML: HTML5 doctype, UTF-8, 2-space indent, external stylesheet via `../styles.css`
- Mix HTML structure: audio player, Downloads section, Track List table
- Tables: `class="border"`, columns vary (Title/Artist/Remixer or Time/Title/Artist)
- Download links: `<a class="download-link" href="file" download>FORMAT</a>`

## Git
- Remote: git@github.com:entripy63/mix.4st.uk.git
- Push: `git push origin master:main`
