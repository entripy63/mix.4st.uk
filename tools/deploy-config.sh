#!/bin/bash
# Deployment configuration

# LFTP bookmarks and paths
declare -A SERVERS=(
  [mixes-prod]="axc"
  [mixes-test]="axc-test"
  [live-prod]="live"
  [live-test]="live-test"
)

# Remote directories (change these based on your server structure)
declare -A REMOTE_DIRS=(
  [mixes-prod]="/"
  [mixes-test]="/"
  [live-prod]="/"
  [live-test]="/"
)

# Mirror commands for each target
# Note: .htaccess and mixes/mixes-config.json are excluded - manage these per-server to avoid overwrites
declare -A MIRROR_COMMANDS=(
  [mixes-prod]="mirror -R -x .git/ -x .gitignore -x AGENTS.md -x docs/ -x tools/ -x node_modules/ -x .htaccess -x mixes/mixes-config.json -X package* -X eslint.*"
  [mixes-test]="mirror -R -x .git/ -x .gitignore -x AGENTS.md -x docs/ -x tools/ -x node_modules/ -x .htaccess -x mixes/mixes-config.json -X package* -X eslint.*"
  [live-prod]="mirror -R --only-existing"
  [live-test]="mirror -R --only-existing"
)

# Export for use in other scripts
export SERVERS
export REMOTE_DIRS
export MIRROR_COMMANDS
