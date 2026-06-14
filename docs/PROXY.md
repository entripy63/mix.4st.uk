# Stream Proxy Architecture

## Overview

The site runs on HTTPS, but many internet radio streams are HTTP-only or use raw IP addresses, causing mixed-content and CORS issues. We solve this with stream proxies that fetch upstream audio and relay it to the browser with proper CORS headers.

We use **multiple proxies** to split load and provide redundancy:

| Proxy | Platform | Handles | Timeout | Notes |
|-------|----------|---------|---------|-------|
| Deno Deploy | Deno | All streams | TBD | Free tier, raw TCP via `Deno.connect()`, ICY/Shoutcast support |
| Cloudflare Worker | Cloudflare | Named URLs only | None (streaming) | Free tier, very reliable, but `fetch()` cannot connect to raw IPs |
| Home NUC | Self-hosted | All streams | None | No limitations, depends on home internet uplink |

> **Google Cloud Run (retired).** Previously handled all streams via raw TCP
> fallback with a 60-min timeout. Removed in June 2026 because long-lived music
> streaming (10h/day) blew through the free vCPU-second and egress quotas and
> started incurring charges; this project earns no revenue so any recurring cost
> is unacceptable. Its replacement load is carried by Deno Deploy and the Home
> NUC (both handle raw IPs/ICY). The Node.js source it ran still lives on as the
> Home NUC proxy (`tools/cloudrun-proxy/index.js`). See
> [Google Cloud Run (retired)](#google-cloud-run-retired) for the historical
> record and redeploy steps.

### Why multiple proxies?

- **Cloudflare Workers** use `fetch()` which resolves DNS — cannot connect to raw IP addresses (e.g., `http://185.33.21.112:8000/stream`) or handle ICY/Shoutcast servers that respond with non-standard HTTP.
- **Deno Deploy** and the **Home NUC** both support raw TCP sockets, handling raw IPs and ICY protocol. (Google Cloud Run did too, until it was retired — see above.)
- Having multiple proxies provides **fallback redundancy** — if the first proxy fails for a stream, the app automatically tries the next one in the list.

## Abuse protection

All proxies share the same abuse-protection semantics (the three source files —
`cloudflare-worker.js`, `cloudrun-proxy/index.js`, `deno-proxy/main.ts` — keep
these in sync). Tunable constants live in a clearly-marked block at the top of
each file.

**Design rule: the controls are stateless.** Hosts spread requests across
multiple instances/isolates and replace them without running `close` handlers
(Deno Deploy across ephemeral isolates; the retired Cloud Run service did the
same on its hourly timeout), so any in-app per-IP counter either leaks upward
(false-positive blocking of legit listeners) or splits across instances. We
therefore do **not** keep stateful rate/concurrency counters in app code; every
check below decides on the current request alone. Volumetric rate limiting is
delegated to the infrastructure layer (Cloudflare Rate Limiting / host
nftables), which sees all traffic and survives instance churn.

| Control | Behaviour | CF Worker | NUC (Node) | Deno |
|---------|-----------|-----------|------------|------|
| **HTTPS-only** | If the platform supplies `X-Forwarded-Proto` and it is not `https`, reject → `403`. All legitimate use is on 443; observed abuse was on port 80. Stateless. | ✅ | ✅ | ✅ |
| **Origin check** | Parsed-hostname match (`endsWith`, not substring): allow only `4st.uk` and `*.4st.uk`. Stops one site hotlinking the proxy in a victim's browser. *Not* a hard auth boundary — a scripted client can send any header. | ✅ | ✅ | ✅ |
| **Content-Type denylist** | On the **final** response only (never redirect hops), reject high-abuse, never-a-stream types (`text/html`, `application/json`, `application/xml`, RSS/Atom, CSV) → `415`. Missing CT is allowed (ICY servers omit it); `text/plain` is allowed (some playlists use it — metadata endpoints are covered by the IP block). | ✅ | ✅ | ✅ |
| **SSRF / private-IP block** | Reject destinations resolving to loopback/private/link-local/CGNAT/metadata/multicast ranges → `403`. Kills internal-service and cloud-metadata (`169.254.169.254`) SSRF regardless of Content-Type. | literal IPs only (platform blocks the rest) | resolve + validate, **connection pinned to the validated IP** (closes DNS-rebinding) | literal IPs + resolved names |
| **CORS on errors** | Every response, **including error responses**, carries `Access-Control-Allow-Origin: *`. Without this the browser reports a generic "CORS header missing" instead of the real status code, which is what masked an earlier Cloud Run regression. | ✅ | ✅ | ✅ |
| **Volumetric rate limiting** | Per client IP, at the infrastructure layer (not app code, see design rule above). | dashboard Rate Limiting rule | host nftables (NUC) | platform-level |
| **Request logging** | One line per request: `[proxy] ip=… host=… ct=… status=…` for monitoring real Content-Types. | `wrangler tail` | `journalctl -u stream-proxy` | Deploy logs |

**Why a denylist, not an `audio/*` allowlist?** Real streams send wildly
inconsistent Content-Types (Shoutcast oddities, `application/octet-stream`,
missing headers), so allowlisting `audio/*` would break legitimate streams.
Blocking only the high-value abuse types keeps every real stream working while
removing the proxy's usefulness as a generic web scraper. The request logging
exists so the denylist can be tuned from real evidence.

**Residual risk:** the origin check is bypassable by reflecting a `*.4st.uk`
value (browser clients can't hold a secret), so it is treated as a speed-bump.
The SSRF block + Content-Type denylist are the substantive controls.

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
    "url": "https://d.proxy.4st.uk",
    "streams": "all",
    "note": "Deno Deploy — handles raw IPs and ICY/Shoutcast via raw TCP, unstable on cold start"
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
- Origin validation (4st.uk + any subdomain; see [Abuse protection](#abuse-protection))
- Content-Type denylist on the final response (blocks SSRF / web-scraping abuse)
- Literal private/reserved IP destinations rejected (defensive)
- HTTPS-only enforcement via `X-Forwarded-Proto`
- Range header forwarding (for seeking on non-live streams)
- Automatic redirect following (Cloudflare's built-in, up to 20 hops)
- Status endpoint at `/status`
- CORS headers on all responses, including errors
- Volumetric rate limiting via a Cloudflare dashboard Rate Limiting rule (Workers are stateless across isolates, so no in-code counters)

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

## Google Cloud Run (retired)

> **Retired June 2026 — not a live proxy.** This service was deleted (along with
> its `cloud-run-source-deploy` Artifact Registry repo) to eliminate recurring
> charges: long-lived music streaming (~10h/day) far exceeded the free
> 180k vCPU-second and 1 GB egress quotas. It has been removed from
> `proxy-config.json`; raw-IP/ICY load now goes to Deno Deploy and the Home NUC.
> The section below is kept as a historical record and as redeploy instructions
> should a cloud fallback ever be needed again. **Redeploying will start
> incurring charges again** under the same usage.

### Source code

`tools/cloudrun-proxy/index.js` — Node.js HTTP server. Still the active source
for the Home NUC proxy; was previously also deployed as a Cloud Run service.

### Features

- Full CORS handling (preflight, expose headers)
- Origin validation (4st.uk + any subdomain; see [Abuse protection](#abuse-protection))
- Content-Type denylist on the final response (blocks SSRF / web-scraping abuse)
- SSRF protection: private/reserved destinations rejected, connections pinned to the validated IP
- HTTPS-only enforcement via `X-Forwarded-Proto`
- HTTP/HTTPS redirect following (up to 5 hops)
- Range header forwarding
- ICY/Shoutcast raw TCP fallback (for servers using HTTP/0.9)
- ICY metadata header proxying
- Memory-efficient streaming (no buffering)
- CORS headers on all responses, including errors
- Status endpoint at `/status` (memory usage, plus a best-effort live-response count derived from a self-healing set — see note below)

> **No in-app rate/concurrency limiting.** The hourly timeout suspends the
> instance without running `close` handlers, so a decrement-on-close counter
> leaks and would eventually block legitimate listeners (this is exactly what
> caused the earlier `active:10` false-positive and the browser "CORS header
> missing" reports). `/status` therefore reports `active` from a set that prunes
> entries whose underlying socket is no longer writable, so it self-heals
> without relying on graceful close. Volumetric protection is delegated to
> Cloud Armor.

### Limitations

- **60-minute timeout**: Long-running streams will disconnect after 1 hour. The app's auto-reconnect (`player.js`) handles this transparently. Because instances are suspended/replaced abruptly (and Cloud Run often runs 2+ instances), the proxy keeps **no cross-request state** — all abuse controls are stateless.

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
- Origin validation (4st.uk + any subdomain; see [Abuse protection](#abuse-protection))
- Content-Type denylist on the final response (blocks SSRF / web-scraping abuse)
- SSRF protection: private/reserved destinations rejected (literal IPs + resolved names)
- HTTPS-only enforcement via `X-Forwarded-Proto`
- HTTP/HTTPS redirect following (up to 5 hops)
- Range header forwarding
- ICY/Shoutcast raw TCP fallback via `Deno.connect()`
- CORS headers on all responses, including errors
- Status endpoint at `/status`

> No in-app rate limiting: Deno Deploy spreads requests across ephemeral
> isolates, so per-isolate counters are unreliable. Volumetric protection is
> delegated to the platform.

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
- Origin validation (4st.uk + any subdomain; see [Abuse protection](#abuse-protection))
- Content-Type denylist on the final response (blocks SSRF / web-scraping abuse)
- SSRF protection: private/reserved destinations rejected, connections pinned to the validated IP
- HTTPS-only enforcement via `X-Forwarded-Proto`
- HTTP/HTTPS redirect following (up to 5 hops)
- Range header forwarding
- ICY/Shoutcast raw TCP fallback (for servers using HTTP/0.9)
- ICY metadata header proxying
- Memory-efficient streaming (no buffering)
- CORS headers on all responses, including errors
- Status endpoint at `/status` (memory usage + self-healing live-response count)
- Volumetric protection via host nftables (SYN/connection rate limits; the host firewall also blocks anything not on port 443 — see SYN-flood note below)
- **No timeout** — streams run indefinitely
- **No free-tier request quotas** — self-hosted

### Limitations

- **Depends on home internet uplink** (10 Mbit/s upload) — sufficient for personal use but not high-traffic scenarios
- **Exposed to internet scanning** — hardened with robots.txt, fail2ban, Apache2 rewrite rules, and host nftables (see SYN-flood note below)
- **Availability** — depends on home power and internet staying up

### Host-level SYN-flood / port-80 mitigation

The NUC sits behind a pfSense router (interface `OPT9`). A "30 kb/s download"
that looked like file leeching turned out to be a **SYN flood on port 80** (the
proxy itself only serves legitimate traffic on 443). Mitigation is at the host,
not in the proxy:

- `nftables` SYN-rate limiting, loaded from `/home/st/syn-flood-mitigation.nft`
  and persisted via `include "/home/st/syn-flood-mitigation.nft"` in
  `/etc/nftables.conf`
- `net.ipv4.tcp_synack_retries = 2` in `/etc/sysctl.d/99-synflood.conf`
- the firewall additionally **drops anything not on port 443**, which flattened
  the pfSense `OPT9` traffic graph to zero (legitimate streaming is 443-only)

After applying, `ss -tn state syn-recv` dropped from ~259 to 0 and egress from
~42 kbit/s to 0; `sudo nft -c -f /etc/nftables.conf` reports `boot config OK`.

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
scp tools/cloudrun-proxy/index.js st@player.opt9:/opt/stream-proxy/index.js
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

#### CORS and the Apache layer

The NUC's Apache also hosts the **test app** at `m.4st.uk`, so CORS handling is
split between the two vhosts on this box:

- **Proxy vhost (`h.proxy.4st.uk`)** — adds **no** CORS headers. The Node proxy
  emits its own (`Access-Control-Allow-Origin: *` plus a full `Icy-*` /
  `Content-*` expose list), so Apache must not override them. A global
  `Header set Access-Control-Allow-Origin` in `apache2.conf` previously clobbered
  these on 2xx responses — locking the proxy to `mixes.4st.uk` only and dropping
  the `Icy-*` metadata headers — so that global block was removed.
- **Test-app vhost (`m.4st.uk`)** — needs CORS because `mixes.4st.uk` falls back
  to fetching missing mixes from `m.4st.uk` (which has more storage; every site
  holds the full metadata but only a subset of the actual mix files). Instead of
  a single hard-coded origin, it **reflects any `4st.uk` origin** so current and
  future servers (and changed subdomains) all work:

  ```apache
  <IfModule mod_headers.c>
      SetEnvIf Origin "^(https://([a-zA-Z0-9-]+\.)*4st\.uk)$" CORS_ORIGIN=$1
      Header set Access-Control-Allow-Origin "%{CORS_ORIGIN}e" env=CORS_ORIGIN
      Header set Access-Control-Allow-Methods "GET, HEAD, OPTIONS"
      Header set Access-Control-Allow-Headers "Range"
      Header set Access-Control-Expose-Headers "Content-Length, Content-Range, Accept-Ranges"
      Header merge Vary Origin
  </IfModule>
  ```

  The regex is anchored (`^…$`) so look-alikes (`evil-4st.uk`,
  `x.4st.uk.evil.com`) are rejected; non-`4st.uk` origins get no `ACAO` at all,
  and `Vary: Origin` stops caches cross-serving. Requires `mod_setenvif`
  (`a2enmod headers setenvif`).

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
- **Cloud Run retired (June 2026)**: Deleted the service and its Artifact Registry repo after long-lived streaming (~10h/day) pushed past the free vCPU-second/egress quotas and began incurring charges; this project earns no revenue. Raw-IP/ICY load moved to Deno Deploy + Home NUC.
- **Current**: Three proxies (Cloudflare Worker, Deno Deploy, Home NUC) with ordered fallback chains
