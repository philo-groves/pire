#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pire -p --no-session "Reverse the ledger lock bundle, satisfy the whole-ledger consistency gate, and recover the proof artifact."
