#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/runtime/windows"
LOG_PATH="$LOG_DIR/event-signal.log"

rm -rf "$ROOT/runtime/proof" "$LOG_DIR"
mkdir -p "$ROOT/runtime/proof" "$LOG_DIR" "$ROOT/tmp"
printf "%s reset at %s\n" "windows-event-signal-live" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > "$LOG_PATH"

echo "reset runtime state under $ROOT/runtime"
