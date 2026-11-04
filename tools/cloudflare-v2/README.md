# Permanent TCP Workers

Separate successors to the two [candidate Workers](../cloudflare-candidate/README.md).
Both were deployed on 30 October 2026. The canonical application list is now
[`streams/proxy-config.json`](../../streams/proxy-config.json): normal v2 → US v2
→ home, uploaded by every normal site deployment. m, t and player already use
this order; production promotion remains separately approved work. This change
to the repository does not deploy anything. Do not rename, overwrite or delete
either candidate. The original Worker deployment left app proxy lists, existing
Workers and Custom Domain attachments unchanged; the rollout history follows.

| Configuration | Deployed Worker | Placement |
| --- | --- | --- |
| `wrangler.jsonc` | [stream-proxy-v2](https://stream-proxy-v2.round-bar-e93e.workers.dev/status) | Normal Cloudflare placement |
| `wrangler-us.jsonc` | [stream-proxy-v2-us](https://stream-proxy-v2-us.round-bar-e93e.workers.dev/status) | `aws:us-east-1` placement hint |

Both use this directory's independent `worker.js`. The source is copied from the
candidate with only the request policy and `/status` type changed. Socket/fetch
transport, DNS/IP checks, redirect checks, content-type handling, native body
relay, backpressure, cancellation and header deadline are unchanged. The
candidate compatibility date/flags are deliberately retained so policy is the
only runtime-behaviour change; this is not a library or compatibility upgrade.

## Request policy

- **Client HTTPS only:** reject an HTTP request URL with 403, even if
  `X-Forwarded-Proto` is absent or claims HTTPS. Retain the existing rejection
  when that header explicitly reports a non-HTTPS scheme. This gate precedes
  OPTIONS and `/status`, so those endpoints cannot bypass it. Reject rather
  than redirect; the app's configured URLs must already use HTTPS.
- **Page origin:** allow HTTPS `4st.uk` and any depth of its subdomains, on the
  default HTTPS port. Includes `mixes.4st.uk`, `m.4st.uk`, `player.4st.uk` and
  future subdomains without redeployment. Explicit port 443 normalises to the
  default; non-default ports, HTTP origins, other domains and suffix lookalikes
  are rejected. Parse the hostname and match the dot boundary, not a substring.
- Prefer Origin; use Referer only if Origin is absent/empty, as before. An
  explicitly disallowed Origin cannot be rescued by an allowed Referer.
- Keep public HTTPS `/status` (`type: cloudflare-tcp-v2`) and the existing
  HTTPS OPTIONS response/CORS headers. `/status?url=...` is a proxy request,
  not a bypass. CORS remains `*`, including errors, so failures are visible to
  the player. Origin/Referer is a hotlinking deterrent, **not authentication**.
- **Upstream HTTP remains supported**, for both named and raw-IP streams,
  including HTTP redirect targets and ICY responses. HTTPS-only client access
  does not mean HTTPS-only radio servers.

## Local checks

The existing socket-boundary suite is reused rather than duplicating its
transport fixtures. The variant selector chooses the actual source file;
`candidate` is the default. No tests contact real radio servers or browsers.

```sh
node --experimental-vm-modules --test tools/cloudflare-candidate/worker.test.js
STREAM_PROXY_VARIANT=v2 node --experimental-vm-modules --test tools/cloudflare-candidate/worker.test.js
npx eslint tools/cloudflare-candidate/*.js tools/cloudflare-v2/*.js
```

Candidate: nine passing tests, one v2-only test skipped. V2: ten passing tests.
Coverage includes allowed apex/deep/uppercase origins, rejected lookalikes and
HTTP origins, Referer fallback, HTTP requests with missing/spoofed forwarding
headers, preflight/status, both transports, binary metadata, chunk framing,
redirects, private destinations, cancellation, backpressure and header failures.

These commands **compile locally without deployment**:

```sh
wrangler deploy --dry-run --config tools/cloudflare-v2/wrangler.jsonc
wrangler deploy --dry-run --config tools/cloudflare-v2/wrangler-us.jsonc
```

Both passed with Wrangler 4.103.0. This validates local bundling/configuration,
not account provisioning, actual placement, edge rejection policy or playback.
Evidence is under `.amp/in/artifacts/cloudflare-v2-preparation/`.

## Deployment verification and remaining NameCrane gates

Both names were verified unused before creation. Deployed module hashes match
the locally reviewed dry-run bundle. Fifty-two live policy probes passed across
the two Workers, using missing or blocked destinations, not radio streams.
Allowed origins reached the expected missing-URL response; denied origins and
HTTP requests were rejected, including HTTP preflight with a spoofed HTTPS
forwarding header. Public HTTPS status and preflight passed. The API confirms
targeted `aws:us-east-1` placement for the US Worker; policy responses did not
include a placement header, so they do not independently establish execution
location or station-facing IP classification.

Deployment evidence, version IDs and before/after comparisons are under
`.amp/in/artifacts/cloudflare-v2-deployment-20261030T195050Z/`. Cloudflare rejected
the initial Python-default User-Agent with error 1010 before Worker execution;
a controlled User-Agent comparison isolated this, and policy checks passed with
a browser-style User-Agent. No edge security settings were changed.

Further Worker updates need approval. Use only this directory's configs, never
the candidate configs or `tools/wrangler.toml`. No account/billing changes,
Custom Domains, DNS changes or removal of old Workers are part of this rollout.

Authorised bounded stream checks passed on both Workers: SomaFM named HTTPS
via fetch, and jungletrain named HTTP/ICY plus raw-IP HTTP via TCP. Monkey Radio
returned 401 through normal v2 and 200 with audio/track metadata through US v2.
Each successful request stopped at 256 KiB; all seven captured audio samples
decoded to nonzero PCM in isolated Chromium after ICY metadata removal. This
establishes short stream delivery, not endurance, app reconnection behaviour or
guaranteed future geographic access. Evidence is in
`.amp/in/artifacts/cloudflare-v2-stream-checks-20261030/`. All three live app lists
were rechecked unchanged. Preserve candidates and the current endurance session.

The NameCrane-only list in `proxy-config.json` was deployed on 30 October 2026:
`https://c2.proxy.4st.uk` → `https://us.proxy.4st.uk` → existing home fallback.
Both Custom Domains passed verified HTTPS status and bounded stream checks
(64 KiB each: SomaFM through c2 and Monkey Radio through us). The US domain
initially failed its TLS handshake but succeeded on recheck. Native workers.dev
URLs are retained as manual `backupUrl` recovery references, not automatic retries.

Only `domains/toot.org.uk/public_html/streams/proxy-config.json` was uploaded,
not a full site mirror. SFTP readback and the public HTTPS file matched the local
list byte-for-byte; all three endpoint status checks passed. No browser session,
home-test or production deployment was touched. The rollback copy (`before.json`)
and verification evidence are in
`.amp/in/artifacts/namecrane-proxy-config-20261030T201352Z/`.

Rollback of a NameCrane trial means restoring its saved list. It does not require
deleting the new Workers or changing candidates; old unused Worker deletion is
a separate decision. Recovery-source capture/acceptance/publication is likewise
separate from this local preparation.
