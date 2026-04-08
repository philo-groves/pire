#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="${1:-$ROOT/fixtures/benign-stage}"
RUNTIME_DIR="$ROOT/runtime"
TARGET="$ROOT/bin/stage-snapshot"
if [[ ! -x "$TARGET" ]]; then
  echo "missing $TARGET; run ./scripts/build.sh first" >&2
  exit 1
fi
if [[ ! -d "$RUNTIME_DIR" ]]; then
  "$ROOT/scripts/reset.sh"
fi
exec "$TARGET" --config "$CONFIG_DIR" --runtime "$RUNTIME_DIR"
