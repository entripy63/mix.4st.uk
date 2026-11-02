# Quiet overnight stream checks

A **user systemd timer on this workstation** checks the local `streams/*.streams`
presets, without changing presets, the app, or any proxy deployment.

- Starts at 03:30 local time, plus up to 20 minutes of random delay.
- No catch-up when the workstation is off. A manual daytime service start exits
  without probing. Low CPU/I/O priority; a two-hour service timeout.
- Healthy URLs are checked every seven days. First checks are staggered over the
  next seven nights; currently 103 eligible URLs, approximately 10–19 per night.
  At most 30 configured URLs per run prevents a backlog becoming a large scan.
- Deepvibes, Jungletrain, Sleepbot and Monkey Radio are excluded by saved station
  name and known endpoint URLs, including their known Sleepbot raw-IP endpoints.
  URLs shared between presets are checked once. Exclusions are reapplied to
  playlist entries; redirects followed internally by a proxy cannot be inspected
  by this checker.
- Requests go **only to HTTPS proxies**, never directly to stream hosts: candidate
  first, home comparison on failure, then Deno if neither succeeds. A working
  fallback counts as healthy: the known SileX/Soul City candidate failures do not
  themselves produce email. Deno's eventual retirement will require removing it
  from the scanner's proxy list, independently of the app list.
- Sequential GETs, two-second gaps, 15-second request deadlines, 45-second budget
  per proxy/configured URL. Samples stop after five seconds of response-body
  collection or 192 KiB, whichever comes first. No ICY metadata requested.
  PLS/M3U resolution is bounded to three playlist levels and three alternatives
  per playlist. Chromium must reach `canplay` on the captured blob; it never
  plays the audio aloud or fetches stream URLs itself.
- A failure is retried the next night. **Two failed scan nights**, with no working
  tested proxy, generate one exception email to `st`, using `/usr/bin/mail -s`.
  The report names presets/stations and includes per-proxy failure reasons.
  Unchanged failures do not keep emailing. Successful recovery silently rearms
  notification for a later failure episode. Failed email submission is not
  marked delivered. Ordinary scanner errors also attempt an attention email.

## Limits

This is a short availability/sample-decode check, not sustained listening. It
does not establish station identity, audible content, browser-app correctness,
gapless reconnect behaviour or metadata quality. **Decodable silence passes.**
Temporary outages, source-IP connection limits, geographic restrictions and
checker limitations can all produce exceptions; do not automatically delete a
station. HLS playlists are reported as unsupported by the checker, not dead.

The timer cannot report if the workstation/user manager is down. A process killed
before its error handler runs (for example by the systemd timeout), broken Node
installation or mail delivery failure may only appear in the user journal.

## Install on this workstation

Requires this repository at `~/git/mix.4st.uk`, its installed `@playwright/test`
dependency, `/usr/bin/node`, `/usr/bin/chromium`, `/usr/bin/flock`, and the existing
working `/usr/bin/mail -s "subject" st` setup. Mail submission adds `-S sendwait`
(supported by this workstation's mailx) so submission errors return a failure
instead of occurring asynchronously after the mail command exits. The service
runs as the ordinary user, without filesystem/privilege sandbox restrictions:
local Postfix submission requires the setgid `postdrop` helper and spool access.
The service deliberately reads the local presets, so URL edits automatically
enter the next scan schedule.

From the repository root, when no scan is running:

```sh
install -m 0644 tools/stream-health/stream-health.{service,timer} ~/.config/systemd/user/
node tools/stream-health/scan.mjs --init
systemctl --user daemon-reload
systemctl --user enable --now stream-health.timer
```

`--init` preserves existing history and only seeds new URLs; it makes no network
requests and sends no mail. State is in `~/.local/state/stream-health/state.json`
(mode 0600), outside the repository. The service locks this state against
overlapping service starts. Do not delete state when updating the script: it
holds scan dates and notification history.

```sh
node tools/stream-health/scan.mjs --plan  # read-only schedule and exclusions count
systemctl --user list-timers stream-health.timer
systemctl --user status stream-health.service
journalctl --user -u stream-health.service -n 50 --no-pager
systemctl --user disable --now stream-health.timer  # stop future scans
```

Tests use temporary presets/state, synthetic proxy replies and real local
Chromium decoding, without contacting live stations or sending real email:

```sh
node --test tools/stream-health/scan.test.mjs
systemd-analyze --user verify tools/stream-health/stream-health.{service,timer}
```
