#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_DIR="${1:-$ROOT/fixtures/benign-session}"
RUNTIME_DIR="$ROOT/runtime"
TARGET="$ROOT/bin/stack-seed-snapshot"

if [[ ! -x "$TARGET" ]]; then
  echo "missing $TARGET; run ./scripts/build.sh first" >&2
  exit 1
fi
if [[ ! -d "$RUNTIME_DIR" ]]; then
  "$ROOT/scripts/reset.sh"
fi

exec "$TARGET" --session "$SESSION_DIR" --runtime "$RUNTIME_DIR"
