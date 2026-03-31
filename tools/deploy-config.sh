#!/bin/bash
# Deployment configuration

# LFTP bookmarks and paths
declare -A SERVERS=(
  [prod]="axc"
  [test]="axc-test"
  [home-test]="home-test"
)

# Remote directories (change these based on your server structure)
declare -A REMOTE_DIRS=(
  [prod]=""
  [test]=""
  [home-test]=""
)

# Mirror commands for each target
# Audio files are excluded to prevent --delete from removing server-only
# media not present locally. Peaks, manifests, and images ARE deployed
# as they are generated locally.
MIRROR_EXCLUDES="-x .git/ -x .github/ -x .gitignore -x AGENTS.md -x docs/ -x tools/ -x node_modules/ -x lib/ -X package* -X eslint.*"
MEDIA_EXCLUDES="-x '\.mp3$' -x '\.m4a$' -x '\.flac$' -x '\.wav$' -x '\.opus$' -x '\.mediaartlocal$'"

declare -A MIRROR_COMMANDS=(
  [prod]="mirror -R --delete $MIRROR_EXCLUDES $MEDIA_EXCLUDES"
  [test]="mirror -R --delete $MIRROR_EXCLUDES $MEDIA_EXCLUDES"
  [home-test]="mirror -R --delete $MIRROR_EXCLUDES $MEDIA_EXCLUDES"
)

# Export for use in other scripts
export SERVERS
export REMOTE_DIRS
export MIRROR_COMMANDS
