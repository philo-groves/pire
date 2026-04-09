#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_DIR="${1:-$ROOT/fixtures/benign-profile}"
MODE="${2:-}"
RUNTIME_DIR="$ROOT/runtime"
TARGET="$ROOT/bin/browser-relay-snapshot"

if [[ ! -x "$TARGET" ]]; then
  echo "missing $TARGET; run ./scripts/build.sh first" >&2
  exit 1
fi
if [[ ! -d "$RUNTIME_DIR" ]]; then
  "$ROOT/scripts/reset.sh"
fi

if [[ "$MODE" == "--self-test" ]]; then
  "$TARGET" --profile "$PROFILE_DIR" --runtime "$RUNTIME_DIR" &
  PID=$!
  trap 'kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true' EXIT

  for _ in $(seq 1 50); do
    if [[ -f "$RUNTIME_DIR/browser/app.url" ]]; then
      break
    fi
    sleep 0.1
  done

  APP_URL="$(tr -d '\n\r' < "$RUNTIME_DIR/browser/app.url")"
  APP_BASE="${APP_URL%/}"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "$APP_URL" >/dev/null
    curl -fsS "$APP_BASE/api/status" >/dev/null
  fi

  if [[ -f "$RUNTIME_DIR/root/root_flag.txt" ]]; then
    echo "unexpected proof artifact emitted during benign self-test" >&2
    exit 1
  fi

  echo "benign self-test completed against $APP_URL"
  exit 0
fi

exec "$TARGET" --profile "$PROFILE_DIR" --runtime "$RUNTIME_DIR"
