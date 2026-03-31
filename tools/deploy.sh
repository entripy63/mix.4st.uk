#!/bin/bash
# Deployment script for mix.4st.uk
# Usage: ./tools/deploy.sh [target]
# Targets: test, prod, test-backup, prod-backup, all-test, all-prod

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG="$SCRIPT_DIR/deploy-config.sh"

source "$CONFIG"

if [ ! -f "$CONFIG" ]; then
  echo "❌ Config file not found: $CONFIG"
  exit 1
fi

# Valid targets
VALID_TARGETS=("test" "prod" "home-test" "all-test" "all-prod")
TARGET="${1:-all-test}"

# Validate target
if [[ ! " ${VALID_TARGETS[@]} " =~ " ${TARGET} " ]]; then
  echo "❌ Invalid target: $TARGET"
  echo "Valid targets: ${VALID_TARGETS[*]}"
  exit 1
fi

# Determine which targets to deploy to
if [[ "$TARGET" == "all-test" ]]; then
  TARGETS=("test" "home-test")
elif [[ "$TARGET" == "all-prod" ]]; then
  TARGETS=("prod")
else
  TARGETS=("$TARGET")
fi

# Deploy to each target
for t in "${TARGETS[@]}"; do
  echo ""
  echo "🚀 Deploying to $t..."
  
  BOOKMARK="${SERVERS[$t]}"
  REMOTE_DIR="${REMOTE_DIRS[$t]}"
  MIRROR_CMD="${MIRROR_COMMANDS[$t]}"
  
  if [ -z "$BOOKMARK" ]; then
    echo "❌ No bookmark configured for $t"
    exit 1
  fi
  
  if [ "$REMOTE_DIR" = "/" ]; then
    echo "❌ Refusing to deploy to / — check REMOTE_DIRS for $t"
    exit 1
  fi
  
  cd "$PROJECT_ROOT"
  
  # Build lftp command (skip cd if no remote dir specified)
  if [ -n "$REMOTE_DIR" ]; then
    LFTP_CMD="open $BOOKMARK; cd $REMOTE_DIR; $MIRROR_CMD; quit"
  else
    LFTP_CMD="open $BOOKMARK; $MIRROR_CMD; quit"
  fi
  
  echo "📡 Command: lftp -e \"$LFTP_CMD\""
  lftp -e "$LFTP_CMD"
  
  if [ $? -eq 0 ]; then
    echo "✅ Deploy to $t successful"
  else
    echo "❌ Deploy to $t failed"
    exit 1
  fi
done

echo ""
echo "✅ All deployments complete! ($(date '+%Y-%m-%d %H:%M:%S'))"
