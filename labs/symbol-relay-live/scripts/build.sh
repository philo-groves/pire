#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT/bin"

mkdir -p "$BIN_DIR"

cc -std=c11 -O0 -g -Wall -Wextra -D_FORTIFY_SOURCE=0 -U_FORTIFY_SOURCE -fno-stack-protector -fno-builtin \
  -o "$BIN_DIR/symbol-relay-snapshot" \
  "$ROOT/src/symbol_relay_snapshot.c" \
  "$ROOT/src/symbol_relay_bundle.c" \
  "$ROOT/src/symbol_relay_policy.c" \
  "$ROOT/src/symbol_relay_support.c"
cp "$BIN_DIR/symbol-relay-snapshot" "$BIN_DIR/symbol-relay-snapshot-stripped"
strip "$BIN_DIR/symbol-relay-snapshot-stripped" 2>/dev/null || true

echo "built:"
echo "  $BIN_DIR/symbol-relay-snapshot"
echo "  $BIN_DIR/symbol-relay-snapshot-stripped"
