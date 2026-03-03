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
declare -A MIRROR_COMMANDS=(
  [prod]="mirror -R -x .git/ -x .gitignore -x AGENTS.md -x docs/ -x tools/ -x node_modules/ -x mixes/mixes-config.json -X package* -X eslint.*"
  [test]="mirror -R -x .git/ -x .gitignore -x AGENTS.md -x docs/ -x tools/ -x node_modules/ -x mixes/mixes-config.json -X package* -X eslint.*"
  [prod-backup]="mirror -R -x .git/ -x .gitignore -x AGENTS.md -x docs/ -x tools/ -x node_modules/ -x mixes/mixes-config.json -X package* -X eslint.*"
  [test-backup]="mirror -R -x .git/ -x .gitignore -x AGENTS.md -x docs/ -x tools/ -x node_modules/ -x mixes/mixes-config.json -X package* -X eslint.*"
)

# Export for use in other scripts
export SERVERS
export REMOTE_DIRS
export MIRROR_COMMANDS
