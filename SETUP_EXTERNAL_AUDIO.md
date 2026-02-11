# Setup: Using External Audio Files

This project can be configured to read audio files from an external directory (e.g., your media library) while keeping generated artifacts (manifests, peaks, covers, search index) in the git repository.

This avoids duplicating 100+ GB of audio files in the repository.

## Quick Start

1. **Run generation scripts with `--source` parameter**:

```bash
# Generate manifests from audio in /home/st/Music/mixes
python3 generate-manifest.py --source /home/st/Music/mixes .

# Generate cover art from the same audio
python3 generate-covers.py --source /home/st/Music/mixes .

# Generate waveform peaks
python3 generate-peaks.py --source /home/st/Music/mixes .

# Generate search index (reads manifests from current dir)
python3 generate-search-index.py .
```

2. **Update `.htaccess` or web server config** to serve audio from external location (optional, if you want to serve audio from `/home/st/Music/mixes` instead of bundling it in the repo).

## What Gets Stored Where

### In Repository (git-tracked)
- `manifest.json` - DJ metadata and mix listings
- `.peaks.json` - Waveform data for player
- Cover art images (`.jpg`, `.png`)
- `search-index.json` - Searchable index
- HTML/markdown docs

### In External Location (not in git)
- Audio files (`.mp3`, `.flac`, `.m4a`, `.opus`)
- Any other non-generated files

## Directory Structure

```
/home/st/Music/mixes/               ← Audio source
├── trip/
│   ├── mix1.mp3
│   ├── mix2.flac
│   └── ...
├── haze/
│   ├── haze_mix_01.mp3
│   ├── haze_mix_02.mp3
│   └── ...
└── moreDJs/
    ├── dj1/
    ├── dj2/
    └── ...

/home/st/git/mix.4st.uk/           ← Repository (artifacts only)
├── trip/
│   ├── manifest.json               ← Generated
│   ├── mix1.peaks.json             ← Generated
│   ├── mix1.jpg                    ← Generated (extracted covers)
│   └── ...
├── haze/
│   ├── manifest.json
│   ├── haze_mix_01.peaks.json
│   └── ...
└── moreDJs/
    ├── dj1/
    │   └── manifest.json
    └── dj2/
        └── manifest.json
```

## Script Usage

### `generate-manifest.py`

Original usage (read and write in same directory):
```bash
python3 generate-manifest.py [directory]
```

With external audio:
```bash
python3 generate-manifest.py --source /path/to/audio [output_directory]
```

**Parameters:**
- `--source PATH` - Read audio files from this directory
- `[output_directory]` - Where to write manifest.json files (default: current directory)

### `generate-covers.py`

Original usage:
```bash
python3 generate-covers.py [directory]
```

With external audio:
```bash
python3 generate-covers.py --source /path/to/audio [output_directory]
```

### `generate-peaks.py`

Original usage:
```bash
python3 generate-peaks.py [directory]
```

With external audio:
```bash
python3 generate-peaks.py --source /path/to/audio [output_directory]
```

### `generate-search-index.py`

This script reads manifests (not audio), so it doesn't need `--source`:
```bash
python3 generate-search-index.py [directory]
```

Always reads from and writes to the same directory.

## Workflow

When you add new audio files to `/home/st/Music/mixes/`:

1. **Generate manifests** (reads metadata from audio):
   ```bash
   python3 generate-manifest.py --source /home/st/Music/mixes .
   ```

2. **Extract cover art** (reads embedded images from audio):
   ```bash
   python3 generate-covers.py --source /home/st/Music/mixes .
   ```

3. **Generate waveform peaks** (analyzes audio for visual display):
   ```bash
   python3 generate-peaks.py --source /home/st/Music/mixes .
   ```

4. **Update search index** (reads manifests to create searchable index):
   ```bash
   python3 generate-search-index.py .
   ```

5. **Commit artifacts** to git:
   ```bash
   git add -A
   git commit -m "Update manifests, covers, peaks for new mixes"
   git push origin main
   ```

## Serving Audio Files

The web player in `player.html` expects audio files at paths like:
- `trip/mix1.mp3`
- `haze/haze_mix_01.mp3`

If audio files are in the repository, these paths work out-of-the-box.

If audio files are external, you have options:

### Option A: Symlink
Create symlinks from the repository to the external location:
```bash
# From /home/st/git/mix.4st.uk:
ln -s /home/st/Music/mixes/trip trip_audio
```

Then update `mixes.js` to read from `trip_audio/mix1.mp3`, etc.

### Option B: Reverse proxy
Serve audio from external location via a web server:
```apache
# In .htaccess or web server config:
<IfModule mod_rewrite.c>
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^(.+\.(mp3|flac|m4a|opus))$ /path/to/Music/mixes/$1 [L]
</IfModule>
```

### Option C: Don't serve audio at all
If the player is only used locally or the audio is accessible another way, just don't worry about it. The manifests still work.

## FAQ

**Q: Do I need to copy audio files to the repository?**
A: No. Use `--source` to read from your external location. Only generated artifacts go in git.

**Q: Can I switch between --source and local files?**
A: Yes. The scripts work either way. Just don't mix them (some files read from source, others local).

**Q: What if I add more audio later?**
A: Re-run the generation scripts with `--source`. They'll generate new artifacts for new files and skip existing ones.

**Q: Will the web player work without audio files in the repo?**
A: The player will function (show listings, play if audio is accessible), but will fail to play if audio files aren't accessible at the paths it expects. Set up Option A or B above if needed.

## Backward Compatibility

The original usage still works:
```bash
# Old way: read and write from same directory
python3 generate-manifest.py trip/
```

The `--source` parameter is purely optional. Choose whichever approach works for your setup.
