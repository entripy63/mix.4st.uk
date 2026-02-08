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
  const names = mixes.map(m => m.name);
  const groups = [];
  
  // Find longest common prefixes shared by 2+ mixes
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const prefix = longestCommonPrefix(names[i], names[j]);
      if (prefix && prefix.length >= 3) {
        // Trim to word boundary
        const trimmed = prefix.replace(/\s+\S*$/, '').trim();
        if (trimmed && !groups.includes(trimmed)) {
          // Verify at least 2 mixes match this prefix
          const count = names.filter(n => n.startsWith(trimmed + ' ') || n === trimmed).length;
          if (count >= 2) groups.push(trimmed);
        }
      }
    }
  }
  
  // Remove groups that are substrings of other groups
  const filtered = groups.filter(g => 
    !groups.some(other => other !== g && other.startsWith(g + ' '))
  );
  
  return filtered.sort();
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
      !allGroups.some(g => mix.name.startsWith(g + ' ') || mix.name === g)
    );
  }
  return mixes.filter(mix => mix.name.startsWith(group + ' ') || mix.name === group);
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
    
    // Try to load track list from HTML file if it exists
    let trackListHeading = '';
    let trackListTable = '';
    const htmlPath = `${dir}${mix.file}.html`;
    try {
      const htmlResponse = await fetch(htmlPath);
      if (htmlResponse.ok) {
        const html = await htmlResponse.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const h1 = doc.querySelector('h1[id], h1:not(:first-of-type)') || 
                   Array.from(doc.querySelectorAll('h1')).find(h => h.textContent.includes('Track List'));
        trackListHeading = h1 ? h1.outerHTML : '';
        
        const table = doc.querySelector('table.border');
        trackListTable = table ? table.outerHTML : '';
      }
    } catch (e) {
      // No HTML file, that's fine
    }
    
    return {
      audioSrc: dir + mix.audioFile,
      trackListHeading,
      trackListTable,
      peaks,
      downloadLinks
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
  
  const h1 = doc.querySelector('h1[id], h1:not(:first-of-type)') || 
             Array.from(doc.querySelectorAll('h1')).find(h => h.textContent.includes('Track List'));
  const trackListHeading = h1 ? h1.outerHTML : '';
  
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
  
  return { audioSrc: fullAudioSrc, trackListHeading, trackListTable, peaks, downloadLinks };
}
