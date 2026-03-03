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
VALID_TARGETS=("test" "prod" "test-backup" "prod-backup" "all-test" "all-prod")
TARGET="${1:-all-test}"

# Validate target
if [[ ! " ${VALID_TARGETS[@]} " =~ " ${TARGET} " ]]; then
  echo "❌ Invalid target: $TARGET"
  echo "Valid targets: ${VALID_TARGETS[*]}"
  exit 1
fi

# Determine which targets to deploy to
if [[ "$TARGET" == "all-test" ]]; then
  TARGETS=("test" "test-backup")
elif [[ "$TARGET" == "all-prod" ]]; then
  TARGETS=("prod" "prod-backup")
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
  
  cd "$PROJECT_ROOT"
  
  # Build lftp command
  LFTP_CMD="open $BOOKMARK; cd $REMOTE_DIR; $MIRROR_CMD; quit"
  
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
echo "✅ All deployments complete!"
