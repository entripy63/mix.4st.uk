#!/usr/bin/env python3
"""
Extract cover art images from audio files.

Scans audio files for embedded cover art and extracts them to separate image files
with the same basename as the audio file.

Usage:
    python generate-covers.py [root_dir]
    python generate-covers.py --source /path/to/audio [output_dir]
    
If root_dir is not specified, uses the current directory.
If --source is specified, reads audio from source and writes covers to output directory.
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
    """Find DJ folders (directories containing audio files), including nested ones in moreDJs/."""
    dj_folders = []
    for item in sorted(root_dir.iterdir()):
        if item.is_dir() and not item.name.startswith('.'):
            if item.name == 'moreDJs':
                # Scan subdirectories within moreDJs
                for subitem in sorted(item.iterdir()):
                    if subitem.is_dir():
                        has_audio = any(
                            f.suffix.lower() in AUDIO_EXTENSIONS 
                            for f in subitem.iterdir() if f.is_file()
                        )
                        if has_audio:
                            dj_folders.append(subitem)
            else:
                # Check root-level directories
                has_audio = any(
                    f.suffix.lower() in AUDIO_EXTENSIONS 
                    for f in item.iterdir() if f.is_file()
                )
                if has_audio:
                    dj_folders.append(item)
    return dj_folders

def process_folder(folder):
    """Process all audio files in a folder, extracting cover art (read and write in same folder)."""
    return process_folder_split(folder, folder)

def process_folder_split(source_folder, output_folder):
    """Process audio files from source folder, write covers to output folder."""
    audio_files = sorted([
        f for f in source_folder.iterdir() 
        if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS
    ])
    
    extracted = 0
    skipped = 0
    no_art = 0
    
    for audio_file in audio_files:
        base_name = audio_file.stem
        
        # Check if cover already exists in output folder
        existing_cover = None
        for ext in ['.jpg', '.png', '.bmp', '.gif']:
            potential = output_folder / f"{base_name}{ext}"
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
        output_path = output_folder / f"{base_name}{ext}"
        
        if extract_cover(audio_file, output_path):
            print(f"  Extracted: {output_path.name}")
            extracted += 1
        else:
            print(f"  Failed: {audio_file.name}")
    
    return extracted, skipped, no_art

def main():
    source_dir = None
    output_dir = None
    
    # Parse arguments
    if len(sys.argv) > 1 and sys.argv[1] == '--source':
        if len(sys.argv) < 3:
            print("Error: --source requires a path argument")
            sys.exit(1)
        source_dir = Path(sys.argv[2])
        output_dir = Path(sys.argv[3]) if len(sys.argv) > 3 else Path.cwd()
        
        if not source_dir.exists():
            print(f"Error: source directory {source_dir} does not exist")
            sys.exit(1)
    else:
        root_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
        output_dir = root_dir
    
    if not output_dir.exists():
        print(f"Error: {output_dir} does not exist")
        sys.exit(1)
    
    # If source specified, process from source to output
    if source_dir:
        print(f"Reading audio from: {source_dir}")
        print(f"Writing covers to: {output_dir}")
        
        dj_folders = find_dj_folders(source_dir)
        total_extracted = 0
        total_skipped = 0
        total_no_art = 0
        
        for source_folder in dj_folders:
            relative = source_folder.relative_to(source_dir)
            
            # Create corresponding output directory
            if relative.parts[0] == 'moreDJs':
                output_folder = output_dir / 'moreDJs' / relative.parts[1]
            else:
                output_folder = output_dir / relative
            
            output_folder.mkdir(parents=True, exist_ok=True)
            
            print(f"\nProcessing {relative}/")
            extracted, skipped, no_art = process_folder_split(source_folder, output_folder)
            total_extracted += extracted
            total_skipped += skipped
            total_no_art += no_art
            
            if extracted == 0 and skipped == 0 and no_art > 0:
                print(f"  No embedded cover art found")
            elif extracted == 0 and skipped > 0:
                print(f"  All covers already extracted ({skipped} files)")
        
        print(f"\nSummary: {total_extracted} extracted, {total_skipped} skipped, {total_no_art} without art")
        return
    
    # Original behavior: check if a specific DJ directory is given (has audio files directly)
    has_audio = any(
        f.suffix.lower() in AUDIO_EXTENSIONS 
        for f in output_dir.iterdir() if f.is_file()
    )
    
    if has_audio:
        # Process just this directory
        print(f"\nProcessing {output_dir.name}/")
        extracted, skipped, no_art = process_folder(output_dir)
        print(f"\nSummary: {extracted} extracted, {skipped} skipped, {no_art} without art")
        return
    
    # Otherwise find and process all DJ folders
    dj_folders = find_dj_folders(output_dir)
    
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
