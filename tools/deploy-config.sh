#!/bin/bash
# Deployment configuration

# LFTP bookmarks and paths
declare -A SERVERS=(
  [prod]="axc"
  [test]="axc-test"
  [prod-backup]="live"
  [test-backup]="live-test"
)

# Remote directories (change these based on your server structure)
declare -A REMOTE_DIRS=(
  [prod]="/"
  [test]="/"
  [prod-backup]="/"
  [test-backup]="/"
)

# Mirror commands for each target
# Note: mixes/mixes-config.json is excluded - manage per-server to avoid overwrites
# Media files (mp3, m4a, flac, wav, opus, peaks.json, images) are excluded to
# prevent --delete from removing server-only media not present locally
MIRROR_EXCLUDES="-x .git/ -x .github/ -x .gitignore -x AGENTS.md -x docs/ -x tools/ -x node_modules/ -x lib/ -X package* -X eslint.*"
MEDIA_EXCLUDES="-x '\.mp3$' -x '\.m4a$' -x '\.flac$' -x '\.wav$' -x '\.opus$' -x '\.peaks\.json$' -x manifest\.json -x '\.jpg$' -x '\.png$' -x '\.gif$' -x '\.bmp$' -x '\.mediaartlocal$'"

declare -A MIRROR_COMMANDS=(
  [prod]="mirror -R --delete $MIRROR_EXCLUDES $MEDIA_EXCLUDES"
  [test]="mirror -R --delete $MIRROR_EXCLUDES $MEDIA_EXCLUDES"
  [prod-backup]="mirror -R --delete $MIRROR_EXCLUDES $MEDIA_EXCLUDES"
  [test-backup]="mirror -R --delete $MIRROR_EXCLUDES $MEDIA_EXCLUDES"
)

# Export for use in other scripts
export SERVERS
export REMOTE_DIRS
export MIRROR_COMMANDS
