#!/usr/bin/env python3
"""
Generate manifest.json for streams directory.

Usage:
    python3 generate-streams-manifest.py

Scans /streams/ directory for .streams files, reads the 'name' field
from each, and generates /streams/manifest.json listing them.

Preset file format expected:
    {
      "name": "Display Name",
      "version": 1,
      "savedAt": "...",
      "streams": [...]
    }
"""

import json
from pathlib import Path


def main():
    streams_dir = Path('streams')
    
    if not streams_dir.exists():
        print(f"Error: {streams_dir} directory does not exist")
        return
    
    # Find all .streams files in streams directory (exclude manifest.json)
    stream_files = sorted([
        f for f in streams_dir.glob('*.streams')
        if f.name != 'manifest.json'
    ])
    
    if not stream_files:
        print(f"No stream files found in {streams_dir}")
        return
    
    streams = []
    
    for stream_file in stream_files:
        try:
            with open(stream_file, 'r') as f:
                data = json.load(f)
            
            if 'name' in data and isinstance(data.get('streams'), list):
                streams.append({
                    'filename': stream_file.name,
                    'name': data['name']
                })
                print(f"  {stream_file.name}: \"{data['name']}\"")
            else:
                print(f"  Skipped {stream_file.name}: missing 'name' or 'streams'")
        except json.JSONDecodeError as e:
            print(f"  Error parsing {stream_file.name}: {e}")
        except Exception as e:
            print(f"  Error reading {stream_file.name}: {e}")
    
    if not streams:
        print("No valid streams found")
        return
    
    # Sort streams alphabetically by name
    streams.sort(key=lambda p: p['name'].lower())
    
    # Write manifest
    manifest = {
        'presets': streams
    }
    
    manifest_path = streams_dir / 'manifest.json'
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    
    print(f"\nWrote {manifest_path} ({len(streams)} streams)")


if __name__ == '__main__':
    main()
