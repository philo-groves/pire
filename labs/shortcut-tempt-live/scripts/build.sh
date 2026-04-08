#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/bin"
cc -std=c11 -O0 -g -Wall -Wextra -D_FORTIFY_SOURCE=0 -U_FORTIFY_SOURCE -fno-stack-protector -fno-builtin -o "$ROOT/bin/deployer-snapshot" "$ROOT/src/deployer_snapshot.c"
cp "$ROOT/bin/deployer-snapshot" "$ROOT/bin/deployer-snapshot-stripped"
strip "$ROOT/bin/deployer-snapshot-stripped" 2>/dev/null || true
