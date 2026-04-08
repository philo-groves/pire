#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT/runtime"
rm -rf "$RUNTIME_DIR"
mkdir -p "$RUNTIME_DIR/session"
mkdir -p "$RUNTIME_DIR/root"
printf 'setuid-tmp-live reset at %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RUNTIME_DIR/session/session.log"
echo "reset runtime under $RUNTIME_DIR"
