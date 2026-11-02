# mix.4st.uk
website

## Stream recovery

The vendored Icecast player includes a local retry/handoff fix. See
[STREAM-RECOVERY.md](docs/STREAM-RECOVERY.md) for its recovery policy,
reproducible patch, regression tests and narrow deployment/rollback boundaries.

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

## NameCrane backup candidate

The explicit deployment target `namecrane` serves `https://player.4st.uk` through
an alias pointer to toot.org.uk. It uses key-authenticated SFTP on
uk-shared02.dapanel.net:53667 as tootorgu78, with remote directory
`domains/toot.org.uk/public_html` relative to the account home. No lftp bookmark
or stored password is required. The default target remains `home-test`, and
`all-prod` still selects only AXC production; neither includes NameCrane.

Once deployment is separately approved, `./tools/deploy.sh namecrane` runs quick
verification and the existing manifest/cache-busting steps before mirroring.
It preserves the separately managed remote `streams/proxy-config.json`, as
home-test does. An initial or changed proxy list needs an explicit upload.
NameCrane uses the separately deployed v2 list: `https://c2.proxy.4st.uk` →
`https://us.proxy.4st.uk` → `https://h.proxy.4st.uk`. The v2 Workers permit
HTTPS apex/subdomain origins under 4st.uk, including player.4st.uk. See
`tools/cloudflare-v2/README.md` for the list, deployment verification and rollback
instructions. Home-test and production routing remain separate and unchanged.
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
origin, then test playback after an approved deployment. No automatic failover
or synchronisation with production is provided.
