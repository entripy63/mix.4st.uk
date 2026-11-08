# Local Icecast player recovery patch

The checked-in `vendor/icecast-metadata-player-1.17.13.main.min.js` has three
local changes. Other vendor chunks, the app's stream-fetch wrapper and proxy
configuration are unchanged by this fix. No extra playback watchdog is added.

## Recovery contract

- Start the existing retry allowance at the first audio `waiting` event, rather
  than consuming it while old buffered audio is still playing. Production's
  allowance remains 30 seconds. This can extend a retry's total wall-clock time;
  it does not deliberately pause audio for 30 seconds, nor guarantee recovery.
- Cancel the waiting listener and timer on successful playback or stopping.
  Invalidate queued promise continuations too, so an earlier retry cannot stop
  a later one.
- Ignore a successful `audio.play()` completion from an aborted playback
  session. Otherwise a late completion can report PLAYING after stop has
  installed the silent placeholder, leaving a misleading LIVE display.
- For raw MP3, anchor each MSE append's `timestampOffset` to the cumulative
  decoded sample count instead of inheriting the preceding append's rounded
  end. Count integer samples at the current sample rate, carrying elapsed time
  forward if the rate changes. The counter belongs to the MediaSource session:
  encoded-frame reconnections retain it; a new decoder session starts at zero.
  Other codecs and container selection are unchanged. This prevents cumulative
  timestamp drift without extending buffer retention or periodically seeking.

## MP3 timing and long-session stalls

In Chromium 156, raw MP3 append boundaries lose fractions of a microsecond when
the browser derives the next start from the previous rounded end. Encoded and
decoded timestamps can consequently diverge over a long session. The existing
buffer cleanup can then remove audio the decoder still needs, leaving a frozen
clock despite incoming data and a growing buffer. More retained history would
postpone, rather than prevent, cumulative drift.

The sample-clock correction addresses that reproduced mechanism, not every
possible stall. A short synthetic test using the real shipped library and native
MSE reproduced the frozen clock with deliberately amplified rounding: the old
bundle stalled at 78.44 seconds, whereas the corrected bundle and the normal-
rounding control both advanced past 109 seconds. Buffer cleanup was unchanged.
The stress is artificial acceleration, not a measurement of production's drift
rate. The original multi-day DVR session has not been rerun with this fix.

Simply preferring the existing MP4 wrapper did not fix the rounding: its fragment
decode times reset to zero and sequence mode still inherits the rounded end.
That approach was discarded; the patch retains the existing raw MP3 path.

## Reproducibility and maintenance

`tools/patch-icecast-player.mjs` contains the readable replacement code and the
bundle-symbol explanations. It applies only to the exact pristine 1.17.13 bundle,
checks each replacement occurs once and verifies the generated checksum. Running
it again checks the result without rewriting it. No package download or webpack
build is required. Upgrading the library requires reviewing these changes against
the new upstream code; do not carry the string replacements forward blindly.

SHA-256 of the main bundle:

- Pristine: `56eebcf6564576a8fe312f0efbfcf08280d848131f615f5248e073dc021246dc`
- Retry/handoff-only version: `65e0f9685d3c5553be105ac06eda8c6d3197a06246a3c1a0442bffbf9f11f908`
- Patched: `88ee30a7b00056761ad6abcb90d50f90283dd2c4a95284c99efcedcf23bef352`

Verify with `node tools/patch-icecast-player.mjs --check`. To regenerate from a
separately preserved pristine bundle, put that file at its original vendor path
and run `node tools/patch-icecast-player.mjs`. The exact retry/handoff-only bundle
is also accepted as an upgrade input. Existing copyright/license notices
are retained. The obsolete upstream source-map reference is removed; its map
does not describe the modified bundle. The HTML script URL uses the patched
bundle's short SHA-1 content hash, `5be23fad26`, for cache invalidation.

The runtime deployment pair is the modified main bundle and `player.html` with
its new script query. This is not permission to deploy. Both files already belong
to the normal deployment payload, but a narrow deployment must preserve unrelated
local/remote changes. No vendor chunks or proxy settings need changing for this
fix. Rollback requires the preserved pre-update main bundle **and** the matching
HTML script reference, not an indiscriminate checkout/deploy of this dirty tree.

## Regression coverage

`tests/stream-recovery.spec.js` runs against the shipped bundle in isolated
Chromium and Firefox processes, using only an ephemeral loopback server. Browser
requests outside that server are blocked. Synthetic MP3 fixtures exercise actual
decoding, PCM matching, MSE handoff, advancing media clocks and nonzero analyser
output; output gain is zero. No real stream or personal browser is involved.

The four cases cover delayed PCM handoff beyond the old deadline, late successful
play completion after stop, a real outage's timeout, and encoded-frame overlap
followed by another outage (checking stale-retry cancellation). The late-completion
case deliberately holds JS settlement of a genuinely successful native play
promise; this is a controlled scheduling regression, not proof that a particular
browser naturally schedules that race every time. Tests use a one-second retry
allowance to keep them short; prior isolated validation also exercised 30 seconds.
Firefox can complete the delayed handoff without the waiting event seen in
Chromium. WebKit is explicitly skipped here, not claimed as validated.

The append-boundary regression supplies about 51 seconds of synthetic MP3 in
small writes, counts samples in the bytes actually appended (raw frames or MP4
sample tables), and compares their duration with native MSE's buffered end. The
allowed error is 10 microseconds, not a tolerance which grows with stream length.
On the old Chromium path it measured about 879 microseconds of drift and failed;
the corrected path passes. Firefox's existing wrapped-MP3 path also passes as an
unchanged control. The full-app PCM/encoded-frame reconnection cases additionally
check that listening time continues across both handoff paths.

Run `npx playwright test tests/stream-recovery.spec.js --project=chromium
--project=firefox` (on one line), or the normal `npm run test:e2e` suite.
`tests/fixtures/recovery-128.mp3` and `recovery-160.mp3` encode the same synthetic
20-second signal at different bitrates. They are checked in so tests need no
encoder. Optional regeneration uses `python3 tools/generate-recovery-fixtures.py`
and the system `libmp3lame.so.0`; different encoder versions may change bytes.

Before the fix, Chromium reproduced the premature stop, late false PLAYING,
immediate outage timeout and stale-retry timeout. The patch addresses these
reproduced mechanisms; extended real-stream listening is still needed to assess
whether every observed field failure has been eliminated.
