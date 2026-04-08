#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMANDS_DIR="${1:-$ROOT/fixtures/benign-commands}"
RUNTIME_DIR="$ROOT/runtime"
TARGET="$ROOT/bin/dispatch-snapshot"
if [[ ! -x "$TARGET" ]]; then
  echo "missing $TARGET; run ./scripts/build.sh first" >&2
  exit 1
fi
if [[ ! -d "$RUNTIME_DIR" ]]; then
  "$ROOT/scripts/reset.sh"
fi
exec "$TARGET" --commands "$COMMANDS_DIR" --runtime "$RUNTIME_DIR"
