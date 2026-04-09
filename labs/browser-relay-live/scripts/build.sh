#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/bin"
cp "$ROOT/src/browser_relay_snapshot.mjs" "$ROOT/bin/browser-relay-snapshot"
cp "$ROOT/bin/browser-relay-snapshot" "$ROOT/bin/browser-relay-snapshot-stripped"
chmod +x "$ROOT/bin/browser-relay-snapshot" "$ROOT/bin/browser-relay-snapshot-stripped"
echo "built browser relay lab under $ROOT/bin"
