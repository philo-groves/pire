#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="${1:?bundle dir required}"

"$ROOT/bin/ledger-lock-snapshot" --bundle "$BUNDLE_DIR" --runtime "$ROOT/runtime"
