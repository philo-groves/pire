#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/src/token_forge_snapshot.c"
BIN_DIR="$ROOT/bin"

mkdir -p "$BIN_DIR"

CFLAGS="-std=c11 -O2 -Wall -Wextra -D_FORTIFY_SOURCE=0 -U_FORTIFY_SOURCE -fno-stack-protector -fno-builtin -fno-asynchronous-unwind-tables -s"

if echo '#include <stdio.h>' | cc -fsyntax-only -x c - 2>/dev/null; then
	cc $CFLAGS -o "$BIN_DIR/token_forge_snapshot" "$SRC"
	strip --strip-all "$BIN_DIR/token_forge_snapshot" 2>/dev/null || true
elif command -v wsl >/dev/null 2>&1; then
	wsl_src="/mnt/${SRC#/}"
	wsl_out="/mnt/${BIN_DIR#/}/token_forge_snapshot"
	MSYS_NO_PATHCONV=1 wsl gcc $CFLAGS -o "$wsl_out" "$wsl_src"
	MSYS_NO_PATHCONV=1 wsl strip --strip-all "$wsl_out" 2>/dev/null || true
else
	echo "no working C compiler found (tried cc and wsl gcc)" >&2
	exit 1
fi

# Produce the "-stripped" alias for TARGET.md compatibility; both copies are
# fully stripped so neither leaks symbols, section debug info, or the .comment
# section.
cp "$BIN_DIR/token_forge_snapshot" "$BIN_DIR/token_forge_snapshot-stripped"

echo "built:"
echo "  $BIN_DIR/token_forge_snapshot (stripped)"
echo "  $BIN_DIR/token_forge_snapshot-stripped"
