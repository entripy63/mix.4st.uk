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
On 19 October, Deno was removed from the test-only list to rehearse its
retirement. The existing Cloudflare Worker was subsequently removed from that
list to avoid a second failure delay for the known exceptions. Both named and
raw-IP URLs then tried candidate → home. Production and overnight-scanner lists
are unchanged. Reload the test player to pick up the new list; existing playback
does not switch proxies merely because the configuration file changed.
Deployed Firefox/Chromium checks verified Deno is absent and saved Deno URLs
are detected as stale and can be re-probed through the current list. They also
reproduced a pre-existing startup race with both the old and new lists: eager
loading and restoration can fetch concurrently and append the list twice.
That app issue was left unchanged; evidence is in the local review artifacts.
After the owner's testing passes, commit the intended changes, then deploy with
`./tools/deploy.sh prod` (full lint/playback checks). Do not promote to production
just because the home deployment's automated checks pass.

**US placement experiment, 24 October 2026:** home-test now tries candidate →
US-placement clone → home. The clone uses identical deployed JavaScript with
the explicit hint `placement.region = "aws:us-east-1"`; neither existing Worker
was modified. Responses reported `cf-placement: remote-IAD` despite London
ingress. Monkey Radio returned 401 through the original and 200 audio through
the clone. Real-player Chromium and Firefox checks each decoded audio for about
30 seconds after automatically selecting the clone, without home fallback.
This verifies a working short-test route, not the station-facing IP, a specific
licensing explanation, long-duration reliability or suitability for every
listener. See the [US experiment and rollback notes](../tools/cloudflare-candidate/README.md#us-placement-experiment--24-october-2026).

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
| **Monkey Radio** — `https://streaming.live365.com/a52904` (daily use) | UK controls return upstream 401 after redirect; raw TLS also returns 401. On 20 Oct, candidate logs show 200 `audio/mpeg` for short probes and an `icy=1` playback-shaped GET from the Netherlands Starlink client whose listener reports successful playback. | Deno and axc receive audio. Home, Hostmedia and production Cloudflare controls return 401. | **Candidate success varies by request path/client; not universally Deno-dependent.** The successful client's probes/preflight record FRA, but station-facing egress and rejection policy remain unverified. See the 17:10 BST log correlation below. Home is not yet a verified fallback. |
| **Soul City** — `https://sirius.nucast.co.uk/listen/soul_city_radio/radio.mp3` | Native fetch returns an empty upstream 401; the content-type guard exposes this as 415. | Header replay isolates `X-Forwarded-For: 2a06:98c0:3600::103`: adding it alone produces 401; removing it restores decodable MP3. Fixed-source HTTPS requests from player.opt9 independently repeat 200/401/200/401 with only this header toggled. Earlier HTTP/raw-IP candidate playback also worked. | **Upstream header/value-triggered rejection reproduced.** The address is Cloudflare's shared cross-zone Worker client address. Why the upstream rejects it remains unknown. Omitting the header or setting it empty does not remove Cloudflare's automatic value. No DNS, preset or deployed Worker change; no HTTPS downgrade. |
| **Abacus FM Smooth Jazz** — `https://s20.reliastream.com/stream/8174/stream` | Owner corrected the station URL to 8174 and reports clean candidate playback. The previous 8100 endpoint returned `audio/mpeg; charset=UTF-8` and identified an airport ATC stream. | Earlier home checks also reached that wrong station. | **Resolved in owner's testing.** Corrected Jazz preset and regenerated search index first deployed to m.4st.uk on 19 Oct. Audio charset normalization remains useful for other incorrectly labelled streams. |
| **SileX.live** — saved URL `https://stream.silex.live/opus/2.ogg?type=http&nocache=1792332865828` | Intermittent historical success, but at 18:31 BST native fetch twice returns 403 HTML for the clean URL too; the proxy guard exposes this as 415. Owner also confirmed clean-URL 415s through both Cloudflare proxies and Deno before home succeeds. | Hostname TLS returns decodable Ogg/Opus both without and with the entire Cloudflare header replay. Direct player.opt9 controls return audio over both HTTP/1.1 and HTTP/2 to the same IPv4 address. Home playback works after the app MIME and MediaStream routing fixes. | **Unresolved fetch-path rejection.** Neither removing the query, replaying the observed added headers, nor an ordinary HTTP-version incompatibility explains all observations. Source-address policy, address-family differences and other path/TLS differences remain unverified possibilities. Preset unchanged; app volume/mute fix confirmed; nonfatal MSE warning remains. |
| **Radio Paradise** (all streams tested by owner) | Owner reports successful playback. | No new controlled comparison. | No outstanding issue reported. |
| **SomaFM** (PLS presets) | Baseline decoded all 18 preset entries. Owner's code 4 failures probe the playlist itself. Full app reproduced the playlist-read failure in Firefox and Chromium; fixed version resolves and plays Groove Salad through candidate in both browsers. | Candidate, Deno and home deliver the PLS intact. Earlier resolver-only checks omitted the app's global fetch wrapper and therefore missed the cause. | **Confirmed app bug, fixed and first deployed to m.4st.uk on 19 Oct.** Global fetch wrapper incorrectly treated finite `audio/x-scpls` playlists without Content-Length as live audio and threw on normal EOF. PLS/M3U types now excluded from synthetic EOF errors. Both-format regression tests pass in both browsers; genuine audio EOF still errors for reconnection. Deployed Firefox playback verified; production and test proxy configuration unchanged. |

**Monkey Radio follow-up, 20 October 2026:** with the owner having paused
playback, short sequential probes repeated Deno 200 with MP3 bytes and ICY
station name “Monkey Radio Archive”, versus home/candidate empty 401 responses.
The [station's current listening page](https://monkeyrad.io/groove/) still
publishes the exact preset URL, explicitly for external radio players.
Addressing each of `das-edge15-live365-dal02.cdnstream.com/a52904` and
`das-edge16-live365-dal02.cdnstream.com/a52904` directly over HTTPS produced
the same Deno 200 / home 401 / candidate 401 split. Redirect hostname selection
alone therefore does not explain the failure; differing DNS answers or egress
paths behind those hostnames remain possible.

Direct player.opt9 controls remained 401 with browser-style User-Agent,
Origin/Referer, with and without Range, and with ICY metadata enabled/disabled.
Our finite diagnostic endpoint captured Deno's ordinary Accept,
Accept-Language and Accept-Encoding headers; replaying those from player.opt9
also returned 401. Offering HTTP/2 still negotiated HTTP/1.1, so that was not
a successful HTTP/2 comparison. Forcing TLS 1.3 AES-256-GCM, the cipher observed
for Deno at our endpoint, did not restore playback; this does not reproduce
Deno's whole TLS fingerprint or prove its station-side negotiation.
The upstream 401 had no body or WWW-Authenticate challenge. Live365 documents
[country restrictions and IP bans](https://help.live365.com/en/support/solutions/articles/43000533260-stream-restrictions),
but neither their application here nor the exact rejection reason is verified.
No preset, proxy deployment or routing configuration changed. The next useful
step is station/provider confirmation of restrictions or inspection of their
CDN rejection logs, rather than an unproven app/header workaround.

**Netherlands listener, 20 October 2026 at 17:10 BST:** the owner relays Izmar's
report that Monkey Radio plays on m.4st.uk, using Brave/macOS through Starlink,
without a VPN. Historical candidate logs independently show a matching
Netherlands Starlink client receiving 200 `audio/mpeg` on short Monkey Radio
probes at 17:10:15, 17:10:17 and 17:10:36 BST. At 17:10:36.435 a preflight for
the `icy=1` URL returned 204; the corresponding GET logged 200 `audio/mpeg`
at 17:10:37.292, using native fetch to das-edge15-live365-dal02.cdnstream.com.
The preceding probes/preflight identify FRA and the same client address; this
does not identify the station-facing exit address. Both CDN hostnames have
successful probe results. Nearby SomaFM requests are from the owner's separate
UK connection, not this Starlink client.

Querying the playback request ID through 18:27 UTC found its successful proxy
log but no invocation-completion record. That is not proof of uninterrupted
playback for the intervening period. The logs and listener report together
support candidate playback on this route, not universal compatibility or a
specific geographical policy. The separately supplied API token
successfully permits historical queries; these were dry queries with no Worker
configuration changes or new station requests. Private raw evidence is retained
locally in `.amp/in/artifacts/monkey-amsterdam-candidate/`.

**axc control, 20 October 2026 at 11:38 UTC:** with the owner's permission,
uploaded a temporary token-protected PHP diagnostic through the existing axc
FTP bookmark. A fixed-destination, certificate-verified HTTPS request followed
the official URL's 302 to `das-edge16-live365-dal02.cdnstream.com/a52904`
(`216.235.83.21`) and received 200, `audio/mpeg`, ICY name “Monkey Radio Archive”
and bitrate 192. It captured only 4096 bytes, found an MPEG audio frame header,
and closed the connection. This is a successful short access/sample test, not
a decoded playback or long-duration relay test. Unauthenticated access returned
404; the PHP file was removed immediately afterwards and FTP confirmed absence.
The private JSON result is retained locally in `.amp/in/artifacts/axc-monkey/`.
axc is therefore another verified working outbound route, not evidence that
Deno-specific code is required. Neither a Dutch egress address nor a geographic
cause was established. The endpoint ran PHP 7.0.33; no PHP settings changed.
No permanent relay was installed and app/preset/proxy routing is unchanged.

**Bounded axc relay trial, 20 October 2026, 11:58–12:12 UTC:** two isolated
Chromium sessions used the real m.4st.uk player and a temporary, token-protected,
fixed-destination PHP relay. Each decoded Monkey Radio for about 5½ minutes,
with advancing playback clocks and nonzero decoded audio samples. Both requests
ended at approximately five minutes; automatic reconnection obtained another
200 response and PCM synchronization reported 99.11% and 97.74% confidence.
The cause of that repeatable connection boundary is not established. These were
automated playback checks, not confirmation of an audibly gapless transition.
The first harness incorrectly classified the decoder clock reset during PCM
handoff as a stall; the second checked advancement within each sampling window.

The relay rejected missing credentials/origin with 404 and a second concurrent
listener with 503. It streamed without saving media, verified upstream TLS,
restricted redirects, and imposed a ten-minute connection cap and absolute
expiry without overriding the host's execution limit. However, after the second
session called streamStop(), the relay's listener lock remained held throughout
five seconds of polling. This does not distinguish browser/library cancellation
from delayed hosting disconnect notification; prompt server-side cleanup is
therefore unverified. The browser was closed and the endpoint removed; FTP and
HTTP 404 checks confirmed removal. Redacted evidence is retained locally in
`.amp/in/artifacts/axc-relay/`. Playback feasibility is established, but reliable
disconnect cleanup and extended listening remain prerequisites for a lasting
relay. No permanent endpoint or app/preset/proxy routing change was made.

**axc disconnect investigation, 20 October 2026, 15:03–15:09 UTC:** bounded
single-listener controls separated browser cancellation from PHP shutdown.
Chromium reported net::ERR_ABORTED within 8–11 ms of cancelling a plain fetch
or calling the real m.4st.uk app's streamStop(). Nevertheless, PHP continued
writing synthetic data until its 20-second test cap, and continued receiving
and forwarding Monkey Radio until its 60-second test cap. Closing the page
after five seconds did not release the slot. PHP's connection_aborted() stayed
zero, despite subsequent writes/flushes. Repeating the synthetic control with
the original ignore_user_abort(false) setting gave the same result. This
demonstrates a disconnect-notification limitation in this hosting path without
requiring the audio library; the exact web-server configuration is unknown.
The app test stopped initial playback, not a post-PCM-handoff player, so it is
not a blanket exclusion of library lifecycle bugs.

A separate token-authenticated cancellation request set a private temporary
flag, checked by the relay's write/progress callbacks. The live upstream
request then terminated and its listener slot was observed free within about
1.2 seconds, rather than at the 60-second cap. This verifies a possible control
mechanism, not a production implementation: a lasting relay would need
per-listener cancellation identities and a hard lifetime/expiry for clients
that disappear without sending a stop request. No server execution limits were
overridden. Private status/flag files were cleaned, the PHP endpoint removed,
and FTP/HTTP checks confirmed removal. Evidence is retained locally in
`.amp/in/artifacts/axc-disconnect/`. Normal app routing remains unchanged.
The owner also reports that Live365's own Monkey Radio player returns 401;
that independent observation was not reproduced as part of these tests.

**Hostmedia access attempt, 20 October 2026, approximately 13:41 UTC:** the
owner supplied an FTP bookmark rooted at 4st.uk's otherwise empty public_html.
Verified FTPS access required the certificate hostname
`darwin.dnshostnetwork.com` and supplying missing certificate-chain links,
validated against the workstation's existing trust roots; verification was not
disabled and the saved bookmark was not changed. A temporary protected finite
probe was uploaded, but its unauthenticated check did not return the required
404, so no authenticated station probe was attempted. The file was removed and
FTP listing confirmed that only the original .htaccess remained. Subsequent
HTTP/HTTPS requests were reset from both the workstation and player.opt9;
the cause is unverified. This is an inconclusive hosting-access test, not a
Monkey Radio rejection or success. No runtime, DNS or app configuration changed.

**Hostmedia retry, 20 October 2026 at 14:08 UTC:** after certificate work and
a persistent verified-FTPS workaround, HTTPS to the empty root returned the
expected 403. A newly uploaded protected probe instead received a generic
LiteSpeed 403 on its unauthenticated check, not its own 404. No authenticated
station request was made. Subsequent HTTPS connections were reset, including
Chromium navigation and a request for a temporary, normally readable text file.
The text-file test is inconclusive because TLS failed before an HTTP response.
Both temporary files were removed through FTP; only the original .htaccess
remained and its contents were verified unchanged. A hosting security filter is
a hypothesis, not a demonstrated cause; inspect hosting access/security logs
before further retries. Local evidence: `.amp/in/artifacts/hostmedia-monkey/`.

**Hostmedia completed probe, 20 October 2026 at 14:22 UTC:** the owner supplied
ModSecurity log entries for both earlier attempts: rule 913114 explicitly
rejected the Python-urllib User-Agent. Those entries establish request rejection,
not the mechanism or duration of the subsequent connection resets. Retrying
through an actual Chromium page avoided that rejection, without disabling any
security rule. The protected endpoint correctly returned 404 without its token
and executed with PHP 7.3.33 when authenticated. The official Monkey Radio URL
returned 302 to `das-edge16-live365-dal02.cdnstream.com/a52904`; that host at
`216.235.83.21` returned empty 401, Server DAS, with TLS verification successful
and no cURL error. axc previously received audio from the same destination IP;
this narrows the comparison but does not establish the upstream rejection policy
or identical internal backend routing. Hostmedia is not a working fallback in
this test. The probe was removed, FTP and browser 404 checks confirmed removal,
and .htaccess was byte-for-byte unchanged. No relay was installed or hosting/app
settings changed. Evidence: `.amp/in/artifacts/hostmedia-monkey/browser-result.json`.

The 16:51–16:55 BST follow-up used short, sequential samples from an isolated
remote preview and the unchanged candidate, with no direct upstream stream
requests from the workstation. Workers DNS, Cloudflare DNS and Google DNS agreed
on the public IPv4 addresses for both stations. This does not reveal native
fetch's internal routing. Numeric-IP TLS still failed; an experimental
`startTls({ expectedServerHostname })` control also failed its handshake. That
override is not a supported API contract, so it is not a verified secure fallback.
No DNS aliases were created. A new HTTPS alias alone would also need a valid TLS
identity; it is not a transparent replacement for the station's hostname.

Subsequent owner testing supersedes the clean-SileX-URL suggestion in the table:
after switching away from SileX to Monkey Radio and adding the clean URL again,
candidate, production Cloudflare and Deno all returned 415 before home succeeded.
Removing the query is therefore not a reliable fix.

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

### Controlled outbound-path comparison (19 October, 18:21–18:24 BST)

A temporary, random-path endpoint on m.4st.uk returns a finite, deterministic
one-second WAV and logs the actual Apache connection peer, TLS and selected
HTTP headers. It makes no outbound requests. Installation, log locations and
disabling instructions are in [the diagnostic README](../tools/stream-path-diagnostic/README.md).

Candidate, production Cloudflare and Deno each returned HTTP 200 and the exact
same 16,044 audio bytes; all three samples decoded in Chromium. An isolated
Cloudflare remote preview compared native fetch with a TLS socket to the same
hostname, in both request orders. All four samples matched the same SHA-256.

| Observed at Apache | Isolated Cloudflare fetch | Isolated Cloudflare TLS socket |
| --- | --- | --- |
| First connection peer | `172.70.162.52` | `104.28.161.6` |
| HTTP / TLS / cipher | HTTP/1.1 / TLSv1.3 / TLS_AES_128_GCM_SHA256 | Same |
| SNI / Host | m.4st.uk | Same |
| User-Agent / Icy-MetaData | AudioPlayer/1.0 / 1 | Same |
| Added headers | CF-Ray, CF-Worker, forwarding and CDN-Loop headers | None of these |
| Server header returned to the caller | cloudflare | Apache/2.4.69 (Debian) |

The successful fetch also returned CF-Cache-Status: DYNAMIC although the PHP
endpoint does not generate Cloudflare headers. Thus a Cloudflare-labelled
response alone does not locate the source of a rejection: fetch can relay an
origin's response with Cloudflare labelling. Distinct connection peers and
headers are established; whether either causes the station failures is not.
Both paths used the correct hostname and SNI here, not a numeric-IP TLS bypass.

The deployed home-proxy control returned its own Forbidden destination (403):
on player.opt9, split DNS resolves m.4st.uk to 192.168.9.73, correctly blocked by
the proxy's SSRF protection. That protection and DNS were left unchanged. No
radio station was contacted, and no deployed proxy or preset was modified.
The temporary remote preview is not a persistent Worker deployment. Captured
headers, audio, hashes and connection logs are retained in local review artifacts.

#### Station header replay (18:31–18:37 BST)

An isolated remote preview sent short, sequential requests through fetch and
hostname-verified TLS. The complete replay included the forwarding, CF-Worker,
CF-Ray, CDN-Loop, CF-Visitor, Accept-Encoding and Connection headers observed at
our endpoint. A preliminary request to that endpoint verified their receipt.

For Soul City, native fetch returned 401. On TLS, the complete replay and the
forwarding pair returned 401; the other header groups individually returned
decodable MP3. Separating the forwarding pair isolated X-Forwarded-For with
Cloudflare's shared Worker address. X-Forwarded-Proto alone succeeded, and the
whole replay minus X-Forwarded-For succeeded. Repeated bare/X-Forwarded-For/bare
controls alternated between 200/401/200. Both Icy-MetaData settings can succeed
without the offending header, so metadata negotiation is not the explanation.

To eliminate differing Cloudflare egress addresses as a confounder, direct
HTTPS requests **from player.opt9, not the workstation**, toggled just that
X-Forwarded-For header. They repeated 200 with audio / empty 401 / 200 with
audio / empty 401 to the same upstream IPv4 address. This establishes an
upstream header/value trigger, not why its authentication/IP policy rejects it.
Do not label it a deliberate ban, geography restriction or listener-limit issue
without upstream evidence.

There are also exceptions to the working TLS baseline: the first two bare
socket controls returned 401. In two further tests, removing the header on the
same keep-alive connection after a 401 did not restore playback. Do not assume
a generic TLS retry is universally reliable or hide these contrary results.

Trying an explicitly empty X-Forwarded-For in fetch did not remove it: our
endpoint received `,2a06:98c0:3600::103`. This malformed workaround was not tried
on the stations. Cloudflare documents the shared address and header additions
in its [HTTP header reference](https://developers.cloudflare.com/fundamentals/reference/http-request-headers/).
The existing proxy already constructs fresh headers without X-Forwarded-For;
simply deleting it from those headers is therefore not a verified fix.

For SileX, the clean URL returned 403 through fetch before and after successful
TLS controls. Replaying the entire header set still produced decodable Opus.
Separate player.opt9 curl controls negotiated HTTP/1.1 and HTTP/2 and both
received audio from 95.217.238.174. This rules out a general failure of that
server to stream over HTTP/2, not every Cloudflare-specific HTTP/2/TLS policy.

Successful captured socket samples were decoded in Chromium, removing ICY
metadata first where advertised. The two-second curl controls intentionally
ended with timeout exit 28 after receiving audio. Evidence, including failed
controls, is retained under `.amp/in/artifacts/header-replay/`. No DNS records,
station presets, app code or deployed proxies were changed.

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
