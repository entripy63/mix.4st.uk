# Test: live.js Extraction (Steps 1 & 2)

## Objective
Verify that:
1. player.html still works perfectly after extracting live.js from browser.js
2. browser.js is unchanged and ready for the next extraction phase
3. No console errors or missing dependencies

## Current State
- ✅ **LIVE_SPA_FEASIBILITY.md** updated with architecture details
- ✅ **live.js** created (558 lines extracted from browser.js)
- ✅ **browser.js** unchanged (all code still there, ready to be split into player-mix.js)
- ⏳ **player.html** — needs testing to verify it still works

## Dependencies Check

### live.js Dependencies
```javascript
// Requires these from core.js:
- state              // global state object
- storage            // localStorage wrapper
- escapeHtml()       // HTML escaping function
- showToast()        // Toast notification

// Requires these from player.js:
- playLive()         // Live stream playback function
```

### browser.js Remaining Dependencies
All original functions used by player.html remain in browser.js:
- `searchIndex` (search functionality)
- `browserModes` (mode switching)
- `displayMixList()`, `displayFavourites()`, etc.
- `setCurrentDJ()`, `loadDJ()`, etc.
- All keyboard shortcuts and event handlers

## Test Plan

### 1. Load player.html in Browser
```
URL: http://localhost:8000/player.html
Expected:
  ✓ No console errors
  ✓ Page renders correctly (3 columns visible)
  ✓ Player controls responsive
  ✓ Volume slider works
  ✓ All mode buttons visible (DJ, All, Search, Live, Fav)
```

### 2. Test DJ Mode
```
Action: Click "trip-" button
Expected:
  ✓ DJ list loads
  ✓ Mixes display with duration
  ✓ No console errors
  ✓ Can click play buttons
```

### 3. Test Live Mode
```
Action: Press Ctrl+L or click Live button
Expected:
  ✓ Live mode switches
  ✓ Stream list displays (Sleepbot, Jungletrain)
  ✓ No console errors
  ✓ Can add stream form visible
  ✓ Drag-drop still works
  ✓ Collections menu accessible
```

### 4. Test Live Stream Playback
```
Action: Click play on a live stream
Expected:
  ✓ Time display shows "LIVE"
  ✓ Stream loads without error
  ✓ Play/pause works
  ✓ Volume control works
  ✓ No console errors
```

### 5. Test Queue Functionality
```
Action: Unload live.js references in live mode
Expected:
  ✓ All queue operations still work
  ✓ No conflicts between queue.js and live.js
  ✓ Waveform displays correctly in mix mode
```

### 6. Browser Console Inspection
```
Expected in console:
  ✓ No errors (0 red messages)
  ✓ No warnings about undefined functions
  ✓ No CORS issues
  ✓ Only expected network requests
```

## Failure Scenarios & Recovery

### If console shows "playLive is not defined"
**Cause**: live.js loaded before player.js  
**Fix**: Ensure script loading order is: core.js → player.js → browser.js → live.js

### If "Cannot read property 'displayLiveStreams' of undefined"
**Cause**: Missing `browserModes` reference in live.js displayLiveStreams()  
**Status**: Known — browser.js displayLiveStreams() checks `browserModes.current !== 'live'`  
**Note**: This check should be removed or replaced for live.html (single-mode SPA)

### If stream collections fail to save
**Cause**: Missing `storage` or `showToast` from core.js  
**Fix**: Verify core.js is loaded before live.js

## Exit Criteria (All must pass)
- [ ] player.html loads without errors
- [ ] All 3 columns render correctly
- [ ] DJ mode works
- [ ] Live mode works
- [ ] Queue operations unaffected
- [ ] No console errors (red messages)
- [ ] Waveform displays in mix mode
- [ ] Stream probing works in live mode
- [ ] Drag-drop reordering works
- [ ] Collections save/load works

## Next Steps (Phase 2)
Once all tests pass:
1. Extract player-mix.js from player.js
2. Update player.html script tags
3. Create live.html entry point
4. Create live.css
5. Test live.html in isolation

---

## Test Results
Date: _______________  
Tester: _______________  
Result: ☐ PASS  ☐ FAIL  

### Notes
_________________________________________________  
_________________________________________________  
_________________________________________________  
