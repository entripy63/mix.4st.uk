#!/usr/bin/env python3
"""Write metadata tags to media files based on HTML data."""

import os
import subprocess
import re
from pathlib import Path
from html.parser import HTMLParser
import shutil
import argparse

class MixHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.mixes = []
        self.in_td = False
        self.in_a = False
        self.current_row = {}
        self.td_count = 0
        self.dj_name = None
        self.in_h1 = False
        
    def handle_starttag(self, tag, attrs):
        if tag == 'h1':
            self.in_h1 = True
        elif tag == 'tr':
            self.current_row = {}
            self.td_count = 0
        elif tag == 'td':
            self.in_td = True
            self.td_count += 1
        elif tag == 'a' and self.in_td:
            self.in_a = True
            for name, value in attrs:
                if name == 'href':
                    self.current_row['href'] = value
                    
    def handle_endtag(self, tag):
        if tag == 'h1':
            self.in_h1 = False
        elif tag == 'td':
            self.in_td = False
        elif tag == 'a':
            self.in_a = False
        elif tag == 'tr' and self.current_row.get('href'):
            self.mixes.append(self.current_row)
            
    def handle_data(self, data):
        if self.in_h1 and not self.dj_name:
            # Extract DJ name from "Mixes by DJ-Name"
            match = re.search(r'Mixes by (.+)', data)
            if match:
                self.dj_name = match.group(1).strip()
        if self.in_td and self.td_count == 1:
            self.current_row['duration_html'] = data.strip()
        elif self.in_a:
            self.current_row['name_html'] = data.strip()

def find_media_files(directory):
    """Find all media files in directory."""
    extensions = {'.mp3', '.flac', '.m4a'}
    files = {}
    for f in Path(directory).iterdir():
        if f.suffix.lower() in extensions:
            base = f.stem
            if base not in files:
                files[base] = []
            files[base].append(f)
    return files

def get_current_metadata(filepath):
    """Get current metadata from file."""
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', str(filepath)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        import json
        data = json.loads(result.stdout.decode('utf-8'))
        tags = data.get('format', {}).get('tags', {})
        return {
            'title': tags.get('title') or tags.get('TITLE') or '',
            'artist': tags.get('artist') or tags.get('ARTIST') or ''
        }
    except:
        return {'title': '', 'artist': ''}

def write_metadata(filepath, title, artist, dry_run=True):
    """Write metadata to file using ffmpeg."""
    ext = filepath.suffix.lower()
    temp_file = filepath.with_suffix(f'.tmp{ext}')
    
    cmd = [
        'ffmpeg', '-y', '-i', str(filepath),
        '-c', 'copy',
        '-metadata', f'title={title}',
        '-metadata', f'artist={artist}',
    ]
    
    # FLAC needs different handling
    if ext == '.flac':
        cmd.extend(['-write_id3v2', '0'])
    
    cmd.append(str(temp_file))
    
    if dry_run:
        print(f"  Would run: ffmpeg ... -metadata title=\"{title}\" -metadata artist=\"{artist}\" ...")
        return True
    
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode == 0:
            # Replace original with temp
            shutil.move(str(temp_file), str(filepath))
            return True
        else:
            print(f"  ERROR: {result.stderr.decode('utf-8')[:200]}")
            if temp_file.exists():
                temp_file.unlink()
            return False
    except Exception as e:
        print(f"  ERROR: {e}")
        if temp_file.exists():
            temp_file.unlink()
        return False

def main():
    parser = argparse.ArgumentParser(description='Fix metadata tags based on HTML data')
    parser.add_argument('--apply', action='store_true', help='Actually write changes (default is dry-run)')
    parser.add_argument('--force', action='store_true', help='Overwrite existing metadata even if present')
    args = parser.parse_args()
    
    dry_run = not args.apply
    
    if dry_run:
        print("DRY RUN - no changes will be made. Use --apply to write changes.\n")
    else:
        print("APPLYING CHANGES\n")
    
    base_dir = Path(__file__).parent
    dj_dirs = ['trip', 'izmar', 'aboo']
    
    updated = 0
    skipped = 0
    errors = 0
    
    for dj in dj_dirs:
        dj_path = base_dir / dj
        if not dj_path.exists():
            continue
            
        index_html = dj_path / 'index.html'
        if not index_html.exists():
            continue
            
        with open(index_html, 'r') as f:
            parser_obj = MixHTMLParser()
            parser_obj.feed(f.read())
        
        dj_name = parser_obj.dj_name or dj
        html_mixes = {}
        for mix in parser_obj.mixes:
            href = mix.get('href', '')
            base = href.replace('.html', '')
            html_mixes[base] = mix
        
        media_files = find_media_files(dj_path)
        
        for base, files in sorted(media_files.items()):
            html = html_mixes.get(base, {})
            html_name = html.get('name_html', base)  # Fall back to filename
            
            for filepath in files:
                current = get_current_metadata(filepath)
                needs_update = False
                
                if not current['title']:
                    needs_update = True
                elif args.force and current['title'].lower() != html_name.lower():
                    needs_update = True
                
                if not needs_update:
                    print(f"SKIP {dj}/{filepath.name}: already has title=\"{current['title']}\"")
                    skipped += 1
                    continue
                
                print(f"UPDATE {dj}/{filepath.name}:")
                print(f"  title: \"{current['title']}\" -> \"{html_name}\"")
                print(f"  artist: \"{current['artist']}\" -> \"{dj_name}\"")
                
                if write_metadata(filepath, html_name, dj_name, dry_run):
                    updated += 1
                else:
                    errors += 1
    
    print(f"\n{'Would update' if dry_run else 'Updated'}: {updated}")
    print(f"Skipped (already tagged): {skipped}")
    if errors:
        print(f"Errors: {errors}")
    
    if dry_run and updated > 0:
        print("\nRun with --apply to write changes.")
        print("Run with --apply --force to overwrite existing metadata.")

if __name__ == '__main__':
    main()
