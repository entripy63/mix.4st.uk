// queuestore.js - Queue collection persistence (save/load to file)
// Dependencies: core.js (storage, escapeHtml, showToast, getMixId)
//               queue.js (state.queue, generateQueueId, saveQueue, displayQueue)
//               modals.js (showConfirmDialog)

function saveQueueToFile() {
  // Only persist non-local mixes (same as saveQueue)
  const mixes = state.queue.filter(mix => !mix.isLocal).map(mix => {
    const { queueId, ...rest } = mix;
    return rest;
  });

  if (mixes.length === 0) {
    alert('No mixes to save');
    return;
  }

  showQueueMetadataModal(mixes);
}

function showQueueMetadataModal(mixes) {
  const modal = document.createElement('div');
  modal.id = 'queueMetadataModal';
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.5); display: flex; align-items: center;
    justify-content: center; z-index: 10000;
  `;

  const defaultName = `Queue Export ${new Date().toISOString().split('T')[0]}`;

  modal.innerHTML = `
    <div style="background: #252542; border: 1px solid #3d3d5c; border-radius: 8px; padding: 20px; max-width: 400px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
      <h2 style="margin: 0 0 16px 0; color: #e0e0e0; font-size: 18px;">Save Queue</h2>
      
      <label style="display: block; margin-bottom: 12px; color: #b0b0b0; font-size: 12px; font-weight: bold;">
        Collection Name
      </label>
      <input type="text" id="queueMetadataName" value="${defaultName}" placeholder="Collection name"
        style="width: 100%; padding: 8px 12px; background: #1a1a2e; border: 1px solid #3d3d5c; border-radius: 4px; color: #e0e0e0; box-sizing: border-box; margin-bottom: 20px;" />
      
      <div style="display: flex; gap: 8px;">
        <button onclick="document.getElementById('queueMetadataModal').remove()"
          style="flex: 1; padding: 10px; background: #3d3d5c; border: none; border-radius: 4px; color: #e0e0e0; cursor: pointer;">
          Cancel
        </button>
        <button onclick="saveQueueWithMetadata()"
          style="flex: 1; padding: 10px; background: #5c6bc0; border: none; border-radius: 4px; color: #fff; cursor: pointer; font-weight: bold;">
          Save
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.getElementById('queueMetadataName').select();
}

function saveQueueWithMetadata() {
  const name = document.getElementById('queueMetadataName').value.trim();

  if (!name) {
    alert('Please enter a collection name');
    return;
  }

  const mixes = state.queue.filter(mix => !mix.isLocal).map(mix => {
    const { queueId, ...rest } = mix;
    return rest;
  });

  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `${name}-${timestamp}.mixes`;

  const collection = {
    name: name,
    mixes: mixes
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

  document.getElementById('queueMetadataModal').remove();
  showToast(`Saved ${mixes.length} mix${mixes.length !== 1 ? 'es' : ''}`);
}

async function loadQueueFromFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.mixes';

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.mixes || !Array.isArray(data.mixes)) {
        throw new Error('Invalid queue format: missing "mixes" array');
      }

      const existingIds = new Set(state.queue.map(m => getMixId(m)));

      let added = 0;
      let skipped = 0;

      for (const mix of data.mixes) {
        const id = getMixId(mix);
        if (existingIds.has(id)) {
          skipped++;
          continue;
        }
        state.queue.push({ ...mix, queueId: generateQueueId() });
        existingIds.add(id);
        added++;
      }

      saveQueue();
      displayQueue();

      const parts = [`Added ${added} mix${added !== 1 ? 'es' : ''}`];
      if (skipped > 0) parts.push(`${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped`);
      showToast(parts.join(', '));
    } catch (err) {
      console.error('Failed to load queue:', err);
      alert(`Error loading queue: ${err.message}`);
    }
  };

  input.click();
}
