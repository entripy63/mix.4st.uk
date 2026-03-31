# Stream Proxy Architecture

## Overview

The site runs on HTTPS, but many internet radio streams are HTTP-only or use raw IP addresses, causing mixed-content and CORS issues. We solve this with stream proxies that fetch upstream audio and relay it to the browser with proper CORS headers.

We use **multiple proxies** to split load and provide redundancy:

| Proxy | Platform | Handles | Timeout | Notes |
|-------|----------|---------|---------|-------|
| Deno Deploy | Deno | All streams | TBD | Free tier, raw TCP via `Deno.connect()`, ICY/Shoutcast support |
| Cloudflare Worker | Cloudflare | Named URLs only | None (streaming) | Free tier, very reliable, but `fetch()` cannot connect to raw IPs |
| Cloud Run | Google Cloud | All streams | 60 min | Handles raw IPs via raw TCP fallback, ICY/Shoutcast protocol |
| Home NUC | Self-hosted | All streams | None | No limitations, depends on home internet uplink |

### Why multiple proxies?

- **Cloudflare Workers** use `fetch()` which resolves DNS — cannot connect to raw IP addresses (e.g., `http://185.33.21.112:8000/stream`) or handle ICY/Shoutcast servers that respond with non-standard HTTP.
- **Deno Deploy** and **Cloud Run** both support raw TCP sockets, handling raw IPs and ICY protocol.
- Having multiple proxies provides **fallback redundancy** — if the first proxy fails for a stream, the app automatically tries the next one in the list.

## Proxy Configuration

The app loads proxy routing from `/streams/proxy-config.json` at startup:

```json
[
  {
    "url": "https://deno-proxy.4st.uk",
    "streams": "all",
    "note": "Deno Deploy — handles raw IPs and ICY/Shoutcast via raw TCP"
  },
  {
    "url": "https://stream-proxy.round-bar-e93e.workers.dev",
    "streams": "named",
    "note": "Cloudflare Worker — reliable, no timeout, but cannot proxy raw IP addresses"
  },
  {
    "url": "https://stream-proxy-375114048778.europe-west2.run.app/stream",
    "streams": "all",
    "note": "Google Cloud Run — handles raw IPs and ICY/Shoutcast, 60-min timeout"
  },
  {
    "url": "https://h.proxy.4st.uk",
    "streams": "all",
    "note": "Home NUC — handles everything, no timeout, no request limits"
  }
]
```

### Configuration format

- **`url`**: The proxy endpoint URL
- **`streams`**: Capability — `"named"` (domain URLs only) or `"all"` (including raw IPs)
- **`note`**: Human-readable description (ignored by the app)
- **Order matters**: Proxies are tried in array order; put preferred proxies first

### How routing works

1. At startup, `loadProxyConfig()` builds two ordered lists from the config:
   - **`proxiesForRawIP`** — only `"all"` proxies (can handle raw IP addresses)
   - **`proxiesForNamed`** — all proxies (`"all"` + `"named"`, can handle named URLs)
2. When probing a stream, `getProxyUrls(streamUrl)` checks `isRawIPURL()` and returns the appropriate list
3. The probing loop tries each proxy in order until one succeeds

### Changing proxies

Edit `streams/proxy-config.json` and deploy. No code changes needed. Reorder entries to change priority. Add new proxies to extend fallback chains.

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

## Deno Deploy

### Source code

`tools/deno-proxy/main.ts` — TypeScript, deployed to Deno Deploy.

### Features

- Full CORS handling (preflight, expose headers)
- Origin validation (4st.uk, steveqv225)
- HTTP/HTTPS redirect following (up to 5 hops)
- Range header forwarding
- ICY/Shoutcast raw TCP fallback via `Deno.connect()`
- Status endpoint at `/status`

### Limitations

- **50ms CPU time per request** (free tier) — streaming is I/O-bound so this is generally fine
- **1M requests/month** (free tier)

### Project details

- **URL**: `https://deno-proxy.4st.uk`
- **Custom domain**: Configured in Deno Deploy dashboard

### Deployment

```bash
# Install Deno (if not already installed)
curl -fsSL https://deno.land/install.sh | sh
export PATH="$HOME/.deno/bin:$PATH"

# Deploy from the deno-proxy directory (requires DENO_DEPLOY_TOKEN or interactive login)
cd tools/deno-proxy
deno deploy --prod
```

### Access token

Create at the Deno Deploy dashboard under account settings → Access Tokens.

---

## Home NUC

### Source code

`tools/cloudrun-proxy/index.js` — same Node.js proxy as Cloud Run, deployed to the home NUC (Intel NUC8i3BNK, 16GB RAM, Debian 13.4).

### Features

- Full CORS handling (preflight, expose headers)
- Origin validation (4st.uk, steveqv225)
- HTTP/HTTPS redirect following (up to 5 hops)
- Range header forwarding
- ICY/Shoutcast raw TCP fallback (for servers using HTTP/0.9)
- ICY metadata header proxying
- Memory-efficient streaming (no buffering)
- Status endpoint at `/status` (shows active connections, memory usage)
- **No timeout** — streams run indefinitely
- **No request limits** — self-hosted, no free-tier quotas

### Limitations

- **Depends on home internet uplink** (10 Mbit/s upload) — sufficient for personal use but not high-traffic scenarios
robots.txt, fail2ban and Apache2 rewrite rules to harden it from abuse.

- **Availability** — depends on home power and internet staying up

### Project details

- **Hardware**: Intel NUC8i3BNK, 16GB RAM, 512GB m.2 SATA SSD
- **OS**: Debian 13.4 (no desktop environment, SSH only)
- **Proxy path**: `/opt/stream-proxy/index.js`
- **URL**: `https://h.proxy.4st.uk`
- **SSL**: Certbot via Apache reverse proxy

### Architecture

Apache serves as a reverse proxy, terminating SSL and forwarding to the Node.js proxy:

```
Client → https://h.proxy.4st.uk → Apache (SSL) → localhost:8080 → Node.js proxy → upstream stream
```
### systemd units

The proxy runs as a systemd service with a path unit that auto-restarts on file changes:

- **`stream-proxy.service`** — runs `/usr/bin/node /opt/stream-proxy/index.js` on port 8080 as `www-data`
- **`stream-proxy-watcher.path`** — watches `/opt/stream-proxy/index.js` for changes
- **`stream-proxy-watcher.service`** — restarts `stream-proxy.service` when triggered by the path unit

Unit files are in `/etc/systemd/system/` on the NUC.

### Deployment

Upload the updated proxy file to the NUC — the path unit handles the restart automatically:

```bash
scp tools/cloudrun-proxy/index.js nuc:/opt/stream-proxy/index.js
```

Or via SFTP. The `stream-proxy-watcher.path` unit detects the file change and restarts `stream-proxy.service`.

### Apache vhost

Configured at `/etc/apache2/sites-available/h.proxy.4st.uk.conf` with SSL managed by certbot:

```apache
<VirtualHost *:80>
    ServerName h.proxy.4st.uk
    ProxyPreserveHost On
    ProxyPass / http://localhost:8080/
    ProxyPassReverse / http://localhost:8080/
</VirtualHost>
```

Requires Apache modules: `proxy`, `proxy_http`, `headers`.

---

## Disaster Recovery

With the fallback architecture, single proxy failures are handled automatically — the app tries each proxy in order. Manual intervention is only needed if you want to change priority or remove a broken proxy.

### Reordering priorities

Edit `streams/proxy-config.json` and reorder entries. The first proxy in each list is tried first.

### If all proxies go down

Streams will fail to probe. Deploy a replacement to any provider and add it to `proxy-config.json`.

---

## History

- **Original**: Cloudflare Worker only — couldn't handle raw IP streams, site ran on HTTP to avoid mixed content
- **Oracle Cloud VM**: Tried Ampere A1 (unavailable), got E2-micro — handled everything but VM kept crashing under minimal load
- **Google Cloud Run**: Reliable, handles everything, 60-minute timeout acceptable with auto-reconnect
- **Multi-proxy split**: Cloudflare Worker for named URLs (no timeout), Cloud Run for raw IPs (60-min timeout)
- **Deno Deploy**: Added as third proxy — free tier, raw TCP support via `Deno.connect()`, handles raw IPs and ICY/Shoutcast
- **Home NUC**: Self-hosted Node.js proxy on Intel NUC — no timeouts, no request limits, no IP restrictions
- **Current**: Four proxies (Cloudflare Worker, Cloud Run, Deno Deploy, Home NUC) with ordered fallback chains
