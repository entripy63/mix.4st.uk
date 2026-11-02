#!/bin/bash
# Deployment configuration

# LFTP bookmarks or URLs. The empty SFTP password prevents an interactive
# password prompt; NameCrane authenticates with the existing SSH key.
declare -A SERVERS=(
  [prod]="axc"
  [home-test]="home-test"
  [home-test-t]="home-test"
  [namecrane]="sftp://tootorgu78:@uk-shared02.dapanel.net:53667"
)

# Remote directories (change these based on your server structure)
declare -A REMOTE_DIRS=(
  [prod]=""
  [home-test]="html"
  [home-test-t]="test-t"
  [namecrane]="domains/toot.org.uk/public_html"
)

# Mirror commands for each target
# Audio files are excluded to prevent --delete from removing server-only
# media not present locally. Peaks, manifests, and images ARE deployed
# as they are generated locally.
MIRROR_EXCLUDES="-x .git/ -x .github/ -x .githooks/ -x .gitignore -x .codex -x .amp/ -x AGENTS.md -x docs/ -x tools/ -x tests/ -x test-results/ -x node_modules/ -x lib/ -X package* -X eslint.* -X playwright.*"
MEDIA_EXCLUDES="-x '\.mp3$' -x '\.m4a$' -x '\.flac$' -x '\.wav$' -x '\.opus$' -x '\.mediaartlocal$' -x beacon.log -x reports.log -x 'reports-.*\.bak$' -x report_rate_ -x secret-config.php"

# Keep each test site's separately managed routing separate from production.
# lftp exclusions protect this remote file from both replacement and deletion.
# NameCrane also preserves ACME challenge files.
declare -A MIRROR_COMMANDS=(
  [prod]="mirror -R --delete $MIRROR_EXCLUDES $MEDIA_EXCLUDES"
  [home-test]="mirror -R --delete $MIRROR_EXCLUDES $MEDIA_EXCLUDES -x '^streams/proxy-config\.json$'"
  [home-test-t]="mirror -R --delete $MIRROR_EXCLUDES $MEDIA_EXCLUDES -x '^\.well-known/' -x '^streams/proxy-config\.json$'"
  [namecrane]="mirror -R --delete $MIRROR_EXCLUDES $MEDIA_EXCLUDES -x '^\.well-known/' -x '^streams/proxy-config\.json$'"
)

# Export for use in other scripts
export SERVERS
export REMOTE_DIRS
export MIRROR_COMMANDS
