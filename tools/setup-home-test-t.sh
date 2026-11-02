#!/bin/bash
# One-time setup on player.opt9; run interactively with sudo, not from deploy.sh.
# Adds only t.4st.uk. Never restarts Apache or the Node stream proxy.
set -euo pipefail
stage=preflight
trap 'status=$?; echo "t.4st.uk setup failed during $stage (line $LINENO, exit $status). Inspect state before retrying." >&2; exit "$status"' ERR
echo 'Starting t.4st.uk setup: checking host, new-site paths and prerequisites.'
[[ $EUID == 0 ]] || { echo 'Run with sudo on player.opt9.' >&2; exit 1; }
[[ $(hostname -s) == player ]] || { echo 'Expected player.opt9.' >&2; exit 1; }
root=/var/www/test-t
conf=/etc/apache2/sites-available/t.4st.uk.conf
hook=/etc/letsencrypt/renewal-hooks/deploy/t.4st.uk
[[ ! -e $root && ! -e $conf && ! -e $hook ]] || {
    echo 'New-site paths already exist; inspect before retrying. Nothing overwritten.' >&2
    exit 1
}
# The existing home-test SFTP connection must see /var/www as its jail root.
# Capture the complete output before matching: grep -q must not close sshd's
# stdout early and turn a successful check into SIGPIPE under pipefail.
if sshd_config=$(/usr/sbin/sshd -T -C user=webdeploy,host=player.opt9,addr=192.168.2.125); then
    if ! grep -qx 'chrootdirectory /var/www' <<< "$sshd_config"; then
        echo 'Preflight failed: webdeploy SSH chroot is not /var/www. No setup changes made.' >&2
        exit 1
    fi
else
    status=$?
    echo "Preflight failed: cannot inspect effective SSH configuration (exit $status). No setup changes made." >&2
    exit "$status"
fi
unset sshd_config
if ! test -r /etc/letsencrypt/secrets/cloudflare.ini; then
    echo 'Preflight failed: protected Cloudflare credential file is not readable. No setup changes made.' >&2
    exit 1
fi
echo 'SSH chroot and credential readability checks passed; checking Apache configuration.'
apache2ctl configtest
before_apache=$(systemctl show apache2 -p MainPID --value)
before_proxy=$(systemctl show stream-proxy -p MainPID --value)
# DNS-01 avoids port 80/firewall changes. certonly does not edit other vhosts.
stage=certificate
echo 'Obtaining the separate t.4st.uk certificate via DNS-01 (60-second propagation wait).'
certbot certonly --non-interactive --dns-cloudflare \
    --dns-cloudflare-credentials /etc/letsencrypt/secrets/cloudflare.ini \
    --dns-cloudflare-propagation-seconds 60 --cert-name t.4st.uk -d t.4st.uk
stage=new-site-files
echo 'Creating only the t.4st.uk document root, vhost and renewal hook.'
install -d -o webdeploy -g www-data -m 2775 "$root"
# PHP writes only this site's own logs/rate files; never reuse another site's secrets.
install -o www-data -g www-data -m 0640 /dev/null "$root/beacon.log"
install -o www-data -g www-data -m 0640 /dev/null "$root/reports.log"
cat > "$conf" <<'APACHE'
<VirtualHost *:80>
    ServerName t.4st.uk
    Redirect permanent / https://t.4st.uk/
</VirtualHost>
<VirtualHost *:443>
    ServerName t.4st.uk
    DocumentRoot /var/www/test-t
    SSLCertificateFile /etc/letsencrypt/live/t.4st.uk/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/t.4st.uk/privkey.pem
    Include /etc/letsencrypt/options-ssl-apache.conf
    <Directory /var/www/test-t>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
    ErrorLog ${APACHE_LOG_DIR}/t.4st.uk-error.log
    CustomLog ${APACHE_LOG_DIR}/t.4st.uk-access.log combined
</VirtualHost>
APACHE
chmod 0644 "$conf"
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > "$hook" <<'HOOK'
#!/bin/sh
set -eu
if [ "${RENEWED_LINEAGE:-}" = /etc/letsencrypt/live/t.4st.uk ]; then
    /usr/sbin/apache2ctl configtest
    /usr/sbin/apache2ctl graceful
fi
HOOK
chmod 0755 "$hook"
stage=enable-and-configtest
echo 'Enabling t.4st.uk and checking the combined Apache configuration.'
a2ensite t.4st.uk.conf
if ! apache2ctl configtest; then
    a2dissite t.4st.uk.conf
    echo 'New vhost disabled; running Apache was not reloaded.' >&2
    exit 1
fi
# Debian's ExecReload is apachectl graceful: existing connections drain normally.
stage=graceful-reload
echo 'Gracefully reloading Apache; no Apache or Node restart.'
systemctl reload apache2
stage=service-pid-verification
test "$(systemctl show apache2 -p MainPID --value)" = "$before_apache"
test "$(systemctl show stream-proxy -p MainPID --value)" = "$before_proxy"
apache2ctl -S
echo 't.4st.uk configured. Upload reviewed app files to home-test SFTP test-t/ next.'
