# Certbot health logging on the home NUC

This monitor sends only fault transitions and recoveries to `syslog.srv`
(`192.168.8.9`, UDP 514), tagged `certbot-health`:

- `user.warning` after scheduled renewal failures persist for 24 hours.
- `user.warning` when no scheduled Certbot run has completed for 48 hours.
- One `user.notice` recovery per previously reported condition.

These priorities appear in the receiver's `/var/log/messages`, which excludes
the daemon facility and general error-severity messages.

The independent timer checks hourly, so a threshold crossing is reported at
the next check. Initial installation allows 48 hours for the first observed
Certbot run. Successful runs and transient failures do not generate messages.
This monitors scheduled `certbot.service` runs, not manual CLI renewals, and
does not check certificate age or the certificate served by Apache.

UDP delivery is best-effort: a successful `logger` exit does not confirm that
the receiver stored the message. The monitor cannot report if the entire NUC
or its own health timer is down; external monitoring is a separate concern.

## Install

Copy this directory to `~/certbot-health` on `player.opt9`, then run there:

```sh
sudo install -m 0755 ~/certbot-health/certbot-health.py /usr/local/sbin/certbot-health
sudo install -m 0644 ~/certbot-health/certbot-health.service /etc/systemd/system/
sudo install -m 0644 ~/certbot-health/certbot-health.timer /etc/systemd/system/
sudo install -d -m 0755 /etc/systemd/system/certbot.service.d
sudo install -m 0644 ~/certbot-health/health.conf /etc/systemd/system/certbot.service.d/health.conf
sudo systemctl daemon-reload
sudo systemctl start certbot-health.service
sudo systemctl enable --now certbot-health.timer
```

The installation does not trigger renewal or restart Apache. The next normal
Certbot service execution records its result through `ExecStopPost`.
Persistent state lives in `/var/lib/certbot-health/`, shared by the two services
and protected with a file lock. Keep that state when updating the script.

Confirm receipt of one explicit test message on the syslog receiver:

```sh
logger --udp --server 192.168.8.9 --port 514 --rfc3164 \
  --tag certbot-health --priority user.notice \
  'TEST: Certbot health syslog delivery; no certificate fault implied'
```

Check installation without inducing a certificate failure:

```sh
systemctl cat certbot.service
systemctl list-timers certbot.timer certbot-health.timer
journalctl -u certbot-health.service -n 20 --no-pager
```

To remove the monitor, disable its timer, remove its two unit files and the
`health.conf` drop-in, and run `systemctl daemon-reload`. Do not disable
`certbot.timer` or delete any certificate or Cloudflare credential files.
