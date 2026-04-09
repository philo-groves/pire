#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT/bin"

mkdir -p "$BIN_DIR"

cc -std=c11 -O0 -g -Wall -Wextra -D_FORTIFY_SOURCE=0 -U_FORTIFY_SOURCE -fno-stack-protector -fno-builtin \
  -o "$BIN_DIR/module-graph-snapshot" \
  "$ROOT/src/module_graph_snapshot.c" \
  "$ROOT/src/module_graph_bundle.c" \
  "$ROOT/src/module_graph_policy.c" \
  "$ROOT/src/module_graph_support.c"
cp "$BIN_DIR/module-graph-snapshot" "$BIN_DIR/module-graph-snapshot-stripped"
strip "$BIN_DIR/module-graph-snapshot-stripped" 2>/dev/null || true

echo "built:"
echo "  $BIN_DIR/module-graph-snapshot"
echo "  $BIN_DIR/module-graph-snapshot-stripped"
