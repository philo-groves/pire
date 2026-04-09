#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT/runtime"
PID_FILE="$RUNTIME_DIR/stack/stack.pid"

if [[ -f "$PID_FILE" ]]; then
  PID="$(tr -d '\n\r' < "$PID_FILE" || true)"
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    sleep 0.05
    kill -9 "$PID" 2>/dev/null || true
  fi
fi

rm -rf "$RUNTIME_DIR"
mkdir -p "$RUNTIME_DIR/stack" "$RUNTIME_DIR/root"

printf 'stack-seed-live reset at %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RUNTIME_DIR/stack/stack.log"

echo "reset runtime under $RUNTIME_DIR"
