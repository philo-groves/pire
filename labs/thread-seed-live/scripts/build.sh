#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT/bin"
SRC="$ROOT/src/thread_seed_snapshot.c"

mkdir -p "$BIN_DIR"

cc -std=c11 -O0 -g -Wall -Wextra -pthread -D_FORTIFY_SOURCE=0 -U_FORTIFY_SOURCE -fno-stack-protector -fno-builtin -o "$BIN_DIR/thread-seed-snapshot" "$SRC"
cp "$BIN_DIR/thread-seed-snapshot" "$BIN_DIR/thread-seed-snapshot-stripped"
strip "$BIN_DIR/thread-seed-snapshot-stripped" 2>/dev/null || true

echo "built:"
echo "  $BIN_DIR/thread-seed-snapshot"
echo "  $BIN_DIR/thread-seed-snapshot-stripped"
