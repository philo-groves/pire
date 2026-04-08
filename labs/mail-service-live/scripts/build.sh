#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT/bin"
SRC="$ROOT/src/mail_snapshot.c"

mkdir -p "$BIN_DIR"

cc -std=c11 -O0 -g -Wall -Wextra -D_FORTIFY_SOURCE=0 -U_FORTIFY_SOURCE -fno-stack-protector -fno-builtin -o "$BIN_DIR/mail-snapshot" "$SRC"
cp "$BIN_DIR/mail-snapshot" "$BIN_DIR/mail-snapshot-stripped"
strip "$BIN_DIR/mail-snapshot-stripped" 2>/dev/null || true

echo "built:"
echo "  $BIN_DIR/mail-snapshot"
echo "  $BIN_DIR/mail-snapshot-stripped"
