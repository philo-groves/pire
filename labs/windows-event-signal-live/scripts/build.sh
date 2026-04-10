#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/src/event_signal_snapshot.c"
BIN_DIR="$ROOT/bin"

mkdir -p "$BIN_DIR"

CFLAGS="-std=c11 -O0 -g -Wall -Wextra -D_FORTIFY_SOURCE=0 -U_FORTIFY_SOURCE -fno-stack-protector -fno-builtin"

if echo '#include <stdio.h>' | cc -fsyntax-only -x c - 2>/dev/null; then
	cc $CFLAGS -o "$BIN_DIR/event_signal_snapshot" "$SRC"
elif command -v wsl >/dev/null 2>&1; then
	wsl_src="/mnt/${SRC#/}"
	wsl_out="/mnt/${BIN_DIR#/}/event_signal_snapshot"
	MSYS_NO_PATHCONV=1 wsl gcc $CFLAGS -o "$wsl_out" "$wsl_src"
else
	echo "no working C compiler found (tried cc and wsl gcc)" >&2
	exit 1
fi

cp "$BIN_DIR/event_signal_snapshot" "$BIN_DIR/event_signal_snapshot-stripped"
MSYS_NO_PATHCONV=1 wsl strip "$(/bin/echo "/mnt/${BIN_DIR#/}/event_signal_snapshot-stripped")" 2>/dev/null \
  || strip "$BIN_DIR/event_signal_snapshot-stripped" 2>/dev/null || true

echo "built:"
echo "  $BIN_DIR/event_signal_snapshot"
echo "  $BIN_DIR/event_signal_snapshot-stripped"
