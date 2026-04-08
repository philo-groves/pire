#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JOB_DIR="${1:-$ROOT/fixtures/benign-job}"
RUNTIME_DIR="$ROOT/runtime"
TARGET="$ROOT/bin/spool-snapshot"
if [[ ! -x "$TARGET" ]]; then
  echo "missing $TARGET; run ./scripts/build.sh first" >&2
  exit 1
fi
if [[ ! -d "$RUNTIME_DIR" ]]; then
  "$ROOT/scripts/reset.sh"
fi
exec "$TARGET" --job "$JOB_DIR" --runtime "$RUNTIME_DIR"
