#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT/bin"
SRC="$ROOT/src/license_fsm_snapshot.c"

mkdir -p "$BIN_DIR"

cc -std=c11 -O0 -g -Wall -Wextra -D_FORTIFY_SOURCE=0 -U_FORTIFY_SOURCE -fno-stack-protector -fno-builtin -o "$BIN_DIR/license-fsm-snapshot" "$SRC"
cp "$BIN_DIR/license-fsm-snapshot" "$BIN_DIR/license-fsm-snapshot-stripped"
strip "$BIN_DIR/license-fsm-snapshot-stripped" 2>/dev/null || true

echo "built:"
echo "  $BIN_DIR/license-fsm-snapshot"
echo "  $BIN_DIR/license-fsm-snapshot-stripped"
