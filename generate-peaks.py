#!/usr/bin/env python3
"""
Generate waveform peaks JSON files from audio files.
Requires: ffmpeg

Usage: 
    python3 generate-peaks.py [directory]
    python3 generate-peaks.py --source /path/to/audio [output_directory]

Default directory is current directory.
Processes all .mp3 and .flac files, creates .peaks.json files.

If --source is specified, reads audio from source and writes peaks to output directory.
"""

import subprocess
import json
import os
import sys
import struct

SAMPLES_PER_PEAK = 4000  # Number of peaks to generate

def get_audio_peaks(audio_path, num_peaks=SAMPLES_PER_PEAK):
    """Extract peaks from audio file using ffmpeg."""
    
    # Get duration first
    proc = subprocess.Popen([
        'ffprobe', '-v', 'quiet', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', audio_path
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout, _ = proc.communicate()
    
    duration = float(stdout.decode().strip())
    
    # Calculate samples needed (low sample rate for efficiency)
    sample_rate = max(100, int(num_peaks / duration * 10))
    
    # Extract raw audio samples using ffmpeg
    proc = subprocess.Popen([
        'ffmpeg', '-i', audio_path,
        '-ac', '1',  # mono
        '-ar', str(sample_rate),  # low sample rate
        '-f', 's16le',  # 16-bit signed little-endian
        '-v', 'quiet',
        '-'
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout, _ = proc.communicate()
    
    # Parse samples
    samples = []
    data = stdout
    for i in range(0, len(data) - 1, 2):
        sample = struct.unpack('<h', data[i:i+2])[0]
        samples.append(abs(sample) / 32768.0)  # Normalize to 0-1
    
    if not samples:
        return None, duration
    
    # Downsample to target number of peaks
    chunk_size = max(1, len(samples) // num_peaks)
    peaks = []
    for i in range(0, len(samples), chunk_size):
        chunk = samples[i:i + chunk_size]
        if chunk:
            peaks.append(max(chunk))
    
    # Ensure we have exactly num_peaks
    if len(peaks) > num_peaks:
        peaks = peaks[:num_peaks]
    
    # Normalize to 0-1 range based on max peak
    max_peak = max(peaks) if peaks else 1
    if max_peak > 0:
        peaks = [p / max_peak for p in peaks]
    
    return peaks, duration

def process_directory(directory):
    """Process all audio files in directory (read and write in same directory)."""
    process_directory_split(directory, directory)

def process_directory_split(source_directory, output_directory):
    """Process audio files from source directory, write peaks to output directory."""
    
    extensions = ('.mp3', '.flac', '.m4a', '.wav', '.opus')
    
    for filename in sorted(os.listdir(source_directory)):
        if not filename.lower().endswith(extensions):
            continue
            
        source_path = os.path.join(source_directory, filename)
        peaks_path = os.path.join(output_directory, os.path.splitext(filename)[0] + '.peaks.json')
        
        if os.path.exists(peaks_path):
            print(f"Skipping {filename} (peaks file exists)")
            continue
        
        print(f"Processing {filename}...", end=' ', flush=True)
        
        try:
            peaks, duration = get_audio_peaks(source_path)
            if peaks:
                with open(peaks_path, 'w') as f:
                    json.dump({'peaks': peaks, 'duration': duration}, f)
                print(f"OK ({len(peaks)} peaks, {duration:.0f}s)")
            else:
                print("FAILED (no samples)")
        except Exception as e:
            print(f"ERROR: {e}")

def find_dj_directories(base_directory):
    """Find all directories containing audio files, including nested ones in moreDJs/."""
    dj_dirs = []
    extensions = ('.mp3', '.flac', '.m4a', '.wav', '.opus')
    
    for entry in sorted(os.listdir(base_directory)):
        path = os.path.join(base_directory, entry)
        if os.path.isdir(path) and not entry.startswith('.'):
            if entry == 'moreDJs':
                # Scan subdirectories within moreDJs
                for subentry in sorted(os.listdir(path)):
                    subpath = os.path.join(path, subentry)
                    if os.path.isdir(subpath):
                        has_audio = any(f.lower().endswith(extensions) for f in os.listdir(subpath))
                        if has_audio:
                            dj_dirs.append((f"moreDJs/{subentry}", subpath))
            else:
                # Check root-level directories
                has_audio = any(f.lower().endswith(extensions) for f in os.listdir(path))
                if has_audio:
                    dj_dirs.append((entry, path))
    
    return dj_dirs

if __name__ == '__main__':
    source_dir = None
    output_dir = None
    
    # Parse arguments
    if len(sys.argv) > 1 and sys.argv[1] == '--source':
        if len(sys.argv) < 3:
            print("Error: --source requires a path argument")
            sys.exit(1)
        source_dir = sys.argv[2]
        output_dir = sys.argv[3] if len(sys.argv) > 3 else '.'
        
        if not os.path.exists(source_dir):
            print(f"Error: source directory {source_dir} does not exist")
            sys.exit(1)
    else:
        directory = sys.argv[1] if len(sys.argv) > 1 else '.'
        output_dir = directory
    
    extensions = ('.mp3', '.flac', '.m4a', '.wav', '.opus')
    
    # If source specified, process from source to output
    if source_dir:
        print(f"Reading audio from: {source_dir}")
        print(f"Writing peaks to: {output_dir}")
        
        dj_dirs = find_dj_directories(source_dir)
        for name, source_path in dj_dirs:
            # Create corresponding output directory
            if name.startswith('moreDJs/'):
                dj_name = name.split('/')[1]
                output_path = os.path.join(output_dir, 'moreDJs', dj_name)
            else:
                output_path = os.path.join(output_dir, name)
            
            os.makedirs(output_path, exist_ok=True)
            
            print(f"\n=== {name} ===")
            process_directory_split(source_path, output_path)
    else:
        # Original behavior: check if a specific DJ directory is given
        if len(sys.argv) > 1 and any(f.lower().endswith(extensions) for f in os.listdir(output_dir)):
            print(f"\n=== {os.path.basename(output_dir)} ===")
            process_directory(output_dir)
        else:
            # Process all DJ directories
            dj_dirs = find_dj_directories(output_dir)
            for name, path in dj_dirs:
                print(f"\n=== {name} ===")
                process_directory(path)
