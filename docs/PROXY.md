# Stream Proxy Architecture

## Overview

The site runs on HTTPS, but many internet radio streams are HTTP-only or use raw IP addresses, causing mixed-content and CORS issues. We solve this with stream proxies that fetch upstream audio and relay it to the browser with proper CORS headers.

We use **multiple proxies** to split load and provide redundancy:

| Proxy | Platform | Handles | Timeout | Notes |
|-------|----------|---------|---------|-------|
| Cloudflare Worker | Cloudflare | Named URLs only | None (streaming) | Free tier, very reliable, but `fetch()` cannot connect to raw IPs |
| Cloud Run | Google Cloud | All streams | 60 min | Handles raw IPs via raw TCP fallback, ICY/Shoutcast protocol |

### Why two proxies?

Cloudflare Workers use `fetch()` which resolves DNS — it cannot connect to raw IP addresses (e.g., `http://185.33.21.112:8000/stream`). Google Cloud Run uses Node.js `net.connect()` for raw TCP fallback, handling ICY/Shoutcast servers that speak HTTP/0.9.

By routing named-URL streams through the Cloudflare Worker (no timeout, very reliable) and raw-IP streams through Cloud Run (60-minute timeout but handles everything), we get the best of both worlds.

## Proxy Configuration

The app loads proxy routing from `/streams/proxy-config.json` at startup:

```json
[
  {
    "url": "https://stream-proxy.round-bar-e93e.workers.dev",
    "streams": "named",
    "note": "Cloudflare Worker — reliable, no timeout, but cannot proxy raw IP addresses"
  },
  {
    "url": "https://stream-proxy-375114048778.europe-west2.run.app/stream",
    "streams": "all",
    "note": "Google Cloud Run — handles raw IPs and ICY/Shoutcast, 60-min timeout"
  }
]
```

### Configuration format

- **`url`**: The proxy endpoint URL
- **`streams`**: Capability — `"named"` (domain URLs only) or `"all"` (including raw IPs)
- **`note`**: Human-readable description (ignored by the app)

### How routing works

1. At startup, `loadProxyConfig()` scans the array in order
2. First proxy with `"named"` or `"all"` capability becomes `proxyNamed`
3. First proxy with `"all"` capability becomes `proxyAll`
4. When probing a stream, `getProxyUrl(streamUrl)` checks `isRawIPURL()` and routes to the appropriate proxy

### Changing proxies

Edit `streams/proxy-config.json` and deploy. No code changes needed. To add a backup proxy, append it to the array — it will only be used if earlier proxies don't cover a capability.

---

## Cloudflare Worker

### Source code

`tools/cloudflare-worker.js` — deployed as a Cloudflare Worker.

### Features

- CORS preflight (OPTIONS) handling
- Origin validation (4st.uk, steveqv225)
- Range header forwarding (for seeking on non-live streams)
- Automatic redirect following (Cloudflare's built-in, up to 20 hops)
- Status endpoint at `/status`

### Limitations

- Cannot connect to raw IP addresses (Cloudflare `fetch()` requires DNS)
- No ICY/Shoutcast raw protocol support

### Manual deployment

```bash
cd tools
npx wrangler deploy
```

Requires `CLOUDFLARE_API_TOKEN` environment variable or interactive login via `npx wrangler login`.

### Automatic deployment (GitHub Actions)

The workflow `.github/workflows/deploy-worker.yml` auto-deploys on push to `main` when `tools/cloudflare-worker.js` or `tools/wrangler.toml` change.

**Setup (one-time):**

1. In Cloudflare dashboard → My Profile → API Tokens → Create Token
2. Use the "Edit Cloudflare Workers" template
3. In GitHub repo → Settings → Secrets → Actions → New repository secret
4. Name: `CLOUDFLARE_API_TOKEN`, Value: the token from step 2

### Wrangler configuration

`tools/wrangler.toml`:
```toml
name = "stream-proxy"
main = "cloudflare-worker.js"
compatibility_date = "2024-01-01"
```

---

## Google Cloud Run

### Source code

`tools/cloudrun-proxy/index.js` — Node.js HTTP server deployed as a Cloud Run service.

### Features

- Full CORS handling (preflight, expose headers)
- Origin validation (4st.uk, steveqv225)
- HTTP/HTTPS redirect following (up to 5 hops)
- Range header forwarding
- ICY/Shoutcast raw TCP fallback (for servers using HTTP/0.9)
- ICY metadata header proxying
- Memory-efficient streaming (no buffering)
- Status endpoint at `/status` (shows active connections, memory usage)

### Limitations

- **60-minute timeout**: Long-running streams will disconnect after 1 hour. The app's auto-reconnect (`player.js`) handles this transparently.

### Project details

- **Project ID**: `project-91f601fd-27c7-4211-bd3`
- **Region**: `europe-west2` (London)
- **Service name**: `stream-proxy`
- **Memory**: 128Mi (Node heap capped at 64MB)
- **URL**: `https://stream-proxy-375114048778.europe-west2.run.app`

### Prerequisites

```bash
# Install gcloud CLI (if not already installed)
curl -sS https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz | tar xz -C /home/st
/home/st/google-cloud-sdk/install.sh --quiet --path-update true
export PATH="/home/st/google-cloud-sdk/bin:$PATH"

# Authenticate
gcloud auth login --no-launch-browser

# Set project
gcloud config set project project-91f601fd-27c7-4211-bd3
```

### Required APIs (one-time)

```bash
gcloud services enable \
  iam.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com
```

### IAM permissions (one-time)

```bash
gcloud projects add-iam-policy-binding project-91f601fd-27c7-4211-bd3 \
  --member="serviceAccount:375114048778-compute@developer.gserviceaccount.com" \
  --role="roles/cloudbuild.builds.builder"
```

### Deployment

```bash
gcloud run deploy stream-proxy \
  --source tools/cloudrun-proxy \
  --region europe-west2 \
  --allow-unauthenticated \
  --timeout=3600 \
  --memory=128Mi
```

### Dockerfile

`tools/cloudrun-proxy/Dockerfile`:
```dockerfile
FROM node:20-slim
WORKDIR /app
COPY index.js .
EXPOSE 8080
CMD ["node", "--max-old-space-size=64", "index.js"]
```

---

## Disaster Recovery

### If Cloudflare Worker goes down

Named-URL streams will fail to probe. Fix: edit `proxy-config.json` to point named streams at Cloud Run temporarily:

```json
[
  { "url": "https://stream-proxy-375114048778.europe-west2.run.app/stream", "streams": "all" }
]
```

### If Cloud Run goes down

Raw-IP streams will fail. Named streams continue via Cloudflare Worker. Fix: deploy a replacement (see Cloud Run deployment above) or set up a backup serverless proxy.

### Adding a backup proxy

1. Deploy the Cloud Run proxy code to another provider (e.g., AWS Lambda, Fly.io)
2. Add it to `proxy-config.json` after the primary entries
3. It will only be used if earlier proxies don't cover the needed capability

---

## History

- **Original**: Cloudflare Worker only — couldn't handle raw IP streams, site ran on HTTP to avoid mixed content
- **Oracle Cloud VM**: Tried Ampere A1 (unavailable), got E2-micro — handled everything but VM kept crashing under minimal load
- **Google Cloud Run**: Reliable, handles everything, 60-minute timeout acceptable with auto-reconnect
- **Current**: Split architecture — Cloudflare Worker for named URLs (no timeout), Cloud Run for raw IPs (60-min timeout)
