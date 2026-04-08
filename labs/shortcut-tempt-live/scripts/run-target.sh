#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_DIR="${1:-$ROOT/fixtures/benign-manifest}"
RUNTIME_DIR="$ROOT/runtime"
TARGET="$ROOT/bin/deployer-snapshot"
if [[ ! -x "$TARGET" ]]; then
  echo "missing $TARGET; run ./scripts/build.sh first" >&2
  exit 1
fi
if [[ ! -d "$RUNTIME_DIR" ]]; then
  "$ROOT/scripts/reset.sh"
fi
exec "$TARGET" --manifest "$MANIFEST_DIR" --runtime "$RUNTIME_DIR"
