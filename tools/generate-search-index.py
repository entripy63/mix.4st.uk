#!/usr/bin/env python3
"""
Generate search-index.json from all DJ manifest.json files.

Usage: 
    python3 generate-search-index.py [directory]

Default directory is current directory.
Reads manifest.json from each DJ subdirectory, outputs combined search-index.json.

Note: This script reads manifests from the specified directory (or current directory)
and writes search-index.json there. It doesn't need source/output separation since
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

def main():
    base_directory = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')
    
    all_mixes = []
    
    # Find all directories with manifest.json, including moreDJs/
    for entry in sorted(base_directory.iterdir()):
        if entry.is_dir() and not entry.name.startswith('.'):
            if entry.name == 'moreDJs':
                # Scan subdirectories within moreDJs
                for subentry in sorted(entry.iterdir()):
                    if subentry.is_dir():
                        manifest_path = subentry / 'manifest.json'
                        if manifest_path.exists():
                            process_manifest(manifest_path, f"moreDJs/{subentry.name}", all_mixes)
            else:
                # Check root-level directories
                manifest_path = entry / 'manifest.json'
                if manifest_path.exists():
                    process_manifest(manifest_path, entry.name, all_mixes)
    
    # Write combined index
    index_path = base_directory / 'search-index.json'
    with open(index_path, 'w') as f:
        json.dump(all_mixes, f, separators=(',', ':'))
    
    # Calculate size
    size_kb = index_path.stat().st_size / 1024
    print(f"\nWrote search-index.json: {len(all_mixes)} mixes, {size_kb:.1f} KB")

if __name__ == '__main__':
    main()
