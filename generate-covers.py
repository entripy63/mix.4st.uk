#!/usr/bin/env python3
"""
Extract cover art images from audio files.

Scans audio files for embedded cover art and extracts them to separate image files
with the same basename as the audio file.

Usage:
    python generate-covers.py [root_dir]
    
If root_dir is not specified, uses the current directory.
"""

import subprocess
import sys
import os
from pathlib import Path

AUDIO_EXTENSIONS = {'.mp3', '.m4a', '.flac', '.ogg', '.wav'}

def has_cover_art(audio_path):
    """Check if audio file has embedded cover art, return codec name if found."""
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,codec_type',
             '-of', 'default=noprint_wrappers=1', str(audio_path)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True
        )
        lines = result.stdout.strip().split('\n')
        codec_name = None
        for i, line in enumerate(lines):
            if line.startswith('codec_name='):
                codec_name = line.split('=')[1]
            elif line.startswith('codec_type=video') and codec_name:
                return codec_name
        return None
    except Exception as e:
        print(f"  Error probing {audio_path}: {e}")
        return None

def get_image_extension(codec_name):
    """Map codec name to file extension."""
    codec_map = {
        'mjpeg': '.jpg',
        'png': '.png',
        'bmp': '.bmp',
        'gif': '.gif',
    }
    return codec_map.get(codec_name.lower(), '.jpg')

def extract_cover(audio_path, output_path):
    """Extract cover art from audio file."""
    try:
        result = subprocess.run(
            ['ffmpeg', '-y', '-i', str(audio_path), '-an', '-c:v', 'copy', str(output_path)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True
        )
        return result.returncode == 0 and output_path.exists()
    except Exception as e:
        print(f"  Error extracting from {audio_path}: {e}")
        return False

def find_dj_folders(root_dir):
    """Find DJ folders (directories containing audio files)."""
    dj_folders = []
    for item in sorted(root_dir.iterdir()):
        if item.is_dir() and not item.name.startswith('.'):
            has_audio = any(
                f.suffix.lower() in AUDIO_EXTENSIONS 
                for f in item.iterdir() if f.is_file()
            )
            if has_audio:
                dj_folders.append(item)
    return dj_folders

def process_folder(folder):
    """Process all audio files in a folder, extracting cover art."""
    audio_files = sorted([
        f for f in folder.iterdir() 
        if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS
    ])
    
    extracted = 0
    skipped = 0
    no_art = 0
    
    for audio_file in audio_files:
        base_name = audio_file.stem
        
        # Check if cover already exists
        existing_cover = None
        for ext in ['.jpg', '.png', '.bmp', '.gif']:
            potential = folder / f"{base_name}{ext}"
            if potential.exists():
                existing_cover = potential
                break
        
        if existing_cover:
            skipped += 1
            continue
        
        # Check for embedded cover art
        codec = has_cover_art(audio_file)
        if not codec:
            no_art += 1
            continue
        
        # Extract cover art
        ext = get_image_extension(codec)
        output_path = folder / f"{base_name}{ext}"
        
        if extract_cover(audio_file, output_path):
            print(f"  Extracted: {output_path.name}")
            extracted += 1
        else:
            print(f"  Failed: {audio_file.name}")
    
    return extracted, skipped, no_art

def main():
    root_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
    
    if not root_dir.exists():
        print(f"Error: {root_dir} does not exist")
        sys.exit(1)
    
    dj_folders = find_dj_folders(root_dir)
    
    if not dj_folders:
        print("No DJ folders found")
        sys.exit(0)
    
    total_extracted = 0
    total_skipped = 0
    total_no_art = 0
    
    for folder in dj_folders:
        print(f"\nProcessing {folder.name}/")
        extracted, skipped, no_art = process_folder(folder)
        total_extracted += extracted
        total_skipped += skipped
        total_no_art += no_art
        
        if extracted == 0 and skipped == 0 and no_art > 0:
            print(f"  No embedded cover art found")
        elif extracted == 0 and skipped > 0:
            print(f"  All covers already extracted ({skipped} files)")
    
    print(f"\nSummary: {total_extracted} extracted, {total_skipped} skipped, {total_no_art} without art")

if __name__ == '__main__':
    main()
