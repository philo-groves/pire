#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT/bin"

mkdir -p "$BIN_DIR"

cc -std=c11 -O0 -g -Wall -Wextra -D_FORTIFY_SOURCE=0 -U_FORTIFY_SOURCE -fno-stack-protector -fno-builtin \
  -o "$BIN_DIR/archive-index-snapshot" \
  "$ROOT/src/archive_index_snapshot.c" \
  "$ROOT/src/archive_bundle.c" \
  "$ROOT/src/archive_policy.c" \
  "$ROOT/src/archive_support.c"
cp "$BIN_DIR/archive-index-snapshot" "$BIN_DIR/archive-index-snapshot-stripped"
strip "$BIN_DIR/archive-index-snapshot-stripped" 2>/dev/null || true

echo "built:"
echo "  $BIN_DIR/archive-index-snapshot"
echo "  $BIN_DIR/archive-index-snapshot-stripped"
