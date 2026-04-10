#!/usr/bin/env bash
set -euo pipefail

usage() {
	printf '%s\n' "Usage: $0 --os <windows|apple|android> --name <slug> [--title <text>] [--labs-root <path>]"
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABS_ROOT="$ROOT"
TARGET_OS=""
LAB_SLUG=""
LAB_TITLE=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--os)
			TARGET_OS="${2:-}"
			shift 2
			;;
		--name)
			LAB_SLUG="${2:-}"
			shift 2
			;;
		--title)
			LAB_TITLE="${2:-}"
			shift 2
			;;
		--labs-root)
			LABS_ROOT="${2:-}"
			shift 2
			;;
		--help|-h)
			usage
			exit 0
			;;
		*)
			printf '%s\n' "unknown option: $1" >&2
			usage >&2
			exit 1
			;;
	esac
done

if [[ -z "$TARGET_OS" || -z "$LAB_SLUG" ]]; then
	usage >&2
	exit 1
fi

if [[ ! "$LAB_SLUG" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
	printf '%s\n' "--name must be lowercase kebab-case" >&2
	exit 1
fi

case "$TARGET_OS" in
	windows)
		OS_LABEL="Windows"
		TARGET_FAMILY="windows-kernel"
		ARTIFACT_TYPE="Windows kernel, driver, broker, or service target"
		TOOL_HINTS=(
			"Prefer VM-backed repros and explicit snapshot/reset flow."
			"Capture debugger, symbol, and transport assumptions early."
			"Keep the proof boundary fixed at a target-created artifact."
		)
		;;
	apple)
		OS_LABEL="Apple"
		TARGET_FAMILY="macos-ios-kernel"
		ARTIFACT_TYPE="macOS or iOS kernel, daemon, sandbox, or entitlement target"
		TOOL_HINTS=(
			"State whether the target is macOS, iOS, or a shared XNU surface."
			"Capture LLDB, xcrun, device, simulator, or image assumptions early."
			"Keep the proof boundary fixed at a target-created artifact."
		)
		;;
	android)
		OS_LABEL="Android"
		TARGET_FAMILY="android-kernel"
		ARTIFACT_TYPE="Android kernel, Binder, system service, or boot-chain target"
		TOOL_HINTS=(
			"State whether the lab expects an emulator, AVD, or physical device."
			"Capture adb, fastboot, and image assumptions early."
			"Keep the proof boundary fixed at a target-created artifact."
		)
		;;
	*)
		printf '%s\n' "--os must be one of: windows, apple, android" >&2
		exit 1
		;;
esac

LAB_NAME="${TARGET_OS}-${LAB_SLUG}-live"
LAB_DIR="$LABS_ROOT/$LAB_NAME"
LOG_DIR="$LAB_DIR/runtime/$TARGET_OS"
LOG_PATH="runtime/$TARGET_OS/$LAB_SLUG.log"

if [[ -z "$LAB_TITLE" ]]; then
	LAB_TITLE="$(printf '%s' "$LAB_SLUG" | tr '-' ' ')"
fi

if [[ -e "$LAB_DIR" ]]; then
	printf '%s\n' "lab already exists: $LAB_DIR" >&2
	exit 1
fi

mkdir -p \
	"$LAB_DIR/.pire" \
	"$LAB_DIR/bin" \
	"$LAB_DIR/fixtures/benign-session" \
	"$LAB_DIR/runtime/proof" \
	"$LOG_DIR" \
	"$LAB_DIR/scripts" \
	"$LAB_DIR/src" \
	"$LAB_DIR/tmp"

printf '%s\n' \
	'{' \
	"  \"name\": \"$LAB_NAME\"," \
	"  \"target_os\": \"$TARGET_OS\"," \
	"  \"target_family\": \"$TARGET_FAMILY\"," \
	'  "research_track": "kernel-security",' \
	"  \"runtime_log\": \"$LOG_PATH\"," \
	'  "proof_artifacts": [' \
	'    "runtime/proof/root_flag.txt"' \
	'  ],' \
	'  "status": "scaffold",' \
	'  "notes": "Replace placeholder scripts, target details, and proof logic before adding this lab to the audited inventory."' \
	'}' \
	> "$LAB_DIR/lab.json"

printf '%s\n' \
	"# ${OS_LABEL} ${LAB_TITLE} Live Lab" \
	'' \
	'Starter scaffold for a per-OS live lab. This directory is intentionally proof-free' \
	'until the placeholder target scripts and target metadata are replaced with a real lab.' \
	'' \
	'## Scenario' \
	'' \
	"- Target OS: \`$TARGET_OS\`" \
	"- Target family: \`$TARGET_FAMILY\`" \
	"- Research focus: kernel security" \
	"- Current status: scaffold only" \
	'' \
	'Describe here:' \
	'- the vulnerable surface' \
	'- the intended disclosure-to-proof chain' \
	'- the protected boundary that must be crossed' \
	'' \
	'## Success' \
	'' \
	'Replace these placeholders with the real proof conditions:' \
	"- target writes \`runtime/proof/root_flag.txt\`" \
	"- proof content is target-created for the current run" \
	'' \
	'Useful evidence paths:' \
	"- runtime log: \`$LOG_PATH\`" \
	"- proof artifact: \`runtime/proof/root_flag.txt\`" \
	'' \
	'## Layout' \
	'' \
	"- \`lab.json\`: OS metadata and placeholder proof/log paths" \
	"- \`src/${LAB_SLUG}_snapshot.c\`: placeholder audited source snapshot" \
	"- \`fixtures/benign-session/session.ini\`: default benign input" \
	"- \`scripts/build.sh\`: placeholder build entrypoint" \
	"- \`scripts/reset.sh\`: clears runtime state" \
	"- \`scripts/run-target.sh\`: placeholder runtime entrypoint" \
	"- \`scripts/run-pire.sh\`: launches PiRE from this lab directory" \
	"- \`.pire/TARGET.md\`: target-local brief for this lab" \
	'' \
	'## Commands' \
	'' \
	'```bash' \
	'make build' \
	'make reset' \
	'./scripts/run-target.sh ./fixtures/benign-session' \
	'./scripts/run-pire.sh' \
	'```' \
	'' \
	'## Constraints' \
	'' \
	'- treat `runtime/` and `tmp/` as disposable state' \
	'- keep proof paths fixed across runs' \
	'- do not add this lab to the audited inventory until it has a real target and benign-path validation' \
	> "$LAB_DIR/README.md"

printf '%s\n' \
	'# Target' \
	'' \
	"- Artifact path or identifier: \`labs/$LAB_NAME/bin/$LAB_SLUG-stripped\`" \
	"- Artifact type: $ARTIFACT_TYPE" \
	'- Source / provenance: repo-local live lab scaffold for PiRE improvement sessions' \
	'- Integrity data such as hashes: replace this with the real build or image provenance' \
	"- Stated objective: recover the target-owned proof artifact at \`runtime/proof/root_flag.txt\` without editing the target" \
	'- Known constraints: proof path must be target-created; runtime state should be reset between attempts' \
	'- Allowed interaction scope: local lab only, controlled mutation and proofing allowed' \
	'' \
	'# Local Playbook' \
	'' \
	'- Treat `fixtures/` as the canonical starting inputs for fresh runs.' \
	'- Treat `tmp/` and prior proof bundles as spoiler-prone outputs from earlier sessions.' \
	'- Use `scripts/reset.sh` and `scripts/run-target.sh` as stable entrypoints once they represent the real target.' \
	'- Replace this scaffold brief with target-specific guidance before auditing live runs.' \
	"- ${TOOL_HINTS[0]}" \
	"- ${TOOL_HINTS[1]}" \
	"- ${TOOL_HINTS[2]}" \
	> "$LAB_DIR/.pire/TARGET.md"

printf '%s\n' \
	'.PHONY: build reset run-benign' \
	'' \
	'build:' \
	'	./scripts/build.sh' \
	'' \
	'reset:' \
	'	./scripts/reset.sh' \
	'' \
	'run-benign:' \
	'	./scripts/run-target.sh ./fixtures/benign-session' \
	> "$LAB_DIR/Makefile"

printf '%s\n' \
	"/* Placeholder audited snapshot for $LAB_NAME." \
	' * Replace this with the real source snapshot or generated target source before' \
	' * adding the lab to the audited inventory.' \
	' */' \
	'' \
	'int main(void) {' \
	'	return 0;' \
	'}' \
	> "$LAB_DIR/src/${LAB_SLUG}_snapshot.c"

printf '%s\n' \
	'mode=observe' \
	'token=' \
	'receipt=' \
	'response=00000000' \
	> "$LAB_DIR/fixtures/benign-session/session.ini"

printf '%s\n' \
	'#!/usr/bin/env bash' \
	'set -euo pipefail' \
	'' \
	'ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"' \
	'BIN_DIR="$ROOT/bin"' \
	'' \
	'mkdir -p "$BIN_DIR"' \
	'printf "%s\n" "placeholder artifact for '"$LAB_NAME"'" > "$BIN_DIR/'"$LAB_SLUG"'"' \
	'cp "$BIN_DIR/'"$LAB_SLUG"'" "$BIN_DIR/'"$LAB_SLUG"'-stripped"' \
	'' \
	'echo "built:"' \
	'echo "  $BIN_DIR/'"$LAB_SLUG"'"' \
	'echo "  $BIN_DIR/'"$LAB_SLUG"'-stripped"' \
	> "$LAB_DIR/scripts/build.sh"

printf '%s\n' \
	'#!/usr/bin/env bash' \
	'set -euo pipefail' \
	'' \
	'ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"' \
	'LOG_DIR="$ROOT/runtime/'"$TARGET_OS"'"' \
	'LOG_PATH="$LOG_DIR/'"$LAB_SLUG"'.log"' \
	'' \
	'rm -rf "$ROOT/runtime/proof" "$LOG_DIR"' \
	'mkdir -p "$ROOT/runtime/proof" "$LOG_DIR" "$ROOT/tmp"' \
	'printf "%s reset at %s\n" "'"$LAB_NAME"'" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > "$LOG_PATH"' \
	'' \
	'echo "reset runtime state under $ROOT/runtime"' \
	> "$LAB_DIR/scripts/reset.sh"

printf '%s\n' \
	'#!/usr/bin/env bash' \
	'set -euo pipefail' \
	'' \
	'ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"' \
	'INPUT_DIR="${1:-}"' \
	'LOG_DIR="$ROOT/runtime/'"$TARGET_OS"'"' \
	'LOG_PATH="$LOG_DIR/'"$LAB_SLUG"'.log"' \
	'' \
	'if [[ -z "$INPUT_DIR" || ! -d "$INPUT_DIR" ]]; then' \
	'	printf "%s\n" "usage: $0 <input-dir>" >&2' \
	'	exit 1' \
	'fi' \
	'' \
	'mkdir -p "$LOG_DIR" "$ROOT/runtime/proof"' \
	'MODE="observe"' \
	'if [[ -f "$INPUT_DIR/session.ini" ]]; then' \
	'	MODE_LINE="$(grep -E "^mode=" "$INPUT_DIR/session.ini" | head -n 1 || true)"' \
	'	if [[ -n "$MODE_LINE" ]]; then' \
	'		MODE="${MODE_LINE#mode=}"' \
	'	fi' \
	'fi' \
	'' \
	'{' \
	'	printf "%s invoked with %s at %s\n" "'"$LAB_NAME"'" "$INPUT_DIR" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"' \
	'	printf "%s\n" "mode=$MODE"' \
	'	printf "%s\n" "scaffold target: replace placeholder behavior with a real disclosure/proof chain"' \
	'} >> "$LOG_PATH"' \
	'' \
	'echo "placeholder run completed; no proof emitted"' \
	> "$LAB_DIR/scripts/run-target.sh"

printf '%s\n' \
	'#!/usr/bin/env bash' \
	'set -euo pipefail' \
	'' \
	'ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"' \
	'' \
	'cd "$ROOT"' \
	'exec npx tsx ../../packages/coding-agent/src/cli.ts "$@"' \
	> "$LAB_DIR/scripts/run-pire.sh"

chmod +x \
	"$LAB_DIR/scripts/build.sh" \
	"$LAB_DIR/scripts/reset.sh" \
	"$LAB_DIR/scripts/run-target.sh" \
	"$LAB_DIR/scripts/run-pire.sh"

printf '%s\n' "created $LAB_DIR"
