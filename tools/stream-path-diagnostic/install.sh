#!/bin/bash
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run with sudo on player.opt9.' >&2; exit 1; }
source_dir=$(dirname "$(readlink -f "$0")")
vhost=/etc/apache2/sites-available/000-default-le-ssl.conf
base=/opt/stream-path-diagnostic
conf=/etc/apache2/stream-path-diagnostic.conf
backup=/var/backups/stream-path-vhost-before.conf
log_dir=/var/lib/stream-path-diagnostic
resume=false
if [[ ${1:-} == --resume ]]; then
    # Only resume a rolled-back installation, never overwrite later vhost edits.
    cmp -s "$vhost" "$backup" || { echo 'Vhost differs from saved backup; inspect manually.' >&2; exit 1; }
    id=$(php -r '$c=json_decode(file_get_contents($argv[1]),true,512,JSON_THROW_ON_ERROR); if (!preg_match("~^/_stream-path-([a-f0-9]{32})/sample[.]php$~",$c["path"],$m)) exit(1); echo $m[1];' "$base/config.json")
    cmp -s <(sed "s/__ID__/$id/g" "$source_dir/apache.conf") "$conf" || {
        echo 'Diagnostic Apache configuration differs; inspect manually.' >&2; exit 1;
    }
    resume=true
else
    [[ ! -e $base && ! -e $conf && ! -e $backup && ! -e $log_dir && ! -e /var/log/apache2/stream-path-requests.jsonl && ! -e /var/log/apache2/stream-path-apache.log ]] || {
        echo 'Diagnostic files already exist; refusing to overwrite. See README for --resume.' >&2; exit 1;
    }
    id=$(openssl rand -hex 16)
fi
grep -Eq '^ServerName m\.4st\.uk$' "$vhost"
[[ $(grep -c '</VirtualHost>' "$vhost") == 1 ]]
apache2ctl configtest
php -l "$source_dir/sample.php"
install -d -m 0755 "$base/www"
install -m 0644 "$source_dir/sample.php" "$base/www/sample.php"
install -d -o www-data -g adm -m 0750 "$log_dir"
touch "$log_dir/requests.jsonl" /var/log/apache2/stream-path-apache.log
chown www-data:adm "$log_dir/requests.jsonl"
chown root:adm /var/log/apache2/stream-path-apache.log
chmod 0640 "$log_dir/requests.jsonl" /var/log/apache2/stream-path-apache.log
runuser -u www-data -- test -w "$log_dir/requests.jsonl"
printf '{"log":"/var/lib/stream-path-diagnostic/requests.jsonl","path":"/_stream-path-%s/sample.php"}\n' "$id" > "$base/config.json"
chown root:www-data "$base/config.json"
chmod 0640 "$base/config.json"
sed "s/__ID__/$id/g" "$source_dir/apache.conf" > "$conf"
chmod 0644 "$conf"
if ! $resume; then cp -a "$vhost" "$backup"; fi
rollback() {
    cp -a "$backup" "$vhost"
    apache2ctl configtest && systemctl reload apache2 || echo 'Check Apache manually: rollback reload failed.' >&2
    echo 'Restored original vhost after installation failure; diagnostic files retained for inspection.' >&2
}
trap rollback ERR
sed -i '\|</VirtualHost>|i IncludeOptional /etc/apache2/stream-path-diagnostic.conf' "$vhost"
apache2ctl configtest
systemctl reload apache2
curl --fail --silent --show-error --max-time 10 --resolve m.4st.uk:443:127.0.0.1 \
    "https://m.4st.uk/_stream-path-$id/sample.php?case=install" -o "$base/install-sample.wav"
[[ $(stat -c %s "$base/install-sample.wav") == 16044 ]]
[[ $(head -c 4 "$base/install-sample.wav") == RIFF ]]
trap - ERR
printf '\nInstalled: https://m.4st.uk/_stream-path-%s/sample.php?case=manual\n' "$id"
