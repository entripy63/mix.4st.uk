# Stream Collections - Save/Load Feature

## Overview
Users can now save and load live stream collections as JSON files for easy sharing and backup.

## UI Design
**Location**: Live mode browser, inline with stream controls
- **Gear icon (⚙️)** button opens a popout menu
- **Menu items**:
  - 📂 Load from File - Import a saved collection
  - 💾 Save to File - Export current streams
  - 🗑️ Clear All - Remove all streams (confirmation required)

## Features
### Save Collection
1. Click ⚙️ → "Save to File"
2. Enter collection name
3. Browser downloads `collection-name.json`

### Load Collection
1. Click ⚙️ → "Load from File"
2. Select a `.json` file
3. Current streams are replaced with loaded collection
4. Live stream probing begins automatically

### Clear All Streams
1. Click ⚙️ → "Clear All"
2. Confirm deletion
3. All streams removed from list and storage

### Menu Dismissal
- Click ⚙️ again to toggle menu
- Click anywhere outside menu to close

## File Format
```json
{
  "name": "My Radio Stations",
  "version": 1,
  "savedAt": "2026-02-16T10:30:00Z",
  "streams": [
    {
      "name": "Sleepbot Environmental",
      "m3u": "http://sleepbot.com/ambience/cgi/listen.m3u",
      "genre": "Ambient"
    },
    {
      "name": "Jungletrain",
      "m3u": "https://jungletrain.net/static/256kbps.m3u",
      "genre": "Jungle/Drum & Bass"
    }
  ]
}
```

## Implementation Details
- **Files modified**:
  - `browser.js` - Collection management functions
  - `player.css` - Menu styling
- **Browser APIs**:
  - File API for downloads
  - File Picker API for uploads
  - Blob/ObjectURL for file generation
- **No backend required** - All client-side

## Functions Added
```javascript
toggleStreamCollectionsMenu()   // Toggle menu visibility
hideStreamCollectionsMenu()     // Hide menu
saveCollectionToFile()          // Download streams as JSON
loadCollectionFromFile()        // Import streams from JSON
clearAllStreams()               // Clear all streams with confirmation
```

## User Workflow Examples

### Backup Current Setup
1. ⚙️ → Save to File → "My Stations"
2. Browser downloads `my_stations.json`

### Restore Backup
1. ⚙️ → Load from File
2. Select previously saved `.json` file
3. All streams restored

### Share Collections with Others
1. Save collection to file
2. Email or upload to shared storage
3. Others can load with "Load from File"

### Reset and Start Fresh
1. ⚙️ → Clear All
2. Confirm deletion
3. Add new streams from scratch

## Notes
- Collection files are JSON - human-readable and editable
- Version field allows for future format changes
- Saved timestamp useful for backup management
- All operations confirmed to prevent accidental data loss
- Menu uses absolute positioning relative to gear button container
