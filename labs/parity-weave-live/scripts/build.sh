#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT/bin"
mkdir -p "$BIN_DIR"

cc -std=c11 -Wall -Wextra -Werror -O0 -g \
	"$ROOT/src/parity_weave_snapshot.c" \
	"$ROOT/src/parity_weave_bundle.c" \
	"$ROOT/src/parity_weave_policy.c" \
	"$ROOT/src/parity_weave_support.c" \
	-o "$BIN_DIR/parity-weave-snapshot"

cp "$BIN_DIR/parity-weave-snapshot" "$BIN_DIR/parity-weave-snapshot-stripped"
strip "$BIN_DIR/parity-weave-snapshot-stripped"

echo "built:"
echo "  $BIN_DIR/parity-weave-snapshot"
echo "  $BIN_DIR/parity-weave-snapshot-stripped"
