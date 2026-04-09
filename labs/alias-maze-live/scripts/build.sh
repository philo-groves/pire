#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT/bin"

mkdir -p "$BIN_DIR"

cc -std=c11 -O0 -g -Wall -Wextra -D_FORTIFY_SOURCE=0 -U_FORTIFY_SOURCE -fno-stack-protector -fno-builtin \
  -o "$BIN_DIR/alias-maze-snapshot" \
  "$ROOT/src/alias_maze_snapshot.c" \
  "$ROOT/src/alias_maze_bundle.c" \
  "$ROOT/src/alias_maze_policy.c" \
  "$ROOT/src/alias_maze_support.c"
cp "$BIN_DIR/alias-maze-snapshot" "$BIN_DIR/alias-maze-snapshot-stripped"
strip "$BIN_DIR/alias-maze-snapshot-stripped" 2>/dev/null || true

echo "built:"
echo "  $BIN_DIR/alias-maze-snapshot"
echo "  $BIN_DIR/alias-maze-snapshot-stripped"
