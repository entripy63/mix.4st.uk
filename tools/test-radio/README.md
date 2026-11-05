# Controlled public test radio

An isolated synthetic MP3 source on **player.opt9**, for exercising the real
app's normal Add stream, proxy, decoding and fault-detection paths. It does not
alter the app or the existing `/opt/stream-proxy` service.

Public URL: **https://t.4st.uk/test-radio/tone.mp3**

The service starts **off**: the URL returns 503 until privately enabled. It is
installed and started, but deliberately **not enabled at boot**. No DNS or
firewall changes were needed. The public URL carries only generated audio;
it is not secret or authenticated.

## Controls from Tantour

Start a test window with a quiet 440 Hz tone:

```sh
ssh player.opt9 'sudo curl -fsS --unix-socket /run/test-radio/control.sock -X POST http://localhost/mode/tone'
```

Add the public URL through the app's ordinary **Add stream** field, then press
its Play button. Use a separate browser profile/session, not an endurance test
or a page someone is listening to. The tone is synthetic, mono, 128 kbps,
44.1 kHz, approximately 0.04 peak before decoding, not normal listening content.

Replace `tone` in the command with:

- `silence`: continue sending valid MP3 audio containing silence. Playback time
  should advance after the existing audio buffer drains.
- `hold`: stop sending bytes without closing existing connections. Playback
  should stall after buffering is exhausted. Apache's upstream inactivity
  timeout is 180 seconds, so this is not an indefinite connection hold.
- `tone`: resume normal generated audio, including on held connections.
- `off`: close test connections and reject subsequent playback with 503.

All connected test listeners share the selected mode. Every non-off command
opens/renews a **15-minute window**, after which the service switches off and
closes its connections. Each connection also has a **10-minute maximum**;
at most **four** audio connections are accepted simultaneously. Slow consumers
are disconnected instead of accumulating audio in memory. These bounds are not
an authentication system; disable the source when not testing.

Status, without renewing the window:

```sh
ssh player.opt9 'sudo curl -fsS --unix-socket /run/test-radio/control.sock http://localhost/status'
```

The controls use a Unix socket inside `/run/test-radio` (mode 0700). They are
not served on a TCP control port or exposed through Apache.

**Report delivery is separate:** enabling this source does not suppress app
reports. For fault tests, intercept `/report.php` in the dedicated test browser
before loading the app, until actual test-mail delivery has been approved.
The minimal-reporting files are deployed to t only; other sites require separate
deployment approval. The old long-running t tab retains its loaded client code.

## Installation and separation

Source files in this directory:

- `server.mjs`: Node service; audio listener is **127.0.0.1:8090** only.
- `generate-audio.py`: generates four-second tone/silence MP3 clips locally
  using `libmp3lame.so.0`. Disables the MP3 bit reservoir and tags, allowing
  frame-aligned looping and switching without cross-frame dependencies.
- `test-radio.service`: sandboxed systemd service using a dynamic user.

Generate assets into a staging directory, not the website:

```sh
python3 tools/test-radio/generate-audio.py /path/to/staging
```

The installed files are `/opt/test-radio/{server.mjs,tone.mp3,silence.mp3}`,
root-owned and world-readable, plus
`/etc/systemd/system/test-radio.service`. Node reads the generated clips into
memory. No encoder or npm dependencies are needed on the server.

Only the HTTPS vhost in `/etc/apache2/sites-available/t.4st.uk.conf` has these
additional directives, before its existing Directory block:

```apache
ProxyPass /test-radio/ http://127.0.0.1:8090/test-radio/ connectiontimeout=5 timeout=180
ProxyPassReverse /test-radio/ http://127.0.0.1:8090/test-radio/
```

Keep service files outside `/var/www/test-t` and `/var/www/html`: normal site
deployments mirror-delete files. Never write to `/opt/stream-proxy/index.js`;
its watcher can restart the live proxy.

Initial installation used `systemd-analyze verify`, `systemctl daemon-reload`,
`systemctl start test-radio`, `apache2ctl configtest`, then **reload**, not
restart, of Apache. On a later restart the source returns to off. Inspect
current state and obtain approval before future shared-server changes.

## Verification on 5 November 2026

- Public HTTPS returns 503 while off and 200 `audio/mpeg` while enabled;
  public control-path attempts return 404.
- Public pacing delivered approximately 16 kB/s. Requested ICY metadata used
  valid empty blocks every 16384 audio bytes.
- A held public connection remained open without receiving bytes, then
  resumed delivery on that same connection.
- Four simultaneous connections succeeded; a fifth returned 503.
- A fresh headless Chromium session added the public URL through the deployed
  t site's normal UI and played through **c2.proxy.4st.uk**, without changing
  proxy selection or playback code.
- Decoded input RMS changed from approximately **0.0273** for the tone to
  **0**, while media time advanced from **4.04 to 6.04 seconds**, then returned
  to approximately **0.0254** after resuming the tone. Existing website/report
  beacons were blocked in that dedicated browser; no report mail was sent.
- Apache MainPID **649388** and stream-proxy MainPID **408491** were unchanged
  by installation. The test source was returned to off afterward.

The source checks did not wait out the 10/15-minute safety deadlines or perform
a long-duration endurance run.

### Real reporting checks

The six reporting files (`report.php`, `reports.php`, `report.js`, `player.css`,
`reporting.html`, cache-busted `player.html`) were subsequently deployed to t
with approval. Per-file atomic replacements installed the endpoint first and
HTML last. Protected pre-deploy copies are in
`player.opt9:~/.local/state/mix-reporting-deploy/20261105-reporting/old/`.
Playback code, audio workers and proxy configuration remained byte-identical;
neither Apache nor the live proxy was restarted or reloaded for this deployment.

Fresh Chromium and Firefox sessions used the deployed app's normal Add stream
interface, real MP3 decoding and c2 proxy routing, with real time (no accelerated
clock or injected fault events). Only outgoing `/report.php` requests were
intercepted, plus the unrelated usage beacon was blocked:

- Forty seconds of healthy playback advanced the media clock by approximately
  forty seconds in each browser and produced no persistent faults or reports.
- Sustained encoded silence produced a `silent-audio` report in each browser.
  Three/four repeated detections still produced only one upload attempt.
- Chromium received a simulated 204 success; Firefox received a simulated 503
  failure. Both retained the local problem; neither repeated the upload.
- Withholding audio until the real playback buffer ran out produced a
  `stalled-playback` report in each browser.
- Opted-out sessions still detected/saved genuine silence, but sent no reports.
- Captured requests contained exactly the compact allowlist, the independently
  calculated SHA-256 fingerprint of the public source, and distinct random page
  IDs. They contained no raw stream URL, nickname, cookie or referrer.

Captured real browser payloads were replayed through a byte-identical copy of
the deployed endpoint using PHP on player.opt9, bound to loopback, with a
per-process mail transport that only captured output to a temporary file.
Valid silence/stall reports returned 204; saved records and captured mail omitted
identity/raw URLs. Old detailed automatic reports and extra fault fields returned
422 before logging/mail. A manual report remained compatible, and the fourth
accepted-format submission returned 429 under the shared three/hour limit.
The temporary PHP server, test logs and captured mail were removed afterwards.

**No actual email delivery was tested or authorized.** The public PHP/Apache
submission path was intercepted in the browsers, not exercised end to end.
WebKit and real decoder-restart exhaustion were not exercised by these live
checks. Local controlled tests cover the restart-limit payload, fingerprint
normalisation and the asynchronous opt-out boundary separately. The public
source was returned to off with zero connections after the live checks.

## Stop and rollback

`off` is normally sufficient. To stop the isolated service entirely:

```sh
ssh player.opt9 'sudo systemctl stop test-radio'
```

To start it again (still initially off):

```sh
ssh player.opt9 'sudo systemctl start test-radio'
```

For complete removal, remove **only** the two ProxyPass directives and their
test-radio comment from the current t HTTPS vhost, check Apache configuration,
and gracefully reload. Then stop/remove the test-radio unit and its own files,
and reload systemd. Preserve unrelated later edits. A pre-install vhost copy is
at `/opt/test-radio/t.4st.uk.conf.before-test-radio`; do not blindly restore it
over later changes. Leave the existing proxy, app roots, TLS and DNS alone.
