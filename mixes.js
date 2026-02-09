async function fetchDJMixes(djPath) {
  // Try manifest.json first (new metadata-based approach)
  try {
    const response = await fetch(`${djPath}/manifest.json`);
    if (response.ok) {
      const manifest = await response.json();
      return manifest.mixes.map(mix => ({
        name: mix.name,
        file: mix.file,
        audioFile: mix.audioFile,
        duration: mix.durationFormatted,
        durationSeconds: mix.duration,
        artist: mix.artist,
        genre: mix.genre,
        date: mix.date,
        comment: mix.comment,
        downloads: mix.downloads,
        peaksFile: mix.peaksFile,
        djPath: djPath
      }));
    }
  } catch (e) {
    // Fall back to HTML parsing
  }
  
  // Fallback: parse legacy index.html
  const response = await fetch(`${djPath}/index.html`);
  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  const mixes = [];
  const rows = doc.querySelectorAll('table.border tr');
  
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    const link = row.querySelector('td a');
    if (link && cells.length >= 2) {
      const durationRaw = cells[0].textContent.trim();
      mixes.push({
        name: link.textContent,
        htmlPath: `${djPath}/${link.getAttribute('href')}`,
        duration: formatDuration(durationRaw),
        djPath: djPath
      });
    }
  });
  
  return mixes;
}

function formatDuration(raw) {
  const hMatch = raw.match(/(\d+)h/);
  const mMatch = raw.match(/(\d+)m/);
  const hours = hMatch ? parseInt(hMatch[1]) : 0;
  const minutes = mMatch ? parseInt(mMatch[1]) : 0;
  return `${hours}:${minutes.toString().padStart(2, '0')}:00`;
}

function detectGroups(mixes) {
  const names = mixes.map(m => m.name.toLowerCase());
  const originalNames = mixes.map(m => m.name);
  const candidates = new Map(); // keyword -> count
  
  // Extract potential group keywords from each name
  for (const name of names) {
    // Split into words (letters only, 3+ chars)
    const words = name.match(/[a-z]{3,}/g) || [];
    
    // Single words (4+ chars) as candidates
    for (const word of words) {
      if (word.length >= 4) {
        candidates.set(word, (candidates.get(word) || 0) + 1);
      }
    }
    
    // Multi-word phrases as candidates (2-4 words)
    // First and last words must be 4+ chars, middle words can be shorter (e.g., "the", "of")
    for (let i = 0; i < words.length - 1; i++) {
      if (words[i].length >= 4) {
        for (let len = 2; len <= 4 && i + len <= words.length; len++) {
          const lastWord = words[i + len - 1];
          if (lastWord.length >= 4) {
            const phrase = words.slice(i, i + len).join(' ');
            candidates.set(phrase, (candidates.get(phrase) || 0) + 1);
          }
        }
      }
    }
  }
  
  // Filter to candidates appearing in 3+ mixes, sort by count descending
  let groups = Array.from(candidates.entries())
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([keyword, count]) => ({ keyword, count }));
  
  // Remove redundant groups
  const getMatches = (kw) => new Set(names.filter(n => n.includes(kw)));
  const kept = [];
  for (const g of groups) {
    const myMatches = getMatches(g.keyword);
    let dominated = false;
    
    // Skip if a more specific phrase covers most of our matches
    for (const other of groups) {
      if (other.keyword !== g.keyword && other.keyword.includes(g.keyword)) {
        const otherMatches = getMatches(other.keyword);
        const overlap = [...myMatches].filter(m => otherMatches.has(m)).length;
        if (overlap >= myMatches.size * 0.6) { dominated = true; break; }
      }
    }
    
    // Skip single words if a phrase containing it has 50%+ of our count
    if (!dominated && !g.keyword.includes(' ')) {
      for (const other of groups) {
        if (other.keyword.includes(' ') && other.keyword.includes(g.keyword)) {
          if (other.count >= g.count * 0.5) { dominated = true; break; }
        }
      }
    }
    
    // Skip if heavily overlaps with already-kept group
    if (!dominated) {
      for (const k of kept) {
        const kMatches = getMatches(k.keyword);
        const overlap = [...myMatches].filter(m => kMatches.has(m)).length;
        if (overlap >= Math.min(myMatches.size, kMatches.size) * 0.7) {
          dominated = true; break;
        }
      }
    }
    
    if (!dominated) kept.push(g);
  }
  groups = kept;
  
  // Limit to top 5 groups max
  groups = groups.slice(0, 5);
  
  // Find canonical capitalization from original names, keep sorted by count
  const result = groups.map(g => {
    for (const orig of originalNames) {
      const idx = orig.toLowerCase().indexOf(g.keyword);
      if (idx >= 0) {
        return orig.substring(idx, idx + g.keyword.length);
      }
    }
    return g.keyword;
  });
  
  return result; // Already sorted by count descending
}

function longestCommonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.substring(0, i);
}

function filterMixes(mixes, group, allGroups) {
  if (!group) return mixes;
  if (group === 'Other') {
    return mixes.filter(mix => 
      !allGroups.some(g => mix.name.toLowerCase().includes(g.toLowerCase()))
    );
  }
  return mixes.filter(mix => mix.name.toLowerCase().includes(group.toLowerCase()));
}

async function fetchMixDetails(mix) {
  // If mix came from manifest, we already have most details
  if (mix.audioFile) {
    const dir = `${mix.djPath}/`;
    
    // Load peaks if available
    let peaks = null;
    if (mix.peaksFile) {
      try {
        const peaksResponse = await fetch(dir + mix.peaksFile);
        if (peaksResponse.ok) {
          const peaksData = await peaksResponse.json();
          peaks = peaksData.peaks;
        }
      } catch (e) {
        // Peaks file doesn't exist, that's fine
      }
    }
    
    // Build download links
    const downloadLinks = (mix.downloads || []).map(d => ({
      href: dir + d.file,
      label: d.label
    }));
    
    // Try to load track list from .tracks.txt (CSV) or .html file
    let trackListTable = '';
    const txtPath = `${dir}${mix.file}.tracks.txt`;
    const htmlPath = `${dir}${mix.file}.html`;
    
    // Try CSV track list first
    try {
      const txtResponse = await fetch(txtPath);
      if (txtResponse.ok) {
        const txt = await txtResponse.text();
        trackListTable = parseTrackListCSV(txt);
      }
    } catch (e) {
      // No txt file, try HTML
    }
    
    // Fall back to HTML track list
    if (!trackListTable) {
      try {
        const htmlResponse = await fetch(htmlPath);
        if (htmlResponse.ok) {
          const html = await htmlResponse.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const table = doc.querySelector('table.border');
          trackListTable = table ? table.outerHTML : '';
        }
      } catch (e) {
        // No HTML file, that's fine
      }
    }
    
    // Cover art URL
    const coverSrc = mix.coverFile ? dir + mix.coverFile : null;
    
    return {
      audioSrc: dir + mix.audioFile,
      trackListTable,
      peaks,
      downloadLinks,
      coverSrc
    };
  }
  
  // Fallback: legacy HTML-based approach
  const htmlPath = mix.htmlPath;
  const response = await fetch(htmlPath);
  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  const audio = doc.querySelector('audio');
  const audioSrc = audio ? audio.getAttribute('src') : null;
  
  const table = doc.querySelector('table.border');
  const trackListTable = table ? table.outerHTML : '';
  
  const dir = htmlPath.substring(0, htmlPath.lastIndexOf('/') + 1);
  
  // Extract download links
  const downloadLinks = Array.from(doc.querySelectorAll('a.download-link')).map(a => ({
    href: dir + a.getAttribute('href'),
    label: a.textContent
  }));
  const fullAudioSrc = audioSrc ? dir + audioSrc : null;
  
  // Try to load peaks file
  let peaks = null;
  if (audioSrc) {
    const peaksPath = dir + audioSrc.replace(/\.[^/.]+$/, '.peaks.json');
    try {
      const peaksResponse = await fetch(peaksPath);
      if (peaksResponse.ok) {
        const peaksData = await peaksResponse.json();
        peaks = peaksData.peaks;
      }
    } catch (e) {
      // Peaks file doesn't exist, that's fine
    }
  }
  
  return { audioSrc: fullAudioSrc, trackListTable, peaks, downloadLinks };
}

function parseTrackListCSV(txt) {
  const lines = txt.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  if (lines.length === 0) return '';
  
  const rows = lines.map(line => {
    const parts = line.split(',').map(p => p.trim());
    const time = parts[0] || '';
    const title = parts[1] || '';
    const artist = parts[2] || '';
    return `<tr>${time ? `<td>${escapeHtml(time)}</td>` : ''}<td>${escapeHtml(title)}</td><td>${escapeHtml(artist)}</td></tr>`;
  });
  
  const hasTime = lines.some(line => line.split(',')[0]?.trim());
  const header = hasTime 
    ? '<tr><th>Time</th><th>Title</th><th>Artist</th></tr>'
    : '<tr><th>Title</th><th>Artist</th></tr>';
  
  return `<table class="border">${header}${rows.join('')}</table>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
