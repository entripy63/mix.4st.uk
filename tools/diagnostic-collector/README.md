# Local endurance diagnostic collector

Opt-in console tool for an already-open Chromium player. It uses the existing
`playbackDiagnostics.report()` export, without reloading, changing playback,
using the clipboard, fetching streams or submitting reports. It is not loaded by
the app and requires no deployment. Firefox does not support this folder picker.

## Start once in each test tab

1. Open DevTools → Console in the intended player tab. Paste the entire contents
   of `tools/diagnostic-collector/collector.js` and execute it. Review pasted code;
   do not disable browser self-XSS protections just to paste unfamiliar code.
2. Execute `await diagnosticCollector.start({ hours: 12 })`.
3. Choose `/home/st/Documents/diagnostics/` and permit changes to that folder.
   Each site requires its own permission. This grants that site access to the
   selected directory, not just permission to create diagnostic files. Do not
   choose the whole Documents folder or a directory containing secrets.
4. Check the returned status and that the first file exists. Close DevTools if
   desired; the collector remains in the page.

The first capture is immediate, then one is due every 12 hours after a successful
save. Change `hours` at start to use another interval. A one-minute timer checks
the deadline; background scheduling can delay it. A late capture has its actual
timestamp, with no invented backfill. A manual save resets the next deadline.

Files are ordinary diagnostic JSON, with no extra collector payload, named like
`MR-261106-153012-123-t.4st.uk.txt`. Names use local time (including seconds and
milliseconds) and the full actual hostname. JSON timestamps remain UTC. Sorting
by name is chronological except across a backward local-clock/DST change.
Existing names are refused, not intentionally overwritten. Avoid multiple
collectors on the same site: the existence check is not an atomic exclusive create.

## Check or stop

```js
diagnosticCollector.status()
await diagnosticCollector.saveNow()
diagnosticCollector.stop()
```

Status includes the page, last successfully saved filename/time, next deadline
and last error. A scheduled failure is logged, remains visible in status, and is
retried at the next minute check. Lost permission needs a stop/start and another
user gesture; the collector does not open unsolicited permission prompts.
Stopping prevents scheduled saves but lets an in-progress write finish. It does
not revoke browser folder permission; revoke that through site permissions if
required. Reloading, closing the tab or restarting Chromium removes the collector;
start it again manually. No promise of uninterrupted collection across updates.

Full diagnostics can contain stream addresses and browser details. Files stay
local, are not rotated or deleted automatically, and are not covered merely by
existing backups of other Documents files. A periodic export is a snapshot of the
recorder's bounded history, not a complete log of the preceding 12 hours.

## Checks

Run the contract checks with `node --test tools/diagnostic-collector/collector.test.mjs`.
Actual browser/folder-picker validation must use an isolated browser and scratch
directory before introducing the collector into an endurance tab.

Validated on Tantour on 6 November 2026 using isolated system Chromium on a
virtual display, the local app and a looping local WAV. The real directory picker
and edit-permission prompt were accepted for a scratch folder. The initial save
and the next scheduled save (60 seconds later, with a shortened interval) produced
valid diagnostic JSON with the correct page/hostname, active playback and non-zero
input readings. No pause, emptied or ended events occurred after collection was
introduced into the running test playback. Stop returned an inactive status.
No endurance tab was accessed and no report mail was sent. The 12-hour boundaries,
late wake-up, distinct m/t names, permission loss, disk errors, retry, wrong-page
rejection, duplicate-file protection and cancellation were checked separately
with controlled clocks and file-system doubles, not a 12-hour browser run.
