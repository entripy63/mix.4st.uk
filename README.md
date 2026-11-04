# mix.4st.uk
website

## Stream recovery

The vendored Icecast player includes a local retry/handoff fix. See
[STREAM-RECOVERY.md](docs/STREAM-RECOVERY.md) for its recovery policy,
reproducible patch, regression tests and narrow deployment/rollback boundaries.

## Live listening time

The live timer accumulates media-clock progress for the loaded station, retaining
the total across pauses, reconnections and decoder handoffs. Paused/stalled time
and the library's silent startup placeholder do not count; mute does not stop it.
Different stations, leaving live playback and page reloads start a new session.
There is no persistence or per-station history. Long sessions display days.

Click/tap the elapsed time, or focus it and press Enter, to confirm a reset
without interrupting playback. Space still toggles Play/Pause with the timer
focused; inside confirmation it activates the focused dialog button instead.
Cancel preserves the total. A station change while
confirmation is open cannot reset the new station. The hover hint retains the
stream URL; Help explains the rules and What's New announces the feature.

The total is approximate, not evidence of uninterrupted audio. Source changes,
seeks and clock resets establish a new sampling baseline without resetting the
total. Large forward jumps are rejected against elapsed wall time; small amounts
around timeline boundaries may be lost. Playback/retry policy and the underlying
media clock used by diagnostics are unchanged. Tests cover controlled long
durations and full-app reconnections with real local MP3/ICY decoding in Chromium
and Firefox; this is not a claim of weeks-long endurance testing.

## Playback diagnostics

Open **Settings → Playback diagnostics / Report an issue**, or **Help → Report an Issue**.
Errors are captured before recovery, with a bounded history of playback events and
five-second state samples. Thirty seconds without media-clock progress, or with
apparently silent input while the clock advances, also saves a snapshot. These
checks do not restart or otherwise change playback; genuine station silence can
therefore appear as a suspected silent-audio problem.

Saved problems survive pause/resume, station changes and reloads in the same tab.
The recorder retains the first failed playback attempt and up to five recent ones,
including each attempt's first error, distinct error counts and any HTTP failure
status observed by the stream fetch path. Late callbacks retain their original
attempt identity. Repetitive seek events are grouped, and a compact station/control
timeline preserves the beginning and latest steps of a recovery attempt. The
stream library's looping silent startup clip does not count as playback progress.
Browser-saved evidence expires after 24 hours, or can be removed with **Clear saved
data**. Storage is optional: if session storage is unavailable, capture still works
in memory. Exports are capped at 128 KiB and include up to 60 recent events. Under
size pressure, frozen fault-event histories are trimmed before the recent timeline;
the first and primary failure snapshots are preserved. A sustained problem
takes precedence over routine retry errors within its own playback attempt, not
over failures on another station. Capturing HTTP status adds no network requests.

Stream startup timings record the first occurrence of each stage: stopping the
previous player, starting the new player, requesting the stream, receiving headers,
passing the first response bytes to the reader, receiving parsed audio, buffering
and actual playback. A retry is also marked. Timings are milliseconds since that
attempt was selected, not evidence that every retry reached the same stage. The
first startup and up to five recent startups are retained, including across reloads
after a fault. Completed same-origin Icecast player script loads include their
start time, duration and transfer size to help distinguish network waits from
optional player-module loading. These observations reuse existing requests; no
audio or response body is retained, and playback/retry policy is unchanged.

A separate timeline retains up to 48 recent library/media transitions and stream
fetch stages, including repeated reconnections hours after startup. It records
library state, playback method, player-instance identity, stops, retry timeouts
and playback errors even when the library suppresses its ordinary error callback.
Synchronisation warnings retain only the matching method (encoded frames or
decoded audio) and any confidence percentage, never their raw messages. State
event names identify the new state; the library's state getter still reports the
previous state during that event. Five-second samples do not displace this timeline.
When a retry escalates into a sustained problem, up to 24 relevant transitions
are frozen alongside it, while the original first error remains preserved. This
evidence survives reloads after a fault. The same 128 KiB export limit applies;
under size pressure, older transition entries may also be trimmed.

Use **Copy diagnostics** (with a selectable-text fallback), or check **Include
diagnostics with this report** before sending an issue. Both sharing options can
be reviewed first. **Automatically send persistent playback problems** is a separate,
persistent, per-browser opt-in, off by default. Automatic attempts are limited to
one per hour, including failed attempts; short recovered errors are not uploaded
automatically. The existing server limit of three reports per IP per hour applies
to manual and automatic reports combined. Failures leave the local data intact.

Diagnostics contain playback/buffer/context/gain state, input level (not audio),
timestamps, browser information and asset versions. Stream/proxy server names and
paths are included, but URL credentials, query strings and fragments are removed;
local-file and blob URLs are reduced to their scheme. Track metadata, console
messages and audio samples are not saved. Server paths can still identify a private
stream, so review the data before sharing. Submitted reports use the existing
`report.php` endpoint, include its usual nickname/browser information, and are
stored in the private report log and emailed to the site operator. Submitted reports
have no built-in expiry and are not removed by clearing local data or disabling
automatic sending. The endpoint accepts up to 192 KiB of diagnostics in a 256 KiB
request body, allowing headroom around the browser's export limit.

## Automated Playback Basics Tests

This repository includes Playwright end-to-end tests for core player behavior.

Run the suite with:

```bash
npm run test:e2e
```

Quick/full verification commands:

```bash
npm run verify:quick
npm run verify:full
npm run verify:sensitivity
```

CI-only full matrix commands (Chromium + Firefox + WebKit + iPhone WebKit):

```bash
npm run verify:full:ci
npm run verify:sensitivity:ci
```

What is covered:

1. DJ mix playback starts and `currentTime` increases while playing.
2. Live stream playback path is exercised (`playStream`), including pause/resume UI states (`LIVE` / `PAUSED`).
3. A second E2E tier uses real browser media decode with controlled local test endpoints for both mix and stream playback.
4. Sensitivity checks inject controlled playback faults at runtime and verify that core invariants fail (proving tests can detect regressions).

Notes:

1. Tests run against `player.html` via `tools/test-server.js`.
2. Browser media and audio context are mocked in the tests for deterministic, low-flake checks.
3. Local real-media endpoints are available at `/__test__/mix.wav` and `/__test__/stream.wav` for integration-level playback checks.
4. Playwright projects run on Chromium, Firefox, WebKit, and an iPhone-emulated WebKit profile.

## Recommended Workflow Gates

1. Install local hooks once per clone: `npm run hooks:install`.
2. `pre-commit` hook runs `npm run verify:quick`.
3. `pre-push` hook runs `npm run verify:full`.
4. GitHub Actions workflow [`.github/workflows/verify.yml`](file:///home/st/git/mix.4st.uk/.github/workflows/verify.yml) runs `npm run verify:full` for pull requests and pushes to `main`.
5. GitHub Actions runs `npm run verify:full:ci` and `npm run verify:sensitivity:ci` (full browser matrix including WebKit + iPhone WebKit).
6. `./tools/deploy.sh` now enforces checks before deploy: test targets run quick checks, production runs full checks.
7. Emergency bypass for deploy checks is available with `SKIP_DEPLOY_CHECKS=1 ./tools/deploy.sh <target>`.

## Shared proxy routing

All deployment targets upload the canonical `streams/proxy-config.json`:
`https://c2.proxy.4st.uk` → `https://us.proxy.4st.uk` → `https://h.proxy.4st.uk`,
each supporting named and raw-IP streams. A site-specific list can be uploaded
for an explicitly approved experiment; the next normal deployment replaces it
with the repository default. Changing this file locally does not change any site
until that site is deployed. The workers.dev `backupUrl` fields are manual
recovery references, not automatic failover.

An existing per-browser console preference, `localStorage.preferProxy`, can
prioritise a configured proxy for **raw-IP streams only** after reload; it does
not override named-stream routing or add a proxy. See `livedata.js`.

## NameCrane backup candidate

The explicit deployment target `namecrane` serves `https://player.4st.uk` through
an alias pointer to toot.org.uk. It uses key-authenticated SFTP on
uk-shared02.dapanel.net:53667 as tootorgu78, with remote directory
`domains/toot.org.uk/public_html` relative to the account home. No lftp bookmark
or stored password is required. The default target remains `home-test`, and
`all-prod` still selects only AXC production; neither includes NameCrane.

Once deployment is separately approved, `./tools/deploy.sh namecrane` runs quick
verification and the existing manifest/cache-busting steps before mirroring,
including the shared repository proxy list. The v2 Workers permit
HTTPS apex/subdomain origins under 4st.uk, including player.4st.uk. See
`tools/cloudflare-v2/README.md` for the list, deployment verification and rollback
instructions. Deployment selects only the requested site.
Existing media, logs and `secret-config.php` are excluded from
replacement/deletion, as is NameCrane's `.well-known/` directory
for ACME. Other remote-only files, including the provider's default index.html,
can be deleted by the mirror. Do not run it merely to test the connection.

Before first deployment, verify DNS and HTTPS for player.4st.uk, confirm its HTTPS
document root matches the SFTP directory, and review the intended checkout (the
script deploys working files, not just committed files). Check PHP/.htaccess
compatibility, configure the per-site `secret-config.php` separately, and decide
the report-mail setup before exercising reports: deployment never provisions
credentials or sends a test report. Verify the live proxies accept the new
origin, then test playback after an approved deployment. Sites are deployed
individually; there is no automatic deployment synchronisation with production.

## Isolated home test site: t.4st.uk

`home-test-t` targets `https://t.4st.uk`, using the existing `home-test` lftp/SFTP
connection but remote `test-t/` rather than `html/`. Its independent document root
is `/var/www/test-t` on player.opt9, not a symlink/alias to m.4st.uk. The default
target remains `home-test` (m.4st.uk); `all-prod` remains production only.

One-time server preparation is `tools/setup-home-test-t.sh`, copied to player.opt9
and run there with interactive sudo. It refuses existing new-site paths, uses the
existing protected Certbot DNS-01 configuration for a separate t.4st.uk certificate,
adds only `/etc/apache2/sites-available/t.4st.uk.conf` and a certificate-scoped
renewal hook, configtests and gracefully reloads Apache. It does not restart
Apache/Node, edit existing vhosts, change firewall/DNS routing, or change sudo
policy. This privileged step requires Steve's terminal authentication; SSH key
access alone does not authorise sudo. Completion must be verified, not inferred
from the uploaded script. Port 80 is deliberately not opened; the new HTTP
redirect only applies where port 80 is already reachable.

The shared repository `streams/proxy-config.json` uses
`https://c2.proxy.4st.uk` → `https://us.proxy.4st.uk` → `https://h.proxy.4st.uk`.
These accept the t origin without changing any proxy. The t target deploys this
list and excludes `.well-known/` from replacement/deletion, alongside the shared
media/log/secret exclusions. Other remote-only files can be deleted by a mirror.
Future explicit deployment is `./tools/deploy.sh home-test-t`; review the working
tree first because this script mirrors working files, not just a commit.

Initial setup must use a reviewed isolated payload, not mirror a dirty shared
checkout wholesale: export the intended committed app, add its required ignored
vendor/data/metadata assets (without audio/logs/secrets), cache-bust that copy,
and upload only into `test-t/`, including the canonical proxy list. Do not
copy another site's `secret-config.php`; the protected statistics/report viewers
remain unavailable until a separate per-site configuration is provisioned.
No test reports/mail are part of setup. Existing browser sessions, site routing
files and the home Node proxy must be left alone.

Deployed baseline: 2 November 2026, committed app `539846f` plus the required
local vendor/data/metadata assets, cache-busted in an isolated copy. All 1,502
payload files passed remote SHA-256 verification. The t proxy list was uploaded
separately, without deleting remote files. HTTPS, PHP/access controls and a fresh
Chromium DOM/data check passed directly against the NUC; an external HTTPS fetch
also served the app. No playback/endurance or report-mail test was performed.
The documented startup proxy-list duplication race remains unchanged.

Public DNS for t and m both points to `95.172.226.14`; both also have LAN DNS
overrides to `192.168.9.73`. Tantour's normal t resolution and HTTPS access were
verified after Steve added the override, with HTTP 200 and successful certificate
validation. Preserve the local override: the public-IP path from Tantour reached
pfSense rather than the NUC. Do not work around routing problems by disabling
TLS validation or changing existing sites.
