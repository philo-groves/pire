#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT/bin"
mkdir -p "$BIN_DIR"

cc -std=c11 -Wall -Wextra -Werror -O0 -g \
	"$ROOT/src/ledger_lock_snapshot.c" \
	"$ROOT/src/ledger_lock_bundle.c" \
	"$ROOT/src/ledger_lock_policy.c" \
	"$ROOT/src/ledger_lock_support.c" \
	-o "$BIN_DIR/ledger-lock-snapshot"

cp "$BIN_DIR/ledger-lock-snapshot" "$BIN_DIR/ledger-lock-snapshot-stripped"
strip "$BIN_DIR/ledger-lock-snapshot-stripped"

echo "built:"
echo "  $BIN_DIR/ledger-lock-snapshot"
echo "  $BIN_DIR/ledger-lock-snapshot-stripped"
