#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT/runtime"
rm -rf "$RUNTIME_DIR"
mkdir -p "$RUNTIME_DIR/nft" "$RUNTIME_DIR/root"
printf 'netfilter-uaf-live reset at %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RUNTIME_DIR/nft/ruleset.log"
echo "reset runtime under $RUNTIME_DIR"
