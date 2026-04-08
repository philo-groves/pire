#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INVOCATION_DIR="${1:-$ROOT/fixtures/benign-invocation}"
RUNTIME_DIR="$ROOT/runtime"
TARGET="$ROOT/bin/sudoedit-snapshot"

if [[ ! -x "$TARGET" ]]; then
  echo "missing $TARGET; run ./scripts/build.sh first" >&2
  exit 1
fi

if [[ ! -d "$RUNTIME_DIR" ]]; then
  "$ROOT/scripts/reset.sh"
fi

exec "$TARGET" --invocation "$INVOCATION_DIR" --runtime "$RUNTIME_DIR"
