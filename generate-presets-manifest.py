#!/usr/bin/env python3
"""
Generate manifest.json for presets directory.

Usage:
    python3 generate-presets-manifest.py

Scans /presets/ directory for .json preset files, reads the 'name' field
from each, and generates /presets/manifest.json listing them.

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
    presets_dir = Path('presets')
    
    if not presets_dir.exists():
        print(f"Error: {presets_dir} directory does not exist")
        return
    
    # Find all .json files in presets directory (exclude manifest.json)
    preset_files = sorted([
        f for f in presets_dir.glob('*.json')
        if f.name != 'manifest.json'
    ])
    
    if not preset_files:
        print(f"No preset files found in {presets_dir}")
        return
    
    presets = []
    
    for preset_file in preset_files:
        try:
            with open(preset_file, 'r') as f:
                data = json.load(f)
            
            if 'name' in data and isinstance(data.get('streams'), list):
                presets.append({
                    'filename': preset_file.name,
                    'name': data['name']
                })
                print(f"  {preset_file.name}: \"{data['name']}\"")
            else:
                print(f"  Skipped {preset_file.name}: missing 'name' or 'streams'")
        except json.JSONDecodeError as e:
            print(f"  Error parsing {preset_file.name}: {e}")
        except Exception as e:
            print(f"  Error reading {preset_file.name}: {e}")
    
    if not presets:
        print("No valid presets found")
        return
    
    # Sort presets alphabetically by name
    presets.sort(key=lambda p: p['name'].lower())
    
    # Write manifest
    manifest = {
        'presets': presets
    }
    
    manifest_path = presets_dir / 'manifest.json'
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    
    print(f"\nWrote {manifest_path} ({len(presets)} presets)")


if __name__ == '__main__':
    main()
