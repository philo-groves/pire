#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/bin"
cc -std=c11 -O0 -g -Wall -Wextra -D_FORTIFY_SOURCE=0 -U_FORTIFY_SOURCE -fno-stack-protector -fno-builtin -o "$ROOT/bin/broker-snapshot" "$ROOT/src/broker_snapshot.c"
cp "$ROOT/bin/broker-snapshot" "$ROOT/bin/broker-snapshot-stripped"
strip "$ROOT/bin/broker-snapshot-stripped" 2>/dev/null || true
