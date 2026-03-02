#!/usr/bin/env python3
"""
Generate search-index.json files for mixes and streams.

Usage: 
    python3 generate-search-index.py [base_directory]

Default base directory is current directory.
Reads manifest.json from each DJ subdirectory in mixes/, outputs mixes/search-index.json.
Reads manifest.json and all preset .json files from streams/, outputs streams/search-index.json.

Note: This script reads manifests from the specified directory (or current directory)
and writes search-index.json files there. It doesn't need source/output separation since
manifests are generated artifacts, not audio files.
"""

import json
import sys
from pathlib import Path

def process_manifest(manifest_path, dj_path, all_mixes):
    """Process a single manifest.json and add mixes to the list."""
    print(f"Reading {dj_path}/manifest.json...")
    with open(manifest_path) as f:
        manifest = json.load(f)
    
    for mix in manifest.get('mixes', []):
        # Extract only searchable fields
        all_mixes.append({
            'dj': dj_path,
            'file': mix.get('file', ''),
            'name': mix.get('name', ''),
            'artist': mix.get('artist', ''),
            'genre': mix.get('genre', ''),
            'comment': mix.get('comment', ''),
            'duration': mix.get('durationFormatted', ''),
            'audioFile': mix.get('audioFile', ''),
            'peaksFile': mix.get('peaksFile', ''),
            'coverFile': mix.get('coverFile', ''),
            'downloads': mix.get('downloads', [])
        })
    
    print(f"  Added {len(manifest.get('mixes', []))} mixes")

def process_streams(streams_directory, all_streams):
    """Process all stream preset .json files and add streams to the list."""
    manifest_path = streams_directory / 'manifest.json'
    if not manifest_path.exists():
        print(f"Warning: {manifest_path} not found, skipping streams")
        return
    
    print(f"Reading {manifest_path}...")
    with open(manifest_path) as f:
        manifest = json.load(f)
    
    preset_count = 0
    stream_count = 0
    
    for preset in manifest.get('presets', []):
        preset_filename = preset.get('filename', '')
        preset_name = preset.get('name', '')
        preset_path = streams_directory / preset_filename
        
        if not preset_path.exists():
            print(f"  Warning: {preset_filename} not found")
            continue
        
        print(f"  Reading {preset_filename}...")
        with open(preset_path) as f:
            preset_data = json.load(f)
        
        for stream in preset_data.get('streams', []):
            # Extract only searchable fields
            all_streams.append({
                'name': stream.get('name', ''),
                'genre': stream.get('genre', ''),
                'url': stream.get('m3u', ''),
                'preset': preset_filename.replace('.streams', ''),
                'presetLabel': preset_name
            })
            stream_count += 1
        
        preset_count += 1
    
    print(f"  Added {stream_count} streams from {preset_count} presets")

def main():
    base_directory = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')
    
    # Process mixes
    print("=" * 60)
    print("Processing MIXES")
    print("=" * 60)
    
    mixes_directory = base_directory / 'mixes'
    all_mixes = []
    
    if mixes_directory.exists():
        # Find all directories with manifest.json, including moreDJs/
        for entry in sorted(mixes_directory.iterdir()):
            if entry.is_dir() and not entry.name.startswith('.'):
                if entry.name == 'moreDJs':
                    # Scan subdirectories within moreDJs
                    for subentry in sorted(entry.iterdir()):
                        if subentry.is_dir():
                            manifest_path = subentry / 'manifest.json'
                            if manifest_path.exists():
                                process_manifest(manifest_path, f"moreDJs/{subentry.name}", all_mixes)
                else:
                    # Check all root-level directories
                    manifest_path = entry / 'manifest.json'
                    if manifest_path.exists():
                        process_manifest(manifest_path, entry.name, all_mixes)
        
        # Write mixes search index
        mixes_index_path = mixes_directory / 'search-index.json'
        with open(mixes_index_path, 'w') as f:
            json.dump(all_mixes, f, separators=(',', ':'))
        
        size_kb = mixes_index_path.stat().st_size / 1024
        print(f"\nWrote mixes/search-index.json: {len(all_mixes)} mixes, {size_kb:.1f} KB")
    else:
        print(f"Warning: {mixes_directory} not found, skipping mixes")
    
    # Process streams
    print("\n" + "=" * 60)
    print("Processing STREAMS")
    print("=" * 60)
    
    streams_directory = base_directory / 'streams'
    all_streams = []
    
    if streams_directory.exists():
        process_streams(streams_directory, all_streams)
        
        # Write streams search index
        streams_index_path = streams_directory / 'search-index.json'
        with open(streams_index_path, 'w') as f:
            json.dump(all_streams, f, separators=(',', ':'))
        
        size_kb = streams_index_path.stat().st_size / 1024
        print(f"\nWrote streams/search-index.json: {len(all_streams)} streams, {size_kb:.1f} KB")
    else:
        print(f"Warning: {streams_directory} not found, skipping streams")
    
    print("\n" + "=" * 60)
    print("Done")
    print("=" * 60)

if __name__ == '__main__':
    main()
