#!/usr/bin/env python3
"""Extract track lists from legacy HTML files and create .tracks.txt CSV files."""

import os
import re
from pathlib import Path
from html.parser import HTMLParser

class TrackListParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_table = False
        self.in_row = False
        self.in_cell = False
        self.in_header = False
        self.current_row = []
        self.current_cell = ''
        self.rows = []
        self.headers = []
        
    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            classes = dict(attrs).get('class', '')
            if 'border' in classes:
                self.in_table = True
        elif self.in_table:
            if tag == 'tr':
                self.in_row = True
                self.current_row = []
            elif tag == 'th':
                self.in_header = True
                self.in_cell = True
                self.current_cell = ''
            elif tag == 'td':
                self.in_cell = True
                self.current_cell = ''
                
    def handle_endtag(self, tag):
        if tag == 'table' and self.in_table:
            self.in_table = False
        elif self.in_table:
            if tag == 'tr':
                self.in_row = False
                if self.current_row:
                    if self.in_header:
                        self.headers = self.current_row
                        self.in_header = False
                    else:
                        self.rows.append(self.current_row)
            elif tag in ('td', 'th'):
                self.current_row.append(self.current_cell.strip())
                self.in_cell = False
                
    def handle_data(self, data):
        if self.in_cell:
            self.current_cell += data
            
    def handle_entityref(self, name):
        if self.in_cell:
            entities = {'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', 'apos': "'"}
            self.current_cell += entities.get(name, f'&{name};')

def escape_csv(value):
    """Escape value for CSV (handle commas and quotes)."""
    if not value:
        return ''
    if ',' in value or '"' in value:
        return '"' + value.replace('"', '""') + '"'
    return value

def extract_tracklist(html_path):
    """Extract track list from HTML file, returns (headers, rows) or None."""
    with open(html_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Check if tracklist is available
    if 'Tracklist not available' in content:
        return None
    
    parser = TrackListParser()
    parser.feed(content)
    
    if not parser.rows:
        return None
    
    return parser.headers, parser.rows

def determine_csv_format(headers, rows):
    """Determine output format based on headers and content."""
    headers_lower = [h.lower() for h in headers]
    
    has_time = 'time' in headers_lower
    has_remixer = 'remixer' in headers_lower
    
    # Check if remixer column has any non-empty values
    if has_remixer:
        remixer_idx = headers_lower.index('remixer')
        has_remixer_data = any(len(row) > remixer_idx and row[remixer_idx].strip() for row in rows)
    else:
        has_remixer_data = False
    
    return has_time, has_remixer_data

def convert_to_csv(headers, rows):
    """Convert track list to CSV format: time,title,artist[,remixer]."""
    headers_lower = [h.lower() for h in headers]
    
    # Find column indices
    time_idx = headers_lower.index('time') if 'time' in headers_lower else -1
    title_idx = headers_lower.index('title') if 'title' in headers_lower else 0
    artist_idx = headers_lower.index('artist') if 'artist' in headers_lower else 1
    remixer_idx = headers_lower.index('remixer') if 'remixer' in headers_lower else -1
    
    # Check if we have any remixer data
    has_remixer_data = remixer_idx >= 0 and any(
        len(row) > remixer_idx and row[remixer_idx].strip() for row in rows
    )
    
    lines = []
    lines.append('# Track list')
    if has_remixer_data:
        lines.append('# Format: time,title,artist,remixer')
    else:
        lines.append('# Format: time,title,artist')
    lines.append('')
    
    for row in rows:
        time = row[time_idx] if time_idx >= 0 and len(row) > time_idx else ''
        title = row[title_idx] if len(row) > title_idx else ''
        artist = row[artist_idx] if len(row) > artist_idx else ''
        remixer = row[remixer_idx] if remixer_idx >= 0 and len(row) > remixer_idx else ''
        
        if has_remixer_data:
            line = f"{escape_csv(time)},{escape_csv(title)},{escape_csv(artist)},{escape_csv(remixer)}"
        else:
            line = f"{escape_csv(time)},{escape_csv(title)},{escape_csv(artist)}"
        lines.append(line)
    
    return '\n'.join(lines) + '\n'

def main():
    base_dir = Path(__file__).parent
    dj_dirs = ['trip', 'izmar', 'aboo']
    
    created = []
    skipped = []
    no_tracklist = []
    
    for dj in dj_dirs:
        dj_path = base_dir / dj
        if not dj_path.exists():
            continue
        
        for html_file in dj_path.glob('*.html'):
            # Skip index.html
            if html_file.name == 'index.html':
                continue
            
            # Output file name: same base name with .tracks.txt
            base_name = html_file.stem
            csv_path = dj_path / f'{base_name}.tracks.txt'
            
            # Skip if already exists
            if csv_path.exists():
                skipped.append(f'{dj}/{csv_path.name}')
                continue
            
            result = extract_tracklist(html_file)
            if result is None:
                no_tracklist.append(f'{dj}/{html_file.name}')
                continue
            
            headers, rows = result
            csv_content = convert_to_csv(headers, rows)
            
            with open(csv_path, 'w', encoding='utf-8') as f:
                f.write(csv_content)
            
            created.append(f'{dj}/{csv_path.name}')
            print(f'Created: {csv_path.name} ({len(rows)} tracks)')
    
    print('\n' + '=' * 60)
    print('SUMMARY')
    print('=' * 60)
    print(f'Created: {len(created)}')
    for f in created:
        print(f'  {f}')
    
    if skipped:
        print(f'\nSkipped (already exists): {len(skipped)}')
        for f in skipped:
            print(f'  {f}')
    
    if no_tracklist:
        print(f'\nNo tracklist in HTML: {len(no_tracklist)}')
        for f in no_tracklist:
            print(f'  {f}')

if __name__ == '__main__':
    main()
