#!/usr/bin/env python3
"""
Generate search-index.json from all DJ manifest.json files.

Usage: python3 generate-search-index.py [directory]
Default directory is current directory.
Reads manifest.json from each DJ subdirectory, outputs combined search-index.json.
"""

import json
import sys
from pathlib import Path

def main():
    base_directory = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')
    
    all_mixes = []
    
    # Find all directories with manifest.json
    for entry in sorted(base_directory.iterdir()):
        if entry.is_dir() and not entry.name.startswith('.'):
            manifest_path = entry / 'manifest.json'
            if manifest_path.exists():
                print(f"Reading {entry.name}/manifest.json...")
                with open(manifest_path) as f:
                    manifest = json.load(f)
                
                for mix in manifest.get('mixes', []):
                    # Extract only searchable fields
                    all_mixes.append({
                        'dj': entry.name,
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
    
    # Write combined index
    index_path = base_directory / 'search-index.json'
    with open(index_path, 'w') as f:
        json.dump(all_mixes, f, separators=(',', ':'))
    
    # Calculate size
    size_kb = index_path.stat().st_size / 1024
    print(f"\nWrote search-index.json: {len(all_mixes)} mixes, {size_kb:.1f} KB")

if __name__ == '__main__':
    main()
