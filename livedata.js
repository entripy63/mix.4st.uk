// livedata.js - Live stream data management and parsing
// Dependencies: core.js (storage, state)
// Used by: liveui.js, player.js

// Live streams configuration
// We can't always use the proxy because it hates jungletrain.net
const STREAM_PROXY = 'https://stream-proxy.round-bar-e93e.workers.dev';

// Built-in stream definitions (can be extended)
const BUILTIN_STREAM_DEFS = {
  // Will be populated with built-in streams if needed
};

// Data storage
let liveStreams = [];
let liveStreamsInitialized = false;

// ========== USER STREAM MANAGEMENT ==========

function getUserStreams() {
  return storage.getJSON('userStreams', []);
}

function saveUserStreams(streams) {
  storage.set('userStreams', streams);
}

async function addUserStream(name, m3u, genre) {
   const streams = getUserStreams();
   const config = { name: name || null, m3u, genre };
   streams.push(config);
   saveUserStreams(streams);
   
   if (liveStreamsInitialized) {
      await probeAndAddStream(config);
   }
}

function removeUserStream(index) {
   const streams = getUserStreams();
   streams.splice(index, 1);
   saveUserStreams(streams);
   
   if (liveStreamsInitialized && index < liveStreams.length) {
     liveStreams.splice(index, 1);
   }
}

function getLiveStreamConfig() {
  return getUserStreams();
}

// ========== STREAM PROBING & PLAYLIST PARSING ==========

function isRawIPURL(url) {
  // Check if URL contains a raw IP address (IPv4 or IPv6)
  // e.g., http://185.33.21.112/stream or http://[::1]:8000/stream
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    // IPv4: check if all parts are numeric (0-255)
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
      return true;
    }
    // IPv6: check if it starts with : or contains only hex digits and colons
    if (hostname.includes(':') || /^[0-9a-f:]+$/i.test(hostname)) {
      return true;
    }
  } catch (e) {
    // Invalid URL, assume not an IP
  }
  return false;
}

function probeStream(url, timeoutMs = 5000) {
  return new Promise(resolve => {
    const audio = new Audio();
    const timer = setTimeout(() => {
      audio.src = '';
      resolve(false);
    }, timeoutMs);
    
    audio.addEventListener('canplay', () => {
      clearTimeout(timer);
      audio.src = '';
      resolve(true);
    }, { once: true });
    
    audio.addEventListener('error', () => {
      clearTimeout(timer);
      resolve(false);
    }, { once: true });
    
    audio.src = url;
    audio.load();
  });
}

function parsePLS(text) {
   const entries = [];
   const lines = text.split('\n');
   const files = {};
   const titles = {};
   const MAX_ENTRIES = 500; // Reasonable limit for any real playlist
   
   for (const line of lines) {
     const fileMatch = line.match(/^File(\d+)=(.+)$/i);
     if (fileMatch && Object.keys(files).length < MAX_ENTRIES) {
       files[fileMatch[1]] = fileMatch[2].trim();
     }
     const titleMatch = line.match(/^Title(\d+)=(.+)$/i);
     if (titleMatch) {
       titles[titleMatch[1]] = titleMatch[2].trim();
     }
   }
   
   for (const num of Object.keys(files).sort((a, b) => a - b)) {
     entries.push({ url: files[num], title: titles[num] || null });
   }
   return entries;
}

function parseM3U(text) {
   const entries = [];
   const lines = text.split('\n').map(line => line.trim());
   let pendingTitle = null;
   const MAX_ENTRIES = 500; // Reasonable limit for any real playlist
   
   for (const line of lines) {
     if (entries.length >= MAX_ENTRIES) break; // Stop if too many entries
     
     if (line.startsWith('#EXTINF:')) {
       const commaIndex = line.indexOf(',');
       if (commaIndex !== -1) {
         pendingTitle = line.substring(commaIndex + 1).trim();
       }
     } else if (line && !line.startsWith('#')) {
       // Validate line looks like a URL or at least starts with common protocols
       if (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('mms://') || line.startsWith('rtmp://')) {
         entries.push({ url: line, title: pendingTitle });
         pendingTitle = null;
       }
     }
   }
   return entries;
}

async function fetchPlaylist(playlistUrl) {
   try {
     // Use proxy to avoid CORS errors on M3U and PLS playlists
     const url = `${STREAM_PROXY}?url=${encodeURIComponent(playlistUrl)}`;
     const controller = new AbortController();
     const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout
     const resp = await fetch(url, { signal: controller.signal });
     clearTimeout(timeout);
     
     // If it's audio, not a playlist, return empty to fallback to direct stream probe
     const contentType = resp.headers.get('content-type') || '';
     if (contentType.includes('audio/')) {
       return [];
     }
     
     const text = await resp.text();
     if (text.trim().toLowerCase().startsWith('[playlist]')) {
       return parsePLS(text);
     }
     return parseM3U(text);
   } catch {
     return [];
   }
}

// ========== STREAM PROBING & ADDITION ==========

async function probeAndAddStream(config) {
     const stream = {
       m3u: config.m3u,
       name: config.name,
       genre: config.genre,
       url: null,
       available: false,
       reason: null
     };
      
      // Check if it's a direct audio file URL, not a playlist
     const audioExtensions = ['.mp3', '.aac', '.flac', '.wav', '.ogg', '.opus', '.m4a'];
     const isDirectAudio = audioExtensions.some(ext => config.m3u.toLowerCase().endsWith(ext));
     
     let entries;
     if (isDirectAudio) {
       // Treat direct audio URL as single-entry list
       entries = [{ url: config.m3u, title: null }];
     } else {
       // Parse as playlist
       entries = await fetchPlaylist(config.m3u);
       // If playlist parsing returned nothing, try URL as direct stream
       if (entries.length === 0) {
         entries = [{ url: config.m3u, title: null }];
       }
     }
    for (const entry of entries) {
      let url = entry.url;
      
      // Try direct URL first
      if (await probeStream(url)) {
        stream.url = url;
        stream.playlistTitle = entry.title;
        stream.available = true;
        break;
      }
      
      // Try with ';' suffix for Shoutcast servers that redirect to text/html
      let urlWithSemicolon = url;
      if (!urlWithSemicolon.endsWith('/')) {
        urlWithSemicolon += '/';
      }
      urlWithSemicolon += ';';
      
      if (await probeStream(urlWithSemicolon)) {
        stream.url = urlWithSemicolon;
        stream.playlistTitle = entry.title;
        stream.available = true;
        break;
      }
      
      // Try via proxy for http:// on https: page
      // Skip proxy for raw IP URLs (Cloudflare Workers can't reach bare IPs)
      if (url.startsWith('http://') && location.protocol === 'https:' && !isRawIPURL(url)) {
        const proxyUrl = `${STREAM_PROXY}?url=${encodeURIComponent(url)}`;
        if (await probeStream(proxyUrl)) {
          stream.url = proxyUrl;
          stream.playlistTitle = entry.title;
          stream.available = true;
          break;
        }
        
        // Try proxy with ';' suffix for Shoutcast
        const proxyUrlWithSemicolon = `${STREAM_PROXY}?url=${encodeURIComponent(urlWithSemicolon)}`;
        if (await probeStream(proxyUrlWithSemicolon)) {
          stream.url = proxyUrlWithSemicolon;
          stream.playlistTitle = entry.title;
          stream.available = true;
          break;
        }
      }
    }
    if (!stream.available) {
      stream.reason = `No working stream found (playlist: ${config.m3u})`;
    }
    if (!stream.name && stream.playlistTitle) {
      const parsed = parseSomaFMStream(stream.playlistTitle, stream.genre);
      stream.name = parsed.name;
      if (!stream.genre) {
        stream.genre = parsed.genre;
      }
    }
    
    // Only persist resolved names from playlist (not auto-generated fallbacks)
    let nameWasResolved = false;
    if (!stream.name && stream.playlistTitle) {
       nameWasResolved = true;
    }
    
    if (!stream.name) {
       stream.name = config.m3u || 'Unknown Stream';
    }
    
    // Update the saved config with resolved name/genre if they were null
    // Only persist if name was actually resolved from playlist, not auto-generated
    if (!config.name && nameWasResolved) {
       config.name = stream.name;
       const configs = getUserStreams();
       const idx = configs.findIndex(c => c.m3u === config.m3u);
       if (idx >= 0) {
           configs[idx] = config;
           saveUserStreams(configs);
       }
    }
    if (!config.genre && stream.genre) {
       config.genre = stream.genre;
       const configs = getUserStreams();
       const idx = configs.findIndex(c => c.m3u === config.m3u);
       if (idx >= 0) {
           configs[idx] = config;
           saveUserStreams(configs);
       }
    }
    
    liveStreams.push(stream);
}

// ========== SOMA FM STREAM PARSING ==========

function parseSomaFMStream(title, genre) {
  // Parse SomaFM stream names like "Groovesalad;LC 128k aac;http://..."
  // Returns { name: 'Human readable name', genre: 'genre' }
  
  const parts = title.split(';').map(s => s.trim());
  let name = parts[0] || 'SomaFM Stream';
  let detectedGenre = genre;
  
  // Clean up the name if it has quality info
  if (parts[1]) {
    name = parts[0];
    if (parts[1].match(/\b(128|192|256|320)k\b/i)) {
      // Keep quality info if it's useful
    }
  }
  
  return { name, genre: detectedGenre };
}

// ========== INITIALIZATION ==========

async function loadDefaultStreamsOnFirstRun() {
    const userStreams = getUserStreams();
    // Only load default preset if user has no streams yet
    if (userStreams.length === 0) {
      try {
        const response = await fetch('/presets/Default.json');
        const preset = await response.json();
        if (preset.name && Array.isArray(preset.streams)) {
          for (const stream of preset.streams) {
            await addUserStream(stream.name || null, stream.m3u, stream.genre || null);
          }
        }
      } catch (e) {
        // Default preset not available, start with empty list
        console.log('Default preset not found, starting with empty stream list');
      }
    }
}

async function initLiveStreams() {
  if (liveStreamsInitialized) return;
  
  liveStreamsInitialized = true;
  liveStreams = [];
  const configs = getLiveStreamConfig();
  
  for (const config of configs) {
    await probeAndAddStream(config);
    // Callback to display streams as they're added (not all at once)
    if (window.onStreamAdded) {
      window.onStreamAdded();
    }
  }
}

// Live stream restoration for both SPAs
async function restoreLivePlayer() {
  try {
    const savedLiveUrl = storage.get('liveStreamUrl');
    const savedLiveText = storage.get('liveDisplayText');
    
    if (savedLiveUrl && savedLiveText) {
      state.isRestoring = true;
      const wasPlaying = storage.getBool('wasPlaying', false);
      playLive(savedLiveUrl, savedLiveText, wasPlaying);
      // Keep isRestoring true until after playLive's async setup (canplay listener, timeouts, etc.)
      setTimeout(() => {
        state.isRestoring = false;
      }, 200);
      await initLiveStreams();
      return true; // Restored live stream
    }
  } catch (e) {
    console.error('Error restoring live stream:', e);
  }
  return false; // Did not restore
}

// ========== PERSISTENCE & COLLECTIONS ==========

async function saveCollectionToFile() {
  const streams = getUserStreams();
  if (streams.length === 0) {
    alert('No streams to save');
    return;
  }
  
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `streams-${timestamp}.json`;
  
  const collection = {
    name: `Streams Export ${timestamp}`,
    streams: streams
  };
  
  const dataStr = JSON.stringify(collection, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  
  showToast(`Saved ${streams.length} stream${streams.length !== 1 ? 's' : ''}`);
}

async function loadCollectionFromFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      if (!data.streams || !Array.isArray(data.streams)) {
        throw new Error('Invalid collection format: missing "streams" array');
      }
      
      const currentStreams = getUserStreams();
      const existingM3Us = new Set(currentStreams.map(s => s.m3u));
      
      let added = 0;
      let skipped = 0;
      
      for (const stream of data.streams) {
        if (existingM3Us.has(stream.m3u)) {
          skipped++;
          continue;
        }
        
        await addUserStream(stream.name || null, stream.m3u, stream.genre || null);
        added++;
      }
      
      // Re-initialize to pick up new streams
      liveStreamsInitialized = false;
      await initLiveStreams();
      
      hideStreamCollectionsMenu();
      showToast(`Loaded ${data.name || 'collection'}`);
    } catch (err) {
      console.error('Failed to load collection:', err);
      alert(`Error loading collection: ${err.message}`);
    }
  };
  
  input.click();
}

async function clearAllStreams() {
   const confirmed = await showConfirmDialog('Clear All Streams', 'This will delete all streams. This cannot be undone.');
   if (!confirmed) return;
   
   saveUserStreams([]);
   liveStreamsInitialized = false;
   liveStreams = [];
   
   // Notify UI layer
   if (window.onLiveDataCleared) {
     window.onLiveDataCleared();
   }
   
   hideStreamCollectionsMenu();
   showToast('All streams cleared');
}

// ========== STREAM ORDER PERSISTENCE ==========

function saveLiveStreamOrder() {
  const rows = document.querySelectorAll('.mix-item');
  const order = [];
  rows.forEach(row => {
    const m3u = row.dataset.streamM3u;
    if (m3u) order.push(m3u);
  });
  if (order.length > 0) {
    const streams = getUserStreams();
    const reordered = order.map(m3u => streams.find(s => s.m3u === m3u)).filter(Boolean);
    saveUserStreams(reordered);
    liveStreams = liveStreams.filter((_, i) => order[i]); // Keep liveStreams in sync
  }
}

// Load default preset on first run, then initialize live streams
(async () => {
  await loadDefaultStreamsOnFirstRun();
  initLiveStreams().catch(e => console.error('Failed to initialize live streams:', e));
})();
