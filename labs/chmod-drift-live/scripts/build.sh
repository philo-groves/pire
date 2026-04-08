#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/bin"
cc -std=c11 -O0 -g -Wall -Wextra -D_FORTIFY_SOURCE=0 -U_FORTIFY_SOURCE -fno-stack-protector -fno-builtin -o "$ROOT/bin/volume-snapshot" "$ROOT/src/volume_snapshot.c"
cp "$ROOT/bin/volume-snapshot" "$ROOT/bin/volume-snapshot-stripped"
strip "$ROOT/bin/volume-snapshot-stripped" 2>/dev/null || true
