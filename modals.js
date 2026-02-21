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
                const presetResponse = await fetch(`/presets/${item.filename}?t=${Date.now()}`);
                const preset = await presetResponse.json();
                if (preset.name && Array.isArray(preset.streams)) {
                    presets.push({
                        filename: item.filename,
                        name: preset.name,
                        category: preset.category || 'other',
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
    
    // Group presets by category
    const grouped = {};
    presets.forEach((preset, index) => {
        const cat = preset.category || 'other';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push({ preset, index });
    });
    
    // Get category order: 'genre' first, then others
    const categoryOrder = Object.keys(grouped).sort((a, b) => {
        if (a === 'genre') return -1;
        if (b === 'genre') return 1;
        return a.localeCompare(b);
    });
    
    // Build HTML with category containers above and tabs at bottom
    const presetsList = document.getElementById('presetsList');
    let html = '';
    
    // Category content containers (above tabs)
    for (const category of categoryOrder) {
        const containerStyle = category === categoryOrder[0] ? 'display: flex;' : 'display: none;';
        html += `<div id="presetsContainer-${category}" style="${containerStyle} flex-direction: column; gap: 8px; margin-bottom: 12px;">`;
        
        for (const { preset, index } of grouped[category]) {
            html += `<button onclick="selectPreset(${index})" style="padding: 12px 16px; background: #3d3d5c; border: none; border-radius: 6px; color: #e0e0e0; cursor: pointer; text-align: left; transition: background 0.2s;" onmouseover="this.style.background='#5c6bc0'" onmouseout="this.style.background='#3d3d5c'">${escapeHtml(preset.name)}</button>`;
        }
        
        html += '</div>';
    }
    
    // Tab buttons (at bottom)
    html += '<div style="display: flex; gap: 0; border-top: 2px solid #3d3d5c; margin-top: 12px; padding-top: 8px;">';
    for (const category of categoryOrder) {
        const catLabel = category.charAt(0).toUpperCase() + category.slice(1);
        const tabId = `presetsTab-${category}`;
        const isFirst = category === categoryOrder[0];
        html += `<button onclick="switchPresetsTab('${category}')" id="${tabId}" style="flex: 1; padding: 10px 8px; background: ${isFirst ? '#5c6bc0' : '#3d3d5c'}; border: none; color: #e0e0e0; cursor: pointer; font-size: 13px; font-weight: bold; transition: background 0.2s; border-top: 3px solid ${isFirst ? '#7c7cff' : 'transparent'};" onmouseover="this.style.background='#5c6bc0'" onmouseout="this.style.background=this.id.includes('presetsTab-' + window._presetsCurrentTab) ? '#5c6bc0' : '#3d3d5c'">${escapeHtml(catLabel)}</button>`;
    }
    html += '</div>';
    
    presetsList.innerHTML = html;
    window._presetsCurrentTab = categoryOrder[0];
    
    // Store presets for selection handler
    window._currentPresets = presets;
    
    // Show modal
    const modal = document.getElementById('presetsModal');
    modal.style.display = 'flex';
    
    // Position modal with bottom anchor (above button, stays above as content grows)
    if (btnRect) {
        const content = modal.querySelector('.modal-content');
        const contentWidth = 320; // Match CSS width
        
        const left = btnRect.left + btnRect.width / 2 - contentWidth / 2;
        const bottom = window.innerHeight - btnRect.top + 10; // Distance from bottom of viewport
        
        content.style.setProperty('position', 'fixed', 'important');
        content.style.setProperty('left', Math.max(10, Math.min(left, window.innerWidth - contentWidth - 10)) + 'px', 'important');
        content.style.setProperty('bottom', Math.max(10, bottom) + 'px', 'important');
        content.style.setProperty('top', 'auto', 'important');
    }
}

function switchPresetsTab(category) {
    // Hide all containers
    const containers = document.querySelectorAll('[id^="presetsContainer-"]');
    containers.forEach(c => c.style.display = 'none');
    
    // Show selected container
    const activeContainer = document.getElementById(`presetsContainer-${category}`);
    if (activeContainer) activeContainer.style.display = 'flex';
    
    // Update tab buttons
    const tabs = document.querySelectorAll('[id^="presetsTab-"]');
    tabs.forEach(tab => {
        const isActive = tab.id === `presetsTab-${category}`;
        tab.style.background = isActive ? '#5c6bc0' : '#3d3d5c';
        tab.style.borderBottom = isActive ? '3px solid #7c7cff' : 'transparent';
    });
    
    window._presetsCurrentTab = category;
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
        
        // Delay to ensure button parent is laid out properly (especially if parent was hidden)
        setTimeout(() => {
            const btnRect = btn.getBoundingClientRect();
            
            // If button has valid dimensions, position modal near it
            if (btnRect.width > 0 && btnRect.height > 0) {
                const contentRect = content.getBoundingClientRect();
                
                // Center horizontally relative to button
                let left = btnRect.left + btnRect.width / 2 - contentRect.width / 2;
                
                // Try to position above button first
                let top = btnRect.top - contentRect.height - 10;
                
                // If modal would go above viewport, position below button instead
                if (top < 10) {
                    top = btnRect.bottom + 10;
                }
                
                // Clamp to viewport bounds with margins
                left = Math.max(10, Math.min(left, window.innerWidth - contentRect.width - 10));
                top = Math.max(10, Math.min(top, window.innerHeight - contentRect.height - 10));
                
                content.style.setProperty('position', 'fixed', 'important');
                content.style.setProperty('left', left + 'px', 'important');
                content.style.setProperty('top', top + 'px', 'important');
            }
            // If button coords invalid, let CSS center the modal
        }, 200);
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
