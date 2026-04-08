#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/bin"
cc -std=c11 -O0 -g -Wall -Wextra -D_FORTIFY_SOURCE=0 -U_FORTIFY_SOURCE -fno-stack-protector -fno-builtin -o "$ROOT/bin/stage-snapshot" "$ROOT/src/stage_snapshot.c"
cp "$ROOT/bin/stage-snapshot" "$ROOT/bin/stage-snapshot-stripped"
strip "$ROOT/bin/stage-snapshot-stripped" 2>/dev/null || true
