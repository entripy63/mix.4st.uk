# Directory Restructuring Audit

## Proposed Changes
1. Create `mixes/` container
2. Move DJ dirs: `aboo/`, `gmanual/`, `haze/`, `izmar/`, `jx3p/`, `rpfr/`, `trip/` → `mixes/`
3. Move `moreDJs/` → `mixes/moreDJs/`
4. Move `audio-source-config.json` → `mixes/audio-source-config.json`
5. Delete `search-index.json` (regenerate in `mixes/`)

## Files Requiring Updates

### 1. Tools Scripts (`tools/`)
**All use hardcoded DJ directory discovery and config paths:**

- **generate-search-index.py** (31 lines, 2 hardcoded refs)
  - Line 52: Hardcoded check for `moreDJs/` directory name
  - Line 58: Hardcoded path construction `f"moreDJs/{subentry.name}"`
  - **Need**: Update to scan `mixes/` instead
  - **Impact**: Must run from `mixes/` dir OR accept base_directory param

- **generate-manifest.py** (266 lines, 4 hardcoded refs)
  - Line 249: Hardcoded check for `moreDJs/` directory
  - Line 266: `config_path = Path('audio-source-config.json')` ← looks in cwd
  - Line 310: Hardcoded `'moreDJs'` path construction (line 319)
  - **Need**: Update config path to `mixes/audio-source-config.json`
  - **Need**: Update moreDJs logic

- **generate-peaks.py** (211 lines, 4 hardcoded refs)
  - Line 120: Hardcoded `moreDJs` check
  - Line 127: Path construction `f"moreDJs/{subentry}"`
  - Line 139: `config_path = 'audio-source-config.json'` ← cwd lookup
  - Line 195: Hardcoded `'moreDJs'` path (line 195)
  - **Need**: Same updates as generate-manifest.py

- **generate-covers.py** (256 lines, 4 hardcoded refs)
  - Line 70: Hardcoded `moreDJs` check
  - Line 141: `config_path = Path('audio-source-config.json')` ← cwd lookup
  - Line 199: Hardcoded `'moreDJs'` path construction
  - **Need**: Same updates

- **generate-streams-manifest.py** (81 lines, RENAMED & UPDATED)
- Renamed from generate-presets-manifest.py
- Uses hardcoded `streams` dir (updated from presets)
  - **No changes needed**

- **fix-metadata.py** (169 lines, 1 hardcoded ref)
  - Line 141: `dj_dirs = ['trip', 'izmar', 'aboo']` ← HARDCODED DJ LIST
  - **This is a metadata-fixing utility, probably unused in workflow**
  - **Consider**: Update or deprecate

### 2. Frontend JavaScript Files

- **mixes.js** (291 lines)
  - Line 2: `fetch(\`${djPath}/manifest.json\`)`
  - Line 186: `const dir = \`${djPath}/\`;`
  - **Current behavior**: Uses dynamic `djPath` variable ✓ GOOD
  - **No hardcoded paths** - Will work with `mixes/aboo/` just as well as `aboo/`
  - **Status**: NO CHANGES NEEDED

- **search.js** (249 lines)
  - Line 19: `fetch('search-index.json')` ← looks in cwd (root)
  - **Need**: Update to `fetch('mixes/search-index.json')`
  - **Impact**: Single line change

- **browser.js** (line refs: uses djPath var)
  - Line 4-7: `setCurrentDJ(djPath)` - uses dynamic paths ✓
  - Line 25-26: `loadDJ(djPath)` - uses dynamic paths ✓
  - **Status**: NO CHANGES NEEDED

- **player-mix.js** (uses mix.djPath)
  - Line 217, 249: Uses dynamic `mix.djPath` ✓
  - **Status**: NO CHANGES NEEDED

- **queue.js, core.js, restore.js, modals.js**
  - All use dynamic paths from `mix.djPath` or `djPath` variables ✓
  - **Status**: NO CHANGES NEEDED

### 3. HTML Files

- **player.html** (121 lines)
  - Line 121: `<option value="">Select a DJ...</option>` - no path ref
  - **Status**: NO HARDCODED PATHS - NO CHANGES NEEDED

### 4. Configuration File

- **audio-source-config.json** (currently at root)
  - No file refs (it IS the config)
  - **Action**: MOVE to `mixes/audio-source-config.json`
  - **Then**: Update 3 scripts to load from new location

## Summary of Changes Required

| File | Type | Changes | Complexity |
|------|------|---------|-----------|
| **generate-search-index.py** | Tool | Update DJ discovery, path construction | Low |
| **generate-manifest.py** | Tool | Update config path + moreDJs logic | Low |
| **generate-peaks.py** | Tool | Update config path + moreDJs logic | Low |
| **generate-covers.py** | Tool | Update config path + moreDJs logic | Low |
| **fix-metadata.py** | Tool | Hardcoded DJ list (optional) | Low |
| **search.js** | JS | 1 line: `'search-index.json'` → `'mixes/search-index.json'` | Trivial |
| Other JS files | JS | None | - |
| HTML files | HTML | None | - |
| **audio-source-config.json** | Config | MOVE to `mixes/` | - |
| **search-index.json** | Generated | DELETE, regenerate | - |

## Execution Plan

1. **Update tools/** (in order of dependencies)
   - Modify config path lookups in all 4 generation scripts
   - Simplify moreDJs logic (already scans subdirs in new structure)
   
2. **Move & create structure**
   - Create `mixes/` directory
   - Move DJ directories into it
   - Move `moreDJs/` into it as `mixes/moreDJs/`
   - Move `audio-source-config.json` to `mixes/`
   - Delete `search-index.json`

3. **Update JS**
   - Search.js: Update `search-index.json` path

4. **Regenerate artifacts**
   - Run `generate-manifest.py` from `mixes/` dir
   - Run `generate-peaks.py` from `mixes/` dir
   - Run `generate-covers.py` from `mixes/` dir (if needed)
   - Run `generate-search-index.py` from `mixes/` dir

## Notes
- Most JS files use **dynamic path variables** (good design!)
- Scripts have **consistent moreDJs nesting pattern** - easy to refactor
- Config path lookups all use relative paths - will need updating
- No server-side routing changes needed (all relative fetches)
