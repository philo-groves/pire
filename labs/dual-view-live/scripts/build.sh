#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT/bin"

mkdir -p "$BIN_DIR"

cc -std=c11 -O0 -g -Wall -Wextra -D_FORTIFY_SOURCE=0 -U_FORTIFY_SOURCE -fno-stack-protector -fno-builtin \
  -o "$BIN_DIR/dual-view-snapshot" \
  "$ROOT/src/dual_view_snapshot.c" \
  "$ROOT/src/dual_view_bundle.c" \
  "$ROOT/src/dual_view_policy.c" \
  "$ROOT/src/dual_view_support.c"
cp "$BIN_DIR/dual-view-snapshot" "$BIN_DIR/dual-view-snapshot-stripped"
strip "$BIN_DIR/dual-view-snapshot-stripped" 2>/dev/null || true

echo "built:"
echo "  $BIN_DIR/dual-view-snapshot"
echo "  $BIN_DIR/dual-view-snapshot-stripped"
