#!/usr/bin/env python3
"""
Generate manifest.json files from audio file metadata.
Requires: ffprobe (part of ffmpeg)

Usage: python3 generate-manifest.py [directory]
Default directory is current directory.
Scans DJ subdirectories, reads metadata from audio files, writes manifest.json.
"""

import subprocess
import json
import os
import sys
from pathlib import Path

def get_audio_metadata(audio_path):
    """Extract metadata from audio file using ffprobe."""
    try:
        proc = subprocess.Popen([
            'ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format',
            str(audio_path)
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdout, _ = proc.communicate()
        
        data = json.loads(stdout.decode('utf-8'))
        fmt = data.get('format', {})
        tags = fmt.get('tags', {})
        
        # Handle case-insensitive tag names, fall back to album if no title
        title = tags.get('title') or tags.get('TITLE') or tags.get('album') or tags.get('ALBUM') or ''
        artist = tags.get('artist') or tags.get('ARTIST') or ''
        genre = tags.get('genre') or tags.get('GENRE') or ''
        date = tags.get('date') or tags.get('DATE') or ''
        comment = tags.get('comment') or tags.get('COMMENT') or ''
        duration = float(fmt.get('duration', 0))
        
        return {
            'title': title,
            'artist': artist,
            'genre': genre,
            'date': date,
            'comment': comment,
            'duration': duration
        }
    except Exception as e:
        print(f"  Error reading {audio_path}: {e}")
        return None

def format_duration(seconds):
    """Convert seconds to 'H:MM:SS' format."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    return f"{hours}:{minutes:02d}:{secs:02d}"

def find_best_audio_file(directory, base_name):
    """Find the best audio file for a given base name (prefer FLAC for metadata, MP3 for playback)."""
    extensions = ['.mp3', '.flac', '.m4a']
    for ext in extensions:
        path = directory / f"{base_name}{ext}"
        if path.exists():
            return path
    return None

def find_download_files(directory, base_name):
    """Find all download formats available for a mix."""
    extensions = [('.flac', 'FLAC'), ('.mp3', 'MP3'), ('.m4a', 'M4A')]
    downloads = []
    for ext, label in extensions:
        path = directory / f"{base_name}{ext}"
        if path.exists():
            downloads.append({
                'file': f"{base_name}{ext}",
                'label': label
            })
    return downloads

def process_directory(directory):
    """Process a DJ directory and generate manifest.json."""
    directory = Path(directory)
    extensions = {'.mp3', '.flac', '.m4a'}
    
    # Find unique base names (without extension)
    base_names = set()
    for f in directory.iterdir():
        if f.suffix.lower() in extensions:
            base_names.add(f.stem)
    
    if not base_names:
        print(f"  No audio files found")
        return
    
    mixes = []
    
    for base_name in sorted(base_names):
        audio_file = find_best_audio_file(directory, base_name)
        if not audio_file:
            continue
        
        meta = get_audio_metadata(audio_file)
        if not meta:
            continue
        
        # Use title from metadata, fall back to filename
        title = meta['title'] or base_name
        
        # Check for peaks file
        peaks_file = directory / f"{base_name}.peaks.json"
        has_peaks = peaks_file.exists()
        
        # Check for cover art file
        cover_file = None
        for ext in ['.jpg', '.png', '.gif']:
            potential = directory / f"{base_name}{ext}"
            if potential.exists():
                cover_file = f"{base_name}{ext}"
                break
        
        # Find available download formats
        downloads = find_download_files(directory, base_name)
        
        # Determine primary audio file (prefer MP3 for streaming)
        primary_audio = f"{base_name}.mp3" if (directory / f"{base_name}.mp3").exists() else audio_file.name
        
        mix_entry = {
            'name': title,
            'file': base_name,
            'audioFile': primary_audio,
            'duration': meta['duration'],
            'durationFormatted': format_duration(meta['duration']),
            'artist': meta['artist'],
            'downloads': downloads
        }
        
        if meta.get('genre'):
            mix_entry['genre'] = meta['genre']
        if meta.get('date'):
            mix_entry['date'] = meta['date']
        if meta.get('comment'):
            mix_entry['comment'] = meta['comment']
        if has_peaks:
            mix_entry['peaksFile'] = f"{base_name}.peaks.json"
        if cover_file:
            mix_entry['coverFile'] = cover_file
        
        mixes.append(mix_entry)
        print(f"  {base_name}: \"{title}\" ({format_duration(meta['duration'])})")
    
    # Sort by name
    mixes.sort(key=lambda m: m['name'])
    
    # Write manifest
    manifest = {
        'generated': True,
        'mixes': mixes
    }
    
    manifest_path = directory / 'manifest.json'
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    
    print(f"  Wrote manifest.json ({len(mixes)} mixes)")

def main():
    base_directory = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')
    
    # Process known DJ subdirectories
    dj_dirs = ['trip', 'izmar', 'aboo']
    
    for subdir in dj_dirs:
        path = base_directory / subdir
        if path.is_dir():
            print(f"\n=== {subdir} ===")
            process_directory(path)
    
    # Also check for any other directories with audio files
    for entry in base_directory.iterdir():
        if entry.is_dir() and entry.name not in dj_dirs and not entry.name.startswith('.'):
            # Check if it has audio files
            has_audio = any(f.suffix.lower() in {'.mp3', '.flac', '.m4a'} for f in entry.iterdir() if f.is_file())
            if has_audio:
                print(f"\n=== {entry.name} ===")
                process_directory(entry)

if __name__ == '__main__':
    main()
