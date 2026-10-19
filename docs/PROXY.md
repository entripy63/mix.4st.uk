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

### Experimental Cloudflare TCP candidate (October 2026)

The limitations above describe the **production fetch-only Worker**, not all
Cloudflare Workers APIs. An isolated candidate using `cloudflare:sockets` has
connected to raw IPs and legacy ICY streams on ports 8000, 8096 and 8218 without
DNS aliases. It is deployed separately as `stream-proxy-candidate` and enabled
only in the proxy list on **m.4st.uk**, retaining the existing fallbacks.
Production routing is unchanged. Free-tier CPU suitability and long-duration
reliability are still open questions; short successful playback is not approval
to replace Deno. See the [candidate notes, tests and rollback instructions](../tools/cloudflare-candidate/README.md).

Deploy application and preset changes for testing with `./tools/deploy.sh home-test`.
It runs lint, regenerates the stream manifest/search index without rewriting the
mixes index, cache-busts player.html, and mirrors changed site files to the home
bookmark's `html/` directory. Local `.amp/` artifacts are excluded. The home
target preserves its separately managed, candidate-first
`streams/proxy-config.json`; production continues to use the repository list.
After the owner's testing passes, commit the intended changes, then deploy with
`./tools/deploy.sh prod` (full lint/playback checks). Do not promote to production
just because the home deployment's automated checks pass.

### Listening-test issue register

Updated 19 October 2026. This register tracks the candidate trial on m.4st.uk;
it is not an exhaustive compatibility matrix. “Not checked” is not a failure.
Keep app errors separate from upstream/proxy-path failures. Do not remove a
stream solely because a probe fails, and avoid extra connections to the four
daily-use stations while they are being listened to.

| Station / endpoint | Candidate result | Other paths | Issue / next step |
| --- | --- | --- | --- |
| **Deepvibes Radio** (daily use) | Owner reports roughly ten hours of playback; two reconnections, with seamless recovery reported for the first. | No controlled comparison for the later interruption. | Separate interruption around 01:14 BST on 19 Oct: stopped/stuttered after reconnect. Old request ended with client-abort and no Worker exception; cause unresolved. Correlate browser warnings and proxy logs if repeated. |
| **Jungletrain** (daily use) | Verified playback, metadata and raw-TCP/ICY handling on port 8000; short controlled tests passed. | Production Cloudflare returned 520 in the initial comparison. | No outstanding candidate fault established; continue normal listening. |
| **Sleepbot** (daily use) | Verified playback and metadata, including raw-IP endpoints on ports 8096/8218; owner also reports a short listening session. | Existing fallback paths previously worked. | No outstanding candidate fault established; continue normal listening. |
| **Monkey Radio** — `https://streaming.live365.com/a52904` (daily use) | Upstream 401 after redirect to `das-edge15-live365-dal02.cdnstream.com`; native fetch path. Isolated Worker fetch-to-redirect then raw TLS to the CDN also returns empty 401, Server DAS. | Production Cloudflare: 401. Home: empty 401 on 19 Oct. Deno control seconds later: 200, `audio/mpeg`, “Monkey Radio Archive”, audio bytes received. An earlier direct request also returned 401. | **Currently depends on Deno among tested routes.** TLS alone does not solve this one. Live365 supports country/IP restrictions, but their application to this station is unverified; no signed query or token appeared in the observed redirect. Home is not yet a verified post-Deno fallback. |
| **Soul City** — `https://sirius.nucast.co.uk/listen/soul_city_radio/radio.mp3` | Native fetch receives empty upstream 401 with `text/html`; content-type guard exposes this as 415. | Home decodes successfully. Experimental Worker TLS-by-hostname also returned decodable audio, but is not a deployed fallback. | Confirmed transport/path difference; underlying cause unresolved. Retain home fallback and existing destination safeguards. |
| **Abacus FM Smooth Jazz** — `https://s20.reliastream.com/stream/8174/stream` | Owner corrected the station URL to 8174 and reports clean candidate playback. The previous 8100 endpoint returned `audio/mpeg; charset=UTF-8` and identified an airport ATC stream. | Earlier home checks also reached that wrong station. | **Resolved in owner's testing.** Corrected Jazz preset and regenerated search index first deployed to m.4st.uk on 19 Oct. Audio charset normalization remains useful for other incorrectly labelled streams. |
| **SileX.live** — `https://stream.silex.live/opus/2.ogg?type=http&nocache=1792332865828` | Native fetch receives nginx HTML 403, Server cloudflare; guard translates to 415. Isolated Worker raw TLS by hostname receives 200, `audio/ogg; codecs=opus`, stream bytes. | Home receives Ogg/Opus audio. App MIME fix quotes the existing codec parameter; deployed playback verified through home in Firefox and Chromium, using WebAudio after a user gesture. Owner then reported volume/mute bypass. | **App playback and volume issues resolved; native-fetch access failure remains.** Owner confirmed live SileX volume control after the MIME and MediaStream routing fixes on m.4st.uk. The nonfatal MSE capability warning remains because the library selects its software Opus decoder. TCP/TLS difference resembles Soul City, but provider-side reason is unknown. No proxy changes deployed. |
| **Radio Paradise** (all streams tested by owner) | Owner reports successful playback. | No new controlled comparison. | No outstanding issue reported. |
| **SomaFM** (PLS presets) | Baseline decoded all 18 preset entries. Owner's code 4 failures probe the playlist itself. Full app reproduced the playlist-read failure in Firefox and Chromium; fixed version resolves and plays Groove Salad through candidate in both browsers. | Candidate, Deno and home deliver the PLS intact. Earlier resolver-only checks omitted the app's global fetch wrapper and therefore missed the cause. | **Confirmed app bug, fixed and first deployed to m.4st.uk on 19 Oct.** Global fetch wrapper incorrectly treated finite `audio/x-scpls` playlists without Content-Length as live audio and threw on normal EOF. PLS/M3U types now excluded from synthetic EOF errors. Both-format regression tests pass in both browsers; genuine audio EOF still errors for reconnection. Deployed Firefox playback verified; production and test proxy configuration unchanged. |

The candidate is not yet a universal replacement for the existing proxies.
Update this table as reports arrive, recording the station, approximate time
(including timezone), exact error, path and whether the finding was reproduced
or only observed by the listener. The initial NoScript block was resolved by
the owner and is not an outstanding proxy issue.

The owner completed all presets on 19 October: all played through candidate
except Abacus, SileX, Monkey Radio and Soul City. SomaFM was also confirmed
working in the owner's browser after the playlist EOF fix. MIME normalization
was first demonstrated with browser-only header substitutions, then implemented
in stream-player.js and verified by substituting that local script in test
browser sessions. It removes audio charset parameters, quotes codec values and
preserves other parameters, playlist types and payload bytes. Subsequently
deployed with `./tools/deploy.sh home-test` on 19 October, together with the
owner's preset edits and refreshed indexes (20 presets, 108 entries). All 47
runtime JavaScript/preset/index files matched local copies over HTTPS; the
cache-busted page matched and test proxy configuration was unchanged. Actual
deployed playback of Abacus, SileX and Groove Salad passed in both browsers.
Initial SileX automated playback attempts lacked the user gesture required by
the library's WebAudio context; repeated tests with a real click played normally.

The owner's subsequent SileX volume/mute failure was reproduced with synthetic
MediaStream audio, without opening another station connection. Output captured
through an isolated local audio sink showed Firefox playing both a direct and a
gain-controlled copy, while Chromium played only the direct copy. App mute left
the direct copy audible in both. core.js now routes MediaStream sources explicitly
through the existing analyser/declick/gain chain, silences the element's direct
output, disconnects on pause, and restores element-source routing for ordinary
media. The player volumechange handler preserves this routing mute.

Deployed to m.4st.uk on 19 Oct after all 48 Firefox/Chromium playback checks
passed. Separate actual-output checks covered volume, mute/unmute, pause/resume,
stream replacement, starting muted and returning to ordinary media. A paced,
synthetic Ogg/Opus stream through the real IcecastMetadataPlayer WebAudio decoder
also passed on the deployed site in both browsers: RMS output about 0.03544 at
100%, 0.00494 at 20% (the app's 0.14 gain), and effectively zero muted. No live
SileX connection was made for these checks. Deployed source/preset/index bytes
matched local files and candidate-first routing was unchanged. The owner then
confirmed live SileX volume control and approved committing and deploying the
app/preset fixes to production on 19 Oct. This promotion does not include the
candidate Worker: it remains enabled only on m.4st.uk, while production retains
its existing Cloudflare, Deno and home proxy list.

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
    "url": "https://c.proxy.4st.uk",
    "backupUrl": "https://stream-proxy.round-bar-e93e.workers.dev",
    "streams": "named",
    "note": "Cloudflare Worker — reliable, no timeout, but cannot proxy raw IP addresses"
  },
  {
    "url": "https://d.proxy.4st.uk",
    "backupUrl": "https://stream-proxy.entripy63.deno.net",
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
- **`backupUrl`**: Optional provider-native endpoint retained for emergency
  manual replacement of `url`; ignored by the application
- **`streams`**: Capability — `"named"` (domain URLs only) or `"all"` (including raw IPs)
- **`note`**: Human-readable description (ignored by the app)
- **Order matters**: Proxies are tried in array order; put preferred proxies first

`backupUrl` deliberately does not join the runtime fallback list. If custom
domains are unavailable, copy the required value into `url` and deploy the
configuration. This preserves a quick provider-native escape route without
making normal requests try duplicate routes to the same proxy service.

### How routing works

1. At startup, `loadProxyConfig()` builds two ordered lists from the config:
   - **`proxiesForRawIP`** — only `"all"` proxies (can handle raw IP addresses)
   - **`proxiesForNamed`** — all proxies (`"all"` + `"named"`, can handle named URLs)
2. When probing a stream, `getProxyUrls(streamUrl)` checks `isRawIPURL()` and returns the appropriate list
3. The probing loop tries each proxy in order until one succeeds

### Changing proxies

Edit `streams/proxy-config.json` and deploy. No code changes needed. Reorder entries to change priority. Add new proxies to extend fallback chains.

### Removing a proxy & stale persisted URLs

The app persists **fully-proxied** stream URLs (`https://<proxy-host>/?url=<endpoint>`) to `localStorage` for the Player current stream (`streamUrl`) and Play History (`playHistory[].streamUrl`). User Streams persist only the raw `m3u` and are re-probed on every load, so they self-heal automatically.

When a proxy is **removed** from `proxy-config.json`, the persisted Player/History URLs reference a now-dead host and would otherwise fail silently on restore. The app handles this in `livedata.js`:

- **`isProxyCurrent(url)`** — O(1) check that the proxy host embedded in a stored URL is still in the config. Non-proxy-wrapped URLs are left untouched.
- **`refreshProxiedUrl(url, m3u)`** — re-derives a working URL by re-probing the known-good inner endpoint across the *current* proxies (the dead host is never tried); falls back to re-resolving the raw playlist (`streamM3u`).

These run **proactively on load** (Player restore in `restoreStreamPlayer`, and a Play History sweep `playHistory.refreshStaleProxies()` kicked off from `restore.js`) and **on play** (`resumeFromHistory`). The cost is zero in the normal case (just a string check); a re-probe happens only when a proxy was actually removed. Unrecoverable entries are left untouched (they may work again if the proxy/stream returns) and an on-play failure surfaces a toast instead of failing silently.

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
- Client-disconnect teardown via `req.signal` (see note below)

> No in-app rate limiting: Deno Deploy spreads requests across ephemeral
> isolates, so per-isolate counters are unreliable. Volumetric protection is
> delegated to the platform.

> **Client-disconnect teardown (why `req.signal` matters).** A live ICY/Icecast
> server pushes audio continuously whether or not anyone is listening. If the
> client goes away but the *upstream* connection is left open, the runtime can
> keep draining that infinite stream — bytes in, nothing out — holding memory
> (and **GB-hour** quota) for hours. Observed in production: after stopping,
> memory stayed high for ~4.5 h with ~960 MiB pulled from upstream vs ~290 MiB
> delivered. Relying on the response `ReadableStream` being cancelled is not
> enough: it works in local `deno run` but **not reliably on Deno Deploy's edge
> layer**. The fix threads `req.signal` end-to-end — passed to every `fetch()`
> (so a disconnect aborts the upstream fetch) and wired to `conn.close()` in the
> raw-TCP path — so teardown no longer depends on stream cancellation. After the
> fix, CPU/memory drop to zero within ~60 s of stopping.
>
> **App-side assumption:** the SPA never *pauses* a live stream — it always
> **stops** (tears the connection down) and reconnects on resume, so it never
> replays stale buffered audio. That means every "pause" is a real disconnect,
> so `req.signal` fires for all live-stream stops; there is no
> paused-but-connected case to handle.
>
> A small residual in-greater-than-out gap is normal and **not** a leak: the
> proxy reads slightly ahead of what it forwards, so each stop discards a little
> upstream read-ahead. It is bounded per stop (not per second) and stops rising
> once playback stops.

### Limitations

Free-tier quotas (watch the Deno dashboard billing graphs):

- **50ms CPU time per request** — streaming is I/O-bound (mostly awaiting
  network bytes), so a long-lived connection accrues CPU slowly. Measured
  **< 1 min of CPU per hour played** (~1.7% utilisation).
- **1M requests/month** — a stream plus its reconnects is a handful of requests;
  nowhere near.
- **100 GB egress/month** — proxied audio counts toward this. At ~128 kbps a
  stream is ~56 MB/h, so 100 GB ≈ ~1,800 h/month.
- **350 GB-h memory/month** — **this is the duration-based quota to watch.**
  Unlike CPU it bills memory held × wall-clock hours connected (the same shape
  as the wall-clock billing that made Cloud Run expensive). The V8 isolate's
  measured footprint is **~333 MiB (~0.33 GB)**, so ~300 h/month ≈ ~100 GB-h —
  roughly 3× under the cap. The closest thing to a real ceiling, so keep an eye
  on this graph.

> **Why Deno is safe where Cloud Run wasn't:** Deno bills *actual CPU time*,
> whereas Cloud Run billed *wall-clock request duration* — so a 1-hour stream
> cost Cloud Run ~3,600 vCPU-seconds whether the CPU was busy or idle, but costs
> Deno only the ~60s it actually computed. The one Deno dimension with
> Cloud-Run-like wall-clock shape is memory-hours; at the measured ~333 MiB
> isolate footprint heavy use still sits ~3× under the cap, but it's the metric
> to watch.

### Project details

- **URL**: `https://d.proxy.4st.uk`
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
- Memory-efficient streaming with backpressure on both paths (see note below)
- CORS headers on all responses, including errors
- Status endpoint at `/status` (memory usage + self-healing live-response count)
- Volumetric protection via host nftables (SYN/connection rate limits; the host firewall also blocks anything not on port 443 — see SYN-flood note below)
- **No timeout** — streams run indefinitely
- **No free-tier request quotas** — self-hosted

> **Backpressure on the raw-TCP/ICY path.** Both paths pause the upstream when
> the client stops draining. The HTTP path relies on `proxyRes.pipe(res)`
> (backpressure built in); the raw-TCP/ICY path pauses the upstream socket when
> `res.write()` returns false and resumes on `res`'s `drain`. Without this, a
> stalled-but-not-closed client — e.g. Apache holding the `localhost:8080`
> backend connection open after the browser drops — let a live ICY server buffer
> unbounded into `res`, so **incoming climbed while outgoing stayed flat and
> memory grew without limit** (the observed "incoming ~2× outgoing"). Reproduced
> with a fake ICY upstream + a stalled client: proxy RSS grew ~1 GB → ~11.6 GB in
> 6 s before the fix, and stayed flat (~69 MB) after. Since the same
> `tools/cloudrun-proxy/index.js` also ran on Cloud Run, the fix applies there too.

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
