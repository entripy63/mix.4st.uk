# Per-Server Configuration

## `.htaccess`
Not deployed via git/lftp. Manually create on each server.

## `mixes/mixes-config.json`

A single config file committed to git, valid on all sites. Contains an ordered list of
base URLs to try when loading mix audio and download files:

```json
{
  "mixesBaseUrls": [
    "/mixes/",
    "https://stream-proxy.round-bar-e93e.workers.dev/?url=https://mixes.4st.uk/mixes/"
  ]
}
```

### How it works

- On load, `core.js` reads the list into `MIXES_BASE_URLS`.
- Any absolute URL whose origin matches the current site is automatically excluded
  (avoids redundant failed GETs for URLs that resolve to the same server).
- When a mix is played, `resolveMediaUrl()` in `mixes.js` tries a HEAD request against
  each base URL in order and uses the first that responds OK.
- Download links use whichever base URL succeeded for the audio file.

### Per-site behaviour (automatic)

| Site | Effective URLs after filtering |
|------|-------------------------------|
| **mixes.4st.uk** (production, has all files locally) | `/mixes/` (local), plus any non-self remote URLs |
| **test.4st.uk** (no local files) | `/mixes/` (will 404, skipped), then proxy URL (succeeds) |
| **localhost** (partial local files) | `/mixes/` (works if file is local), then proxy URL (fallback) |

### Legacy format

The old single-value format (`"mixesBaseUrl": "..."`) is still supported for
backwards compatibility — it is treated as a one-element list.
