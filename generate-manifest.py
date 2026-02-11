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

def extract_dj_and_mix_from_filename(filename, folder_name):
    """
    Extract DJ name and mix name from filename when metadata is missing.
    Handles various naming conventions:
    - DJName-MixName.mp3 (DJ name matches folder name)
    - Just-MixName.mp3 (whole filename is mix name if folder not in filename)
    - Folder_Name/filename.mp3 (use folder name as DJ, filename as mix)
    
    Returns: (dj_name, mix_name) tuple
    """
    # Remove extension
    name_without_ext = Path(filename).stem
    
    # Replace underscores with spaces for display
    display_name = name_without_ext.replace('_', ' ')
    
    # Normalize for comparison (remove underscores, hyphens, convert to lowercase)
    folder_normalized = folder_name.lower().replace('_', '').replace(' ', '').replace('-', '')
    filename_normalized = display_name.lower().replace('_', '').replace(' ', '').replace('-', '')
    
    # Check if filename starts with folder name (allowing for format variations)
    if filename_normalized.startswith(folder_normalized):
        # Try to extract remainder by finding where folder name ends
        # Look for hyphen or dash as a separator
        idx = 0
        folder_chars_matched = 0
        
        for i, char in enumerate(display_name.lower()):
            normalized_char = char.replace('_', '').replace(' ', '').replace('-', '')
            if folder_chars_matched < len(folder_normalized) and normalized_char == folder_normalized[folder_chars_matched]:
                folder_chars_matched += 1
                idx = i + 1
        
        # Skip any hyphens, underscores, or spaces after the folder name part
        while idx < len(display_name) and display_name[idx] in '-_ ':
            idx += 1
        
        remainder = display_name[idx:].strip()
        # Also replace hyphens with spaces in the remainder for better display
        remainder = remainder.replace('-', ' ')
        
        if remainder:
            return folder_name, remainder
        else:
            # If nothing left after removing folder name, use whole filename
            return folder_name, display_name.replace('-', ' ')
    else:
        # Folder name not in filename, use whole filename as mix name
        # Replace hyphens with spaces
        return folder_name, display_name.replace('-', ' ')

def find_best_audio_file(directory, base_name):
    """Find the best audio file for a given base name (prefer FLAC for metadata, MP3 for playback)."""
    extensions = ['.flac', '.m4a', '.mp3', '.opus']
    for ext in extensions:
        path = directory / f"{base_name}{ext}"
        if path.exists():
            return path
    return None

def find_download_files(directory, base_name):
    """Find all download formats available for a mix."""
    extensions = [('.flac', 'FLAC'), ('.mp3', 'MP3'), ('.m4a', 'M4A'), ('.opus', 'OPUS')]
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
    extensions = {'.mp3', '.flac', '.m4a', '.opus'}
    
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
        
        # Use title from metadata, fall back to filename parsing
        if meta['title']:
            title = meta['title']
        else:
            # Fallback: extract from filename
            _, mix_name = extract_dj_and_mix_from_filename(base_name, directory.name)
            title = mix_name
        
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

def find_dj_directories(base_directory):
    """Find all directories containing audio files, including nested ones in moreDJs/."""
    dj_dirs = []
    extensions = {'.mp3', '.flac', '.m4a', '.opus'}
    
    for entry in base_directory.iterdir():
        if entry.is_dir() and not entry.name.startswith('.'):
            if entry.name == 'moreDJs':
                # Scan subdirectories within moreDJs
                for subentry in entry.iterdir():
                    if subentry.is_dir():
                        has_audio = any(f.suffix.lower() in extensions for f in subentry.iterdir() if f.is_file())
                        if has_audio:
                            dj_dirs.append(subentry)
            else:
                # Check root-level directories
                has_audio = any(f.suffix.lower() in extensions for f in entry.iterdir() if f.is_file())
                if has_audio:
                    dj_dirs.append(entry)
    
    return sorted(dj_dirs, key=lambda p: p.name.lower())

def main():
    base_directory = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')
    
    # If a specific directory is given, process just that one
    if len(sys.argv) > 1 and (base_directory / 'manifest.json').parent != base_directory.parent:
        # Check if it's a DJ directory (has audio files)
        extensions = {'.mp3', '.flac', '.m4a', '.opus'}
        has_audio = any(f.suffix.lower() in extensions for f in base_directory.iterdir() if f.is_file())
        if has_audio:
            print(f"\n=== {base_directory.name} ===")
            process_directory(base_directory)
            return
    
    # Otherwise, find and process all DJ directories
    dj_dirs = find_dj_directories(base_directory)
    
    for dj_dir in dj_dirs:
        relative = dj_dir.relative_to(base_directory)
        print(f"\n=== {relative} ===")
        process_directory(dj_dir)

if __name__ == '__main__':
    main()
