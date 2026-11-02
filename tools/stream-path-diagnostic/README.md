# Temporary outbound-path diagnostic

Installs one unguessable sample URL **inside m.4st.uk's HTTPS vhost only**.
No stream-proxy source, service, firewall, DNS or billing changes. Apache needs
one graceful configuration reload; established connections should not be cut.
The existing home-test deployment does not own these files, so its mirror/delete
cannot remove them. This is not a permanent public audio service.

The endpoint accepts GET with a short alphanumeric `case` label, logs a bounded
selection of transport-related headers, and returns a deterministic one-second
WAV tone at approximately -36 dBFS. It makes no outbound requests. There is no
HTML/JSON content guard exception and no authentication credential in a query.
The random URL is a temporary capability, not strong authentication; do not
publish it. Logs are outside the document root and readable by the server's
`adm` group. Cookies, Authorization and unselected headers are not logged.

## Install on player.opt9

Copy this directory to `~/stream-path-diagnostic`, then run there:

```sh
sudo bash ~/stream-path-diagnostic/install.sh
```

The installer refuses existing paths, verifies the known vhost shape, checks
Apache and PHP syntax, retains a vhost backup, and rolls back the vhost edit if
the new configuration check/reload or sample request fails. Before enabling the
endpoint it checks log write access as `www-data`, not just as root. It does not
modify sudo policy.

To retry the rolled-back installation after correcting an installer error:

```sh
sudo bash ~/stream-path-diagnostic/install.sh --resume
```

This preserves the generated URL, original backup and existing logs, and refuses
to proceed if the vhost differs from the backup or the diagnostic Apache
configuration differs from the generated template. It is not a general upgrade
or reinstall command for an active installation.

## Evidence

- `/var/log/apache2/stream-path-apache.log`: external connection peer, HTTP
  version, TLS version/cipher/SNI, request, response status, byte count and
  selected correlation headers. `peer` uses the connection address independently
  of any mod_remoteip rewriting of `remote`.
- `/var/lib/stream-path-diagnostic/requests.jsonl`: case, PHP-visible connection/TLS
  fields and selected request headers. These are parsed headers, not raw wire
  order/capitalization or TLS ClientHello/ALPN capture. The separate private
  directory permits PHP writes without opening access to `/var/log/apache2`.
- `/opt/stream-path-diagnostic/config.json`: generated URL path and log location.

Compare one request per path sequentially, using the same case-independent URL
and distinguishing case labels. Check status, SHA-256 and real sample decoding,
not merely successful HTTP. Compare isolated Workers fetch and hostname TLS,
then deployed candidate/production Cloudflare/Deno/home controls. A user-agent
or source IP observed here does not prove the same routing at SileX/Soul City.
No station probes are needed for this comparison.

## Disable

On player.opt9:

```sh
sudo mv /etc/apache2/stream-path-diagnostic.conf /etc/apache2/stream-path-diagnostic.conf.disabled
sudo apache2ctl configtest && sudo systemctl reload apache2
```

The vhost uses IncludeOptional, so the missing file disables the endpoint and
dedicated Apache log without restoring an old vhost over subsequent edits.
Keep logs and backup until the investigation is finished. Reinstallation is
deliberately not automatic. Neither source files nor installation are committed
or deployed by the app's normal deploy script.
