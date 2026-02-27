// livestore.js - Stream collection persistence (save/load/clear)
// Dependencies: core.js (storage), livedata.js (stream data), modals.js (dialogs)
// Used by: liveui.js (onclick handlers)

// Track metadata for current collection (loaded from file or defaults)
let collectionMetadata = {
  name: null,
  category: 'other'
};

async function saveCollectionToFile() {
  // Use display order (liveStreams) not storage order, in case user dragged/reordered
  const streams = liveStreams.map(stream => ({
    name: stream.name,
    m3u: stream.m3u,
    genre: stream.genre || null
  }));
  
  if (streams.length === 0) {
    alert('No streams to save');
    return;
  }
  
  // Show metadata editor modal
  showCollectionMetadataModal(streams);
}

function showCollectionMetadataModal(streams) {
  const modal = document.createElement('div');
  modal.id = 'collectionMetadataModal';
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.5); display: flex; align-items: center;
    justify-content: center; z-index: 10000;
  `;
  
  const defaultName = `Streams Export ${new Date().toISOString().split('T')[0]}`;
  const currentName = collectionMetadata.name || defaultName;
  const currentCategory = collectionMetadata.category || 'other';
  
  const categories = ['genre', 'country', 'other'];
  let categoryOptions = categories.map(cat => 
    `<option value="${cat}" ${cat === currentCategory ? 'selected' : ''}>${cat.charAt(0).toUpperCase() + cat.slice(1)}</option>`
  ).join('');
  
  modal.innerHTML = `
    <div style="background: #252542; border: 1px solid #3d3d5c; border-radius: 8px; padding: 20px; max-width: 400px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
      <h2 style="margin: 0 0 16px 0; color: #e0e0e0; font-size: 18px;">Save Collection</h2>
      
      <label style="display: block; margin-bottom: 12px; color: #b0b0b0; font-size: 12px; font-weight: bold;">
        Collection Name
      </label>
      <input type="text" id="metadataName" value="${currentName}" placeholder="Collection name"
        style="width: 100%; padding: 8px 12px; background: #1a1a2e; border: 1px solid #3d3d5c; border-radius: 4px; color: #e0e0e0; box-sizing: border-box; margin-bottom: 16px;" />
      
      <label style="display: block; margin-bottom: 12px; color: #b0b0b0; font-size: 12px; font-weight: bold;">
        Category
      </label>
      <select id="metadataCategory" style="width: 100%; padding: 8px 12px; background: #1a1a2e; border: 1px solid #3d3d5c; border-radius: 4px; color: #e0e0e0; box-sizing: border-box; margin-bottom: 20px;">
        ${categoryOptions}
      </select>
      
      <div style="display: flex; gap: 8px;">
        <button onclick="document.getElementById('collectionMetadataModal').remove()"
          style="flex: 1; padding: 10px; background: #3d3d5c; border: none; border-radius: 4px; color: #e0e0e0; cursor: pointer;">
          Cancel
        </button>
        <button onclick="saveCollectionWithMetadata(${JSON.stringify(streams).replace(/"/g, '&quot;')})"
          style="flex: 1; padding: 10px; background: #5c6bc0; border: none; border-radius: 4px; color: #fff; cursor: pointer; font-weight: bold;">
          Save
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

function saveCollectionWithMetadata(streams) {
  const name = document.getElementById('metadataName').value.trim();
  const category = document.getElementById('metadataCategory').value;
  
  if (!name) {
    alert('Please enter a collection name');
    return;
  }
  
  // Update stored metadata
  collectionMetadata = { name, category };
  
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `${name}-${timestamp}.json`;
  
  const collection = {
    name: name,
    category: category,
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
  
  // Also persist display order back to storage for consistency
  saveUserStreams(streams);
  
  document.getElementById('collectionMetadataModal').remove();
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
      
      // Preserve metadata from loaded file
      collectionMetadata = {
        name: data.name || null,
        category: data.category || 'other'
      };
      
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
      // Always pass callback - checks browserModes at invocation time (live.html has no browserModes, always true)
      const config = {
        shouldRedisplayAfterProbe: () => typeof browserModes === 'undefined' || browserModes.current === 'live'
      };
      await initLiveStreams(config);
      
      hideStreamCollectionsMenu();
      showToast(`Loaded ${data.name || 'collection'} - ready to save with preserved metadata`);
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
