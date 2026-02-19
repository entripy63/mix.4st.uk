// modals.js - Shared modal UI utilities
// Used by: browser.js, liveui.js
// Dependencies: core.js (escapeHtml)

// Load available presets from /presets/manifest.json
async function loadAvailablePresets() {
    try {
        // Load manifest with cache-busting parameter
        const manifestResponse = await fetch('/presets/manifest.json?t=' + Date.now());
        const manifest = await manifestResponse.json();
        
        if (!Array.isArray(manifest.presets)) {
            console.error('Invalid manifest: missing "presets" array');
            return [];
        }
        
        // Load each preset file
        const presets = [];
        for (const item of manifest.presets) {
            try {
                const presetResponse = await fetch(`/presets/${item.filename}`);
                const preset = await presetResponse.json();
                if (preset.name && Array.isArray(preset.streams)) {
                    presets.push({
                        filename: item.filename,
                        name: preset.name,
                        streams: preset.streams
                    });
                }
            } catch (e) {
                console.error(`Failed to load preset ${item.filename}:`, e);
            }
        }
        
        return presets;
    } catch (e) {
        console.error('Failed to load presets:', e);
        return [];
    }
}

// Show presets menu modal (used by both browser.js and liveui.js)
async function showPresetsMenu(e) {
    // Capture button position before async call
    const btn = e?.target?.closest('button') || event?.target?.closest('button');
    let btnRect = null;
    if (btn) {
        btnRect = btn.getBoundingClientRect();
    }
    
    const presets = await loadAvailablePresets();
    
    if (presets.length === 0) {
        alert('No presets available. Upload preset files to /presets/ directory on the server.');
        return;
    }
    
    // Populate preset list with clickable buttons
    const presetsList = document.getElementById('presetsList');
    presetsList.innerHTML = presets.map((preset, index) => `
        <button onclick="selectPreset(${index})" style="padding: 12px 16px; background: #3d3d5c; border: none; border-radius: 6px; color: #e0e0e0; cursor: pointer; text-align: left; transition: background 0.2s;" onmouseover="this.style.background='#5c6bc0'" onmouseout="this.style.background='#3d3d5c'">${escapeHtml(preset.name)}</button>
    `).join('');
    
    // Store presets for selection handler
    window._currentPresets = presets;
    
    // Show modal
    const modal = document.getElementById('presetsModal');
    modal.style.display = 'flex';
    
    // Position modal near the button (above it, centered)
    if (btnRect) {
        const content = modal.querySelector('.modal-content');
        const contentWidth = 320; // Match CSS width
        const contentHeight = Math.min(presets.length * 50 + 60, window.innerHeight * 0.7); // Rough estimate
        
        let top = btnRect.top - contentHeight - 10;
        
        // If modal would go above viewport, position below button instead
        if (top < 10) {
            top = btnRect.bottom + 10;
        }
        
        const left = btnRect.left + btnRect.width / 2 - contentWidth / 2;
        
        content.style.setProperty('position', 'fixed', 'important');
        content.style.setProperty('left', Math.max(10, Math.min(left, window.innerWidth - contentWidth - 10)) + 'px', 'important');
        content.style.setProperty('top', Math.max(10, top) + 'px', 'important');
    }
}

function hidePresetsMenu() {
    const modal = document.getElementById('presetsModal');
    const content = modal.querySelector('.modal-content');
    content.style.position = '';
    content.style.left = '';
    content.style.top = '';
    modal.style.display = 'none';
}

// Show playlist guide modal (generic - used by both browser.js and liveui.js)
function showPlaylistGuide(e) {
    const modal = document.getElementById('playlistGuideModal');
    const btn = e?.target?.closest('button') || event?.target?.closest('button');
    
    modal.style.display = 'flex';
    
    // Position modal near the button
    if (btn) {
        const content = modal.querySelector('.modal-content');
        
        // Use setTimeout to allow layout to complete before measuring
        setTimeout(() => {
            const rect = btn.getBoundingClientRect();
            const contentRect = content.getBoundingClientRect();
            
            // Center horizontally relative to button
            const left = rect.left + rect.width / 2 - contentRect.width / 2;
            
            // Try to position above button first
            let top = rect.top - contentRect.height - 10;
            
            // If modal would go above viewport, position below button instead
            if (top < 10) {
                top = rect.bottom + 10;
            }
            
            content.style.setProperty('position', 'fixed', 'important');
            content.style.setProperty('left', Math.max(10, Math.min(left, window.innerWidth - contentRect.width - 10)) + 'px', 'important');
            content.style.setProperty('top', Math.max(10, top) + 'px', 'important');
        }, 10);
    }
}

function hidePlaylistGuide() {
    const modal = document.getElementById('playlistGuideModal');
    const content = modal.querySelector('.modal-content');
    content.style.position = '';
    content.style.left = '';
    content.style.top = '';
    modal.style.display = 'none';
}

// Close modals on Escape key (for both browser and live modals)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const presetsModal = document.getElementById('presetsModal');
        const playlistGuideModal = document.getElementById('playlistGuideModal');
        
        if (presetsModal && presetsModal.style.display === 'flex') {
            hidePresetsMenu();
        }
        if (playlistGuideModal && playlistGuideModal.style.display === 'flex') {
            hidePlaylistGuide();
        }
    }
});
