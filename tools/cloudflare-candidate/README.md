# Cloudflare TCP candidate — test only

This is a separate Worker, **not** a replacement for `tools/cloudflare-worker.js`.
The source accepts proxy requests from exactly `https://m.4st.uk`
(Origin/Referer is a hotlinking deterrent, not authentication).
No production routes or DNS records are attached. `/status` is public.

- Worker: `https://stream-proxy-candidate.round-bar-e93e.workers.dev`
- Test player: `https://m.4st.uk/player.html`
- Configuration: this directory's `wrangler.jsonc`, never `tools/wrangler.toml`.
- Test routing: this directory's `proxy-config.json`, **not** the production
  `streams/proxy-config.json` in the repository root.

## Permanent successors — separate Workers

The superseded, undeployed proposal to add NameCrane's origin to these candidates
has been removed locally. Their source remains home-test-only. Prepare and test
NameCrane support through the separate [v2 Workers](../cloudflare-v2/README.md),
now deployed but not yet used in app routing,
without renaming, redeploying or deleting the candidates. This directory's list
remains candidate → US-placement candidate → home, for home-test only.
Neither candidate nor its app routing changed when the v2 Workers were deployed.

## How it works

Named destinations use normal `fetch()`. Raw IP destinations use
`cloudflare:sockets.connect()`; named HTTP destinations also use TCP if fetch
throws or returns 520 (as observed with legacy Shoutcast `ICY 200 OK`). The TCP
reader understands HTTP/1.0, HTTP/1.1 and ICY response headers, relays binary
audio/metadata unchanged, and removes chunked-transfer framing when necessary.
This is **not** support for arbitrary headerless HTTP/0.9 responses.

Redirects are handled explicitly and checked at each hop. TCP hostname lookups
validate returned IPs and pin the connection to a public address; native fetch
retains Cloudflare's platform destination restrictions. Workers DNS can include
CNAME strings in A/AAAA results, which are filtered before address validation.
There is a 15-second connection/header deadline, not an audio-duration timer.
Response-body cancellation closes the upstream socket. TCP reads are driven by
downstream demand, rather than accumulating a complete stream in memory.
Unbounded, non-chunked TCP audio uses `IdentityTransformStream` and native
`pipeTo()` after forwarding any body bytes read alongside the headers. This
avoids JavaScript execution for each subsequent audio chunk. Fixed-length and
chunked responses retain the checked JavaScript reader.

## Deploy and test

```sh
node --experimental-vm-modules --test tools/cloudflare-candidate/worker.test.js
npx eslint tools/cloudflare-candidate/*.js
wrangler deploy --dry-run --config tools/cloudflare-candidate/wrangler.jsonc
wrangler deploy --config tools/cloudflare-candidate/wrangler.jsonc
wrangler tail --config tools/cloudflare-candidate/wrangler.jsonc
```

The tests substitute socket/DNS/fetch boundaries; they do not replace edge or
browser tests. For live checks, send `Origin: https://m.4st.uk` and use
`?url=<encoded upstream>&icy=1`. `X-Proxy-Transport` reports `fetch` or `tcp`.
Structured `tcp-close` logs include the close reason and duration. `bytes` is
null for native TCP relaying: counting each chunk would defeat the optimisation.

Only the test server's `html/streams/proxy-config.json` was uploaded through the
`home-test` SFTP bookmark. That bookmark starts above `html/`. Do not run the
whole-site deployment merely to switch proxies. The test list puts this Worker
first, followed directly by the home proxy for both named and raw-IP streams.
Deno was removed on 19 October to rehearse its retirement. The existing
Cloudflare Worker was then removed from the test list because no unique
fallback success was established during the trial, and the known exceptions
failed through both Cloudflare proxies. This avoids a redundant failure delay.
Production and the overnight scanner retain their separate proxy lists.

The pre-test list is saved locally as
`.amp/in/artifacts/m-proxy-config-before-candidate.json`. To roll back this trial:

```sh
lftp -e 'set cmd:fail-exit yes; open home-test; put .amp/in/artifacts/m-proxy-config-before-candidate.json -o html/streams/proxy-config.json; bye'
```

The normal `home-test` whole-site deployment preserves the server's separate
proxy list. Changing this directory's list therefore requires an explicit
upload **only to home-test**:

```sh
lftp -e 'set cmd:fail-exit yes; open home-test; put tools/cloudflare-candidate/proxy-config.json -o html/streams/proxy-config.json; bye'
```

### US placement experiment — 24 October 2026

The current test-only order is **candidate → US-placement candidate → home**.
The second Worker, `stream-proxy-candidate-us`, uses the same `worker.js` and
compatibility settings, with a separate `wrangler-us.jsonc` adding
`"placement": { "region": "aws:us-east-1" }`. Do not deploy that configuration
under the original candidate's name. No production routes or DNS were added.

```sh
wrangler deploy --dry-run --config tools/cloudflare-candidate/wrangler-us.jsonc
wrangler deploy --config tools/cloudflare-candidate/wrangler-us.jsonc
```

Cloudflare accepted the hint on the existing account without an upgrade. The
settings API reports `targeted` placement and the service API identifies
`aws:us-east-1`. Responses immediately reported `cf-placement: remote-IAD`,
while `cf-ray` reported London ingress. This establishes execution placement,
not the station-facing IP or its geographic classification. No plan or billing
settings were changed; an actual billing outcome has not been established.

The deployed JavaScript module hashes matched exactly between both candidates.
A same-client comparison returned Monkey Radio 401 from the original versus
200 `audio/mpeg` from the clone. Fresh Chromium and Firefox sessions on the
real test player selected the clone after the original's 401, each decoded
nonzero audio with about 30 seconds of advancing playback, and never requested
the home fallback. A normal SomaFM stream also returned audio; missing/wrong
origins and a private destination remained rejected. All nine candidate tests
passed. These are short tests, not a long-duration or all-listener guarantee,
nor confirmation of territorial licensing entitlement.

Only `html/streams/proxy-config.json` was uploaded to home-test. Both existing
Workers' API settings and service records were unchanged after the trial.
Local evidence is in `.amp/in/artifacts/us-placement/`, including the pre-trial
test list. To remove the clone from test routing without touching either Worker:

```sh
lftp -e 'set cmd:fail-exit yes; open home-test; put .amp/in/artifacts/us-placement/home-test-proxies-before.json -o html/streams/proxy-config.json; bye'
```

Reload the test player and reselect Monkey Radio to resolve its route afresh.
An already saved URL using the still-configured original candidate is not
automatically replaced just because another proxy was added.

### Browser preference and saved URLs

On **m.4st.uk**, inspect `localStorage.preferProxy` in the browser console. A
saved home-proxy preference moves it ahead of other `all` proxies, including
playlist fetches and raw-IP audio; named audio ordering is unaffected. For a
natural-order test, remove only that preference and reload:

```js
delete localStorage.preferProxy;
location.reload();
```

Then reselect a stream from the stream list. Previously saved Player/History
URLs can still name an old proxy, since those proxies remain configured.
Automated tests use a fresh browser profile and do not change personal storage.

## Status and remaining gates

The October 2026 investigation established edge TCP connectivity by hostname and
IP to Sleepbot on ports 8218 and 8096 and Jungletrain on port 8000, including
real ICY metadata. No DNS aliases are necessary for those tested endpoints.
The production fetch-only Worker failed the corresponding raw-IP requests;
named Jungletrain also returned 520. These are specific observations, not a
guarantee that every stream, IP or port is supported.

Live checks on m.4st.uk played Sleepbot and Jungletrain through the candidate,
with audio time advancing for 45 seconds per station and real track metadata.
Neither used a fallback proxy. A separate raw-IP Sleepbot TCP request ran for
120 seconds, relayed 966842 bytes and 58 complete metadata blocks, and resumed
after a deliberate 20-second client-read pause. Edge logs confirmed upstream
closure on cancellation. Six live origin/private-address/content-type rejection
checks also passed, along with the nine socket-boundary unit tests and lint.
An additional fresh-profile browser run played raw-IP Sleepbot on port 8096
with metadata and 45 seconds of advancing audio, without fallback requests.

Monkey Radio (`https://streaming.live365.com/a52904`) could not be played during
this run: its redirected endpoint returned 401 through the candidate, through
the existing Cloudflare proxy, and directly. This is not a passing third-station
test; the reason for the upstream rejection is unestablished.

**Initial CPU concern, before native relaying:** the browser
Jungletrain test logged 128 ms CPU over about 47 seconds; raw-IP Sleepbot logged
83 ms over about 48 seconds in the browser and 141 ms over the two-minute test.
The recorded outcomes were client cancellation, not CPU-limit failures, but
these observations do not establish long-session suitability. Cloudflare documents
10 ms CPU per request on Workers Free, with some flexibility before enforcement:
<https://developers.cloudflare.com/workers/platform/limits/>. No plan or billing
settings were changed. Free-tier CPU suitability needs investigation and a
longer soak; there is no application-imposed duration limit, but that is not a
promise of unlimited playback. Raw-IP HTTPS/TLS and general IPv6 connectivity
also remain unverified. Body backpressure tests do not constitute a measured
edge-memory bound.

Evidence and the later browser/edge results are recorded in the
[investigation thread](https://ampcode.com/threads/T-01a14b6d-62e7-7225-be22-4fd3a8ee9b9c).
Production remains on its existing three-proxy configuration.

### Native-relay CPU comparison

The owner subsequently confirmed the account is on **Workers Free**, with three
free subscriptions and a saved payment method. No plan/billing settings changed.

Three matched 30-second edge requests per station were measured before and
after native relaying, using the same endpoints, ICY setting and client. Every
request delivered audio and complete metadata, then was deliberately cancelled.

| Station / endpoint | Before CPU ms | After CPU ms | Median before → after |
| --- | --- | --- | --- |
| Sleepbot raw IP, port 8096 | 36, 42, 35 | 6, 4, 1 | 36 → 4 ms |
| Jungletrain hostname/ICY, port 8000 | 58, 62, 72 | 11, 5, 7 | 62 → 7 ms |

A separate three-minute raw-IP Sleepbot stream on port 8218 used 4 ms CPU,
delivered 1517113 bytes and resumed after a 20-second client-read pause. Native
pipe teardown was logged after cancellation. Fresh-profile real-player checks
also passed for raw-IP Sleepbot and playlist-resolved Jungletrain, each with
20 seconds of advancing audio and track metadata, without fallback requests.
All nine unit tests and lint passed, including combined headers/body bytes,
asynchronous cancellation, backpressure and mid-body upstream failure.

This is about an 89% reduction for both medians, not a guarantee that every
request stays below 10 ms: the first Jungletrain run used 11 ms. Connection,
DNS and header-parsing work still consume CPU. Chunked responses still execute
JavaScript while decoding HTTP framing; these gains apply to the unbounded,
non-chunked audio path used by the tested stations. Multi-hour reliability
remains a separate gate before production promotion.
