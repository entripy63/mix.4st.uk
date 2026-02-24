# Directory Restructuring & Migration Guide

**Date**: February 24, 2025  
**Status**: Auto-migrations active, ready for removal once users migrate

## Overview

The application underwent a major directory restructuring to consolidate all DJ-related content under a `mixes/` container directory. This document explains the changes, the migration approach, and when/how to remove migration code.

## What Changed

### Directory Structure
**Before:**
```
/home/st/git/mix.4st.uk/
├── aboo/
├── gmanual/
├── haze/
├── izmar/
├── jx3p/
├── rpfr/
├── trip/
├── moreDJs/
│   ├── estimulo/
│   ├── claptone/
│   └── [26 more DJs...]
├── audio-source-config.json
└── search-index.json
```

**After:**
```
/home/st/git/mix.4st.uk/
├── mixes/
│   ├── aboo/
│   ├── gmanual/
│   ├── haze/
│   ├── izmar/
│   ├── jx3p/
│   ├── rpfr/
│   ├── trip/
│   ├── moreDJs/
│   │   ├── estimulo/
│   │   ├── claptone/
│   │   └── [26 more DJs...]
│   ├── audio-source-config.json
│   └── search-index.json
└── [root is now clean]
```

### Code Changes
- **player.html**: All DJ button onclick handlers updated to use `mixes/` prefix
- **search.js**: Search index fetch path updated to `mixes/search-index.json`
- **browser.js**: DJ button active state comparison updated for new paths
- **Tools scripts**: `generate-*.py` scripts updated to reference `mixes/audio-source-config.json`

## Auto-Migration System

To avoid data loss, three automatic migrations were implemented:

### 1. Favourites & Hidden Mix IDs (player-mix.js)
**File**: `player-mix.js` lines 19-41  
**When**: On page load, before displaying Favourites tab  
**What**: Converts stored mix IDs from old format to new format
```javascript
// Old format: "aboo/DJAboo"
// New format: "mixes/aboo/DJAboo"

// Old format: "moreDJs/estimulo/SomeShow"
// New format: "mixes/moreDJs/estimulo/SomeShow"
```

### 2. Last Played Mix (restore.js)
**File**: `restore.js` lines 51-65  
**When**: On page load, during player restoration  
**What**: Converts stored `currentMixPath` from old to new format
```javascript
// Handles restoration of the last playing mix
// Old: "haze/HazeShow"
// New: "mixes/haze/HazeShow"
```

### 3. Queued Mixes (core.js)
**File**: `core.js` lines 70-89  
**When**: During state initialization (first line executed)  
**What**: Converts `djPath` in all queued mixes
```javascript
// Handles queue restoration
// Old: "trip/Mix123"
// New: "mixes/trip/Mix123"
```

## Search Index
**File**: `generate-search-index.py` lines 58, 63  
**Change**: Now includes `mixes/` prefix in all DJ paths
```
Old: {"dj":"aboo", "file":"DJAboo", ...}
New: {"dj":"mixes/aboo", "file":"DJAboo", ...}
```

## Removing Migration Code

Once all users have reloaded the page and their localStorage has been migrated, the auto-migration code can be safely removed. This typically takes 1-4 weeks depending on user activity.

### Signs Migration is Complete
- All known users have visited the site at least once
- No issues reported with Favourites, Queue, or playback
- Sufficient time has passed for casual users to visit

### Removal Checklist

**Step 1: Verify migration is stable (wait 4+ weeks)**

**Step 2: Remove from player-mix.js**
- Delete `_migrateOldPaths()` function (lines 19-41)
- Delete migration call at line 79: `mixFlags._migrateOldPaths();`

**Step 3: Remove from restore.js**
- Delete migration block (lines 51-65)
- Change `let savedPath` back to `const savedPath`

**Step 4: Remove from core.js**
- Delete `migrateQueuePaths()` IIFE (lines 70-89)

**Step 5: Test thoroughly**
- Test with fresh localStorage (DevTools → Application → Clear site data)
- Test normal restoration flow
- Test Favourites/Hidden with fresh data

**Step 6: Commit cleanup**
```bash
git commit -m "Remove: Auto-migrations for mixes/ directory structure

All users have migrated their local storage to new paths.
Safe to remove the migration code.

- player-mix.js: Remove _migrateOldPaths() and call
- restore.js: Remove currentMixPath migration
- core.js: Remove queue djPath migration"
```

## User Communication

When asking users to reload:

> **"We've reorganized the site's directory structure for better maintainability. Please reload the page to migrate your Favourites, Queue, and playback history to the new structure. This should happen automatically—no action needed on your part!"**

## Technical Notes

### Why Auto-Migration?
- **Data preservation**: Users don't lose Favourites, Queue, or playback position
- **Transparent**: No UI changes or prompts
- **Safe**: Happens before any state-dependent code runs
- **Temporary**: Can be removed once users migrate

### Storage Keys Affected
- `mixFavourites` - Favourites list
- `mixHidden` - Hidden mixes list
- `currentMixPath` - Last played mix path
- `queue` - All queued mixes

### Path Format Consistency
All migrations follow the same pattern:
```javascript
// Both main DJs and moreDJs get the same prefix:
if (!path.startsWith('mixes/')) {
    path = 'mixes/' + path;
}
```

## Verification

Check migration worked by opening browser DevTools Console and running:

```javascript
// Check Favourites
console.log('Favourites:', [...mixFlags._favourites]);

// Check Queue
console.log('Queue:', state.queue);

// Check Current Mix
console.log('Current Mix Path:', storage.get('currentMixPath'));
```

All paths should start with `mixes/`.

## Files Modified

| File | Change | Type |
|------|--------|------|
| player-mix.js | Add `_migrateOldPaths()` + call | Migration |
| restore.js | Add currentMixPath migration | Migration |
| core.js | Add queue djPath migration | Migration |
| player.html | Update DJ button paths | UI |
| browser.js | Update DJ button state logic | Logic |
| search.js | Update search index path | Config |
| generate-search-index.py | Add mixes/ prefix to all DJs | Script |
| generate-manifest.py | Update config path | Script |
| generate-peaks.py | Update config path | Script |
| generate-covers.py | Update config path | Script |

## Related Documentation

- [RESTRUCTURING_COMPLETE.md](RESTRUCTURING_COMPLETE.md) - Full restructuring details
- [AUDIT_RESTRUCTURING.md](AUDIT_RESTRUCTURING.md) - Audit of required changes
