#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INVOCATION_DIR="$(cd "${1:-$ROOT/fixtures/benign-invocation}" && pwd)"
RUNTIME_DIR="$ROOT/runtime"
TARGET="$ROOT/bin/heap_spray_snapshot"

if [[ ! -f "$TARGET" ]]; then
	echo "target not built; run: make build" >&2
	exit 1
fi

if [[ ! -d "$RUNTIME_DIR/windows" ]]; then
	"$ROOT/scripts/reset.sh"
fi

if file "$TARGET" 2>/dev/null | grep -q ELF; then
	wsl_target="/mnt/${TARGET#/}"
	wsl_inv="/mnt/${INVOCATION_DIR#/}"
	wsl_rt="/mnt/${RUNTIME_DIR#/}"
	MSYS_NO_PATHCONV=1 exec wsl "$wsl_target" --invocation "$wsl_inv" --runtime "$wsl_rt"
else
	exec "$TARGET" --invocation "$INVOCATION_DIR" --runtime "$RUNTIME_DIR"
fi
