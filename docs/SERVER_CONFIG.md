# Per-Server Configuration

These files are **not deployed** via git/lftp to avoid overwrites:
- `.htaccess`
- `mixes/mixes-config.json`

## mixes.4st.uk (Production)

**mixes/mixes-config.json:**
```json
{
  "mixesBaseUrl": "/mixes/"
}
```

**Setup:** Manually create via lftp or admin panel

## test.4st.uk (Test)

**mixes/mixes-config.json:**
```json
{
  "mixesBaseUrl": "https://stream-proxy.round-bar-e93e.workers.dev/url?url=https://mixes.4st.uk/mixes/"
}
```

**Setup:** Manually create via lftp or admin panel

## live.4st.uk (Live Streams)

**mixes/mixes-config.json:**
```json
{
  "mixesBaseUrl": "/mixes/"
}
```

Note: live.html doesn't use mixes audio, only metadata.

## After Deploy

If you deploy to a server, check that these config files exist and have correct values.
They won't be overwritten by future deployments.
