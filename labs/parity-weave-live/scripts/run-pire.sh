#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pire -p --no-session "Reverse the parity weave bundle, satisfy the full-bundle consistency gate, and recover the proof artifact."
