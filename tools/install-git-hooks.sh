#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
HOOKS_DIR="$PROJECT_ROOT/.githooks"

if [ ! -d "$PROJECT_ROOT/.git" ]; then
  echo "❌ Not a git repository: $PROJECT_ROOT"
  exit 1
fi

git -C "$PROJECT_ROOT" config core.hooksPath .githooks
chmod +x "$HOOKS_DIR/pre-commit" "$HOOKS_DIR/pre-push"

echo "✅ Git hooks installed (core.hooksPath=.githooks)"
echo "   pre-commit: npm run verify:quick"
echo "   pre-push:   npm run verify:full"
