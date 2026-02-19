async function fetchDJMixes(djPath) {
  const response = await fetch(`${djPath}/manifest.json`);
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
    coverFile: mix.coverFile,
    djPath: djPath
  }));
}

// Universal selection phrases (DJ-agnostic common terms)
const UNIVERSAL_SELECTIONS = ['guest mix'];

function detectGroups(mixes) {
  // Skip heuristics if 7 or fewer mixes
  if (mixes.length <= 7) {
    return [];
  }
  
  const names = mixes.map(m => m.name.toLowerCase());
  const originalNames = mixes.map(m => m.name);
  const djName = mixes[0]?.dj?.toLowerCase() || '';
  const candidates = new Map(); // keyword -> Set of mix indices
  
  // Check for universal selection phrases first
  for (const phrase of UNIVERSAL_SELECTIONS) {
    const mixIndices = new Set(
      names.map((n, i) => n.includes(phrase) ? i : -1).filter(i => i !== -1)
    );
    if (mixIndices.size >= 3) {
      candidates.set(phrase, mixIndices);
    }
  }
  
  // Extract potential group keywords from each name
  for (let mixIdx = 0; mixIdx < names.length; mixIdx++) {
    const name = names[mixIdx];
    // Split into words (letters only, 3+ chars)
    const words = name.match(/[a-z]{3,}/g) || [];
    const seenInThisMix = new Set(); // avoid double-counting within same mix
    
    // Single words (4+ chars) as candidates, excluding DJ name
    for (const word of words) {
      if (word.length >= 4 && word !== djName && !seenInThisMix.has(word)) {
        if (!candidates.has(word)) candidates.set(word, new Set());
        candidates.get(word).add(mixIdx);
        seenInThisMix.add(word);
      }
    }
    
    // Multi-word phrases as candidates (2-4 words)
    // First word must be 4+ chars, last word must be 4+ chars OR "mix"
    // Middle words can be shorter (e.g., "the", "of")
    // Exclude phrases that start with the DJ name
    for (let i = 0; i < words.length - 1; i++) {
      if (words[i].length >= 4 && words[i] !== djName) {
        for (let len = 2; len <= 4 && i + len <= words.length; len++) {
          const lastWord = words[i + len - 1];
          if (lastWord.length >= 4 || lastWord === 'mix') {
            const phrase = words.slice(i, i + len).join(' ');
            if (!seenInThisMix.has(phrase)) {
              if (!candidates.has(phrase)) candidates.set(phrase, new Set());
              candidates.get(phrase).add(mixIdx);
              seenInThisMix.add(phrase);
            }
          }
        }
      }
    }
  }
  
  // Filter to candidates appearing in 3+ mixes, sort by count descending
  // Reject candidates that match ALL mixes (duplicative of All selection)
  // Reject single-mix candidates (not worthwhile as a selection)
  let groups = Array.from(candidates.entries())
    .filter(([_, mixIndices]) => {
      const count = mixIndices.size;
      return count >= 3 && count > 1 && count < mixes.length;
    })
    .sort((a, b) => b[1].size - a[1].size)
    .map(([keyword, mixIndices]) => ({ keyword, count: mixIndices.size }));
  
  // Remove redundant groups (but preserve universal selections)
  const getMatches = (kw) => new Set(names.filter(n => n.includes(kw)));
  const kept = [];
  for (const g of groups) {
    // Universal selections are always kept
    if (UNIVERSAL_SELECTIONS.includes(g.keyword)) {
      kept.push(g);
      continue;
    }
    
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
  // Use Title Case as fallback if not found or all lowercase
  const toTitleCase = (str) => str.replace(/\b\w/g, c => c.toUpperCase());
  const result = groups.map(g => {
    for (const orig of originalNames) {
      const idx = orig.toLowerCase().indexOf(g.keyword);
      if (idx >= 0) {
        const found = orig.substring(idx, idx + g.keyword.length);
        // If found text is all lowercase, use Title Case instead
        if (found === found.toLowerCase()) {
          return toTitleCase(found);
        }
        return found;
      }
    }
    return toTitleCase(g.keyword);
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

// Encode filename for URL (handles # and other special chars)
function encodeFilename(filename) {
  return filename.split('/').map(part => encodeURIComponent(part)).join('/');
}

async function fetchMixDetails(mix) {
  const djPath = mix.djPath || mix.dj;
  const dir = `${djPath}/`;
  
  // Load peaks if available
  let peaks = null;
  if (mix.peaksFile) {
    try {
      const peaksResponse = await fetch(dir + encodeFilename(mix.peaksFile));
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
    href: dir + encodeFilename(d.file),
    label: d.label
  }));
  
  // Try to load track list from .tracks.txt (CSV)
  let trackListTable = '';
  const txtPath = `${dir}${encodeFilename(mix.file)}.tracks.txt`;
  
  try {
    const txtResponse = await fetch(txtPath);
    if (txtResponse.ok) {
      const txt = await txtResponse.text();
      trackListTable = parseTrackListCSV(txt);
    }
  } catch (e) {
    // No track list file, that's fine
  }
  
  // Cover art URL
  const coverSrc = mix.coverFile ? dir + encodeFilename(mix.coverFile) : null;
  
  return {
    audioSrc: dir + encodeFilename(mix.audioFile),
    trackListTable,
    peaks,
    downloadLinks,
    coverSrc
  };
}

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseTrackListCSV(txt) {
  const lines = txt.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  if (lines.length === 0) return '';
  
  const hasTime = lines.some(line => parseCSVLine(line)[0]);
  const hasRemixer = lines.some(line => parseCSVLine(line)[3]);
  
  const rows = lines.map(line => {
    const parts = parseCSVLine(line);
    const time = parts[0] || '';
    const title = parts[1] || '';
    const artist = parts[2] || '';
    const remixer = parts[3] || '';
    let cells = '';
    if (hasTime) cells += `<td>${escapeHtml(time)}</td>`;
    cells += `<td>${escapeHtml(title)}</td><td>${escapeHtml(artist)}</td>`;
    if (hasRemixer) cells += `<td>${escapeHtml(remixer)}</td>`;
    return `<tr>${cells}</tr>`;
  });
  
  let header = '<tr>';
  if (hasTime) header += '<th>Time</th>';
  header += '<th>Title</th><th>Artist</th>';
  if (hasRemixer) header += '<th>Remixer</th>';
  header += '</tr>';
  
  return `<table class="border">${header}${rows.join('')}</table>`;
}


