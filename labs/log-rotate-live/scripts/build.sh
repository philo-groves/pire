#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/bin"
cc -std=c11 -O0 -g -Wall -Wextra -D_FORTIFY_SOURCE=0 -U_FORTIFY_SOURCE -fno-stack-protector -fno-builtin -o "$ROOT/bin/rotate-snapshot" "$ROOT/src/rotate_snapshot.c"
cp "$ROOT/bin/rotate-snapshot" "$ROOT/bin/rotate-snapshot-stripped"
strip "$ROOT/bin/rotate-snapshot-stripped" 2>/dev/null || true
