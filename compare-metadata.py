#!/usr/bin/env python3
"""Compare mix metadata from HTML files vs media file tags."""

import os
import subprocess
import json
import re
from pathlib import Path
from html.parser import HTMLParser

class MixHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.mixes = []
        self.in_td = False
        self.in_a = False
        self.current_row = {}
        self.td_count = 0
        
    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
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
        if tag == 'td':
            self.in_td = False
        elif tag == 'a':
            self.in_a = False
        elif tag == 'tr' and self.current_row.get('href'):
            self.mixes.append(self.current_row)
            
    def handle_data(self, data):
        if self.in_td and self.td_count == 1:
            self.current_row['duration_html'] = data.strip()
        elif self.in_a:
            self.current_row['name_html'] = data.strip()

def parse_html_duration(duration_str):
    """Convert '1h03m' to seconds."""
    hours = 0
    minutes = 0
    h_match = re.search(r'(\d+)h', duration_str)
    m_match = re.search(r'(\d+)m', duration_str)
    if h_match:
        hours = int(h_match.group(1))
    if m_match:
        minutes = int(m_match.group(1))
    return hours * 3600 + minutes * 60

def format_duration(seconds):
    """Convert seconds to 'Xh Ym' format."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    if hours > 0:
        return f"{hours}h{minutes:02d}m"
    return f"{minutes}m"

def get_media_metadata(filepath):
    """Extract metadata from media file using ffprobe."""
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', filepath],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        data = json.loads(result.stdout.decode('utf-8'))
        fmt = data.get('format', {})
        tags = fmt.get('tags', {})
        # Handle case-insensitive tag names
        title = tags.get('title') or tags.get('TITLE') or ''
        artist = tags.get('artist') or tags.get('ARTIST') or ''
        duration = float(fmt.get('duration', 0))
        return {
            'title': title,
            'artist': artist,
            'duration': duration,
            'duration_fmt': format_duration(duration)
        }
    except Exception as e:
        return {'title': '', 'artist': '', 'duration': 0, 'duration_fmt': '', 'error': str(e)}

def find_media_files(directory):
    """Find all media files in directory, returning all formats per base."""
    extensions = {'.mp3', '.flac', '.m4a'}
    files = {}
    for f in Path(directory).iterdir():
        if f.suffix.lower() in extensions:
            base = f.stem
            if base not in files:
                files[base] = []
            files[base].append(f)
    return files

def get_best_metadata(file_list):
    """Get metadata from all files, preferring files with tags."""
    best = {'title': '', 'artist': '', 'duration': 0, 'duration_fmt': '', 'files': []}
    for f in file_list:
        meta = get_media_metadata(str(f))
        best['files'].append(f.name)
        if meta.get('duration', 0) > best['duration']:
            best['duration'] = meta['duration']
            best['duration_fmt'] = meta['duration_fmt']
        if meta.get('title') and not best['title']:
            best['title'] = meta['title']
        if meta.get('artist') and not best['artist']:
            best['artist'] = meta['artist']
    return best

def main():
    base_dir = Path(__file__).parent
    dj_dirs = ['trip', 'izmar', 'aboo']
    
    all_results = []
    
    for dj in dj_dirs:
        dj_path = base_dir / dj
        if not dj_path.exists():
            continue
            
        index_html = dj_path / 'index.html'
        html_mixes = {}
        
        if index_html.exists():
            with open(index_html, 'r') as f:
                parser = MixHTMLParser()
                parser.feed(f.read())
                for mix in parser.mixes:
                    href = mix.get('href', '')
                    base = href.replace('.html', '')
                    html_mixes[base] = mix
        
        media_files = find_media_files(dj_path)
        
        all_bases = set(html_mixes.keys()) | set(media_files.keys())
        
        for base in sorted(all_bases):
            html = html_mixes.get(base, {})
            media_list = media_files.get(base, [])
            meta = get_best_metadata(media_list) if media_list else {}
            
            html_name = html.get('name_html', '')
            html_dur = html.get('duration_html', '')
            meta_title = meta.get('title', '')
            meta_artist = meta.get('artist', '')
            meta_dur = meta.get('duration_fmt', '')
            
            # Determine status
            status = []
            if not media_list:
                status.append('NO_MEDIA')
            if not html:
                status.append('NO_HTML')
            if media_list and not meta_title:
                status.append('NO_TITLE_TAG')
            if html_name and meta_title and html_name.lower() != meta_title.lower():
                status.append('TITLE_MISMATCH')
            if not status:
                status.append('OK')
            
            all_results.append({
                'dj': dj,
                'base': base,
                'html_name': html_name,
                'html_dur': html_dur,
                'meta_title': meta_title,
                'meta_artist': meta_artist,
                'meta_dur': meta_dur,
                'status': ', '.join(status),
                'media_file': ', '.join(meta.get('files', []))
            })
    
    # Print results as table
    print(f"{'DJ':<6} {'File':<18} {'HTML Name':<28} {'Meta Title':<28} {'HTML Dur':<8} {'Meta Dur':<8} {'Status'}")
    print('=' * 130)
    
    for r in all_results:
        print(f"{r['dj']:<6} {r['base']:<18} {r['html_name']:<28} {r['meta_title']:<28} {r['html_dur']:<8} {r['meta_dur']:<8} {r['status']}")
    
    # Summary
    print('\n' + '=' * 130)
    print('SUMMARY')
    print('=' * 130)
    
    ok = sum(1 for r in all_results if r['status'] == 'OK')
    no_title = sum(1 for r in all_results if 'NO_TITLE_TAG' in r['status'])
    mismatch = sum(1 for r in all_results if 'TITLE_MISMATCH' in r['status'])
    no_html = sum(1 for r in all_results if 'NO_HTML' in r['status'])
    
    print(f"Total mixes: {len(all_results)}")
    print(f"OK (metadata matches HTML): {ok}")
    print(f"Missing title tag: {no_title}")
    print(f"Title mismatch (different name): {mismatch}")
    print(f"No HTML file (metadata only): {no_html}")
    
    if no_title or mismatch:
        print('\n' + '=' * 130)
        print('FILES NEEDING METADATA UPDATE:')
        print('=' * 130)
        for r in all_results:
            if 'NO_TITLE_TAG' in r['status'] or 'TITLE_MISMATCH' in r['status']:
                suggested = r['html_name'] or r['base']
                print(f"  {r['dj']}/{r['media_file']}: title=\"{suggested}\"")

if __name__ == '__main__':
    main()
