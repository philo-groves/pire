#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { getTaskRuntimeConfig } from "./runtime-config.js";
import type { TaskType } from "./types.js";

const execFileAsync = promisify(execFile);
const DOCKER_TIMEOUT = 180000;
const DEBUG_TIMEOUT_SECONDS = 90;
const DEBUG_BACKENDS = ["auto", "gdb", "lldb"] as const;

type DebugBackendPreference = (typeof DEBUG_BACKENDS)[number];
type DebugBackend = Exclude<DebugBackendPreference, "auto"> | "unknown";

interface CliArgs {
	taskType: TaskType;
	artifactPath: string;
	vulImage: string;
	commands: string[];
	backend: DebugBackendPreference;
	breakOnEntry: boolean;
}

interface DebugPayload {
	backend: DebugBackend;
	summary: string;
	stdout: string;
	stderr: string;
	exitCode?: number;
	timedOut?: boolean;
	metadata: Record<string, unknown>;
}

interface RunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

async function inspectImagePlatform(image: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("docker", [
			"image",
			"inspect",
			image,
			"--format",
			"{{.Os}}/{{.Architecture}}",
		]);
		const platform = stdout.trim();
		return platform.length > 0 ? platform : undefined;
	} catch {
		return undefined;
	}
}

function parseTaskType(value: string): TaskType {
	if (value === "arvo" || value === "oss-fuzz" || value === "oss-fuzz-latest") {
		return value;
	}
	throw new Error(`Invalid task type "${value}"`);
}

function parseBackend(value: string): DebugBackendPreference {
	if (DEBUG_BACKENDS.includes(value as DebugBackendPreference)) {
		return value as DebugBackendPreference;
	}
	throw new Error(`Invalid debug backend "${value}"`);
}

function parseBoolean(value: string): boolean {
	if (value === "true") {
		return true;
	}
	if (value === "false") {
		return false;
	}
	throw new Error(`Invalid boolean value "${value}"`);
}

function parseCommandsJson(value: string): string[] {
	const parsed = JSON.parse(value) as unknown;
	if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
		throw new Error("commands-json must decode to an array of strings");
	}
	return parsed;
}

function parseArgs(argv: string[]): CliArgs {
	let taskType: TaskType | undefined;
	let artifactPath: string | undefined;
	let vulImage: string | undefined;
	let commands: string[] | undefined;
	let backend: DebugBackendPreference = "auto";
	let breakOnEntry = false;

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--task-type" && index + 1 < argv.length) {
			taskType = parseTaskType(argv[++index]);
		} else if (arg === "--artifact-path" && index + 1 < argv.length) {
			artifactPath = resolve(argv[++index]);
		} else if (arg === "--vul-image" && index + 1 < argv.length) {
			vulImage = argv[++index];
		} else if (arg === "--commands-json" && index + 1 < argv.length) {
			commands = parseCommandsJson(argv[++index]);
		} else if (arg === "--backend" && index + 1 < argv.length) {
			backend = parseBackend(argv[++index]);
		} else if (arg === "--break-on-entry" && index + 1 < argv.length) {
			breakOnEntry = parseBoolean(argv[++index]);
		}
	}

	if (!taskType || !artifactPath || !vulImage || !commands) {
		throw new Error(
			"Usage: debug-cli --task-type <type> --vul-image <image> --artifact-path <path> --commands-json <json> [--backend <auto|gdb|lldb>] [--break-on-entry <true|false>]",
		);
	}

	return {
		taskType,
		artifactPath,
		vulImage,
		commands,
		backend,
		breakOnEntry,
	};
}

function buildGdbScript(commands: string[], breakOnEntry: boolean): string {
	const lines = [
		"set pagination off",
		"set confirm off",
		"set print pretty on",
	];
	if (breakOnEntry) {
		lines.push("break main", "run");
	}
	lines.push(...commands);
	return `${lines.join("\n")}\n`;
}

function buildLldbScript(commands: string[], breakOnEntry: boolean): string {
	const lines = [
		"settings set auto-confirm true",
	];
	if (breakOnEntry) {
		lines.push("breakpoint set --name main", "run");
	}
	lines.push(...commands, "quit");
	return `${lines.join("\n")}\n`;
}

function buildRunnerScript(): string {
	return `#!/bin/bash
set -euo pipefail

preferred_backend="\${1:-auto}"
target_binary="\${2:?missing target binary}"

install_gdb() {
\tif command -v gdb >/dev/null 2>&1; then
\t\treturn 0
\tfi
\tif command -v apt-get >/dev/null 2>&1; then
\t\texport DEBIAN_FRONTEND=noninteractive
\t\tapt-get update >/dev/null 2>&1
\t\tapt-get install -y gdb >/dev/null 2>&1
\t\treturn 0
\tfi
\tif command -v apk >/dev/null 2>&1; then
\t\tapk add --no-cache gdb >/dev/null 2>&1
\t\treturn 0
\tfi
\tif command -v dnf >/dev/null 2>&1; then
\t\tdnf install -y gdb >/dev/null 2>&1
\t\treturn 0
\tfi
\tif command -v yum >/dev/null 2>&1; then
\t\tyum install -y gdb >/dev/null 2>&1
\t\treturn 0
\tfi
\treturn 1
}

select_debugger() {
\tif [ "$preferred_backend" = "lldb" ] && command -v lldb >/dev/null 2>&1; then
\t\techo "lldb"
\t\treturn 0
\tfi
\tif [ "$preferred_backend" = "gdb" ] && command -v gdb >/dev/null 2>&1; then
\t\techo "gdb"
\t\treturn 0
\tfi
\tif [ "$preferred_backend" = "auto" ]; then
\t\tif command -v gdb >/dev/null 2>&1; then
\t\t\techo "gdb"
\t\t\treturn 0
\t\tfi
\t\tif command -v lldb >/dev/null 2>&1; then
\t\t\techo "lldb"
\t\t\treturn 0
\t\tfi
\tfi
\tif install_gdb && command -v gdb >/dev/null 2>&1; then
\t\techo "gdb"
\t\treturn 0
\tfi
\tif [ "$preferred_backend" = "lldb" ] && command -v lldb >/dev/null 2>&1; then
\t\techo "lldb"
\t\treturn 0
\tfi
\treturn 1
}

resolve_debug_target() {
\tlocal candidate="$1"
\tif file "$candidate" | grep -qi "shell script"; then
\t\twhile IFS= read -r token; do
\t\t\tif [ "$token" = "$candidate" ]; then
\t\t\t\tcontinue
\t\t\tfi
\t\t\tcase "$token" in
\t\t\t\t/bin/bash|/usr/bin/bash|/bin/sh|/usr/bin/sh|/usr/bin/env|/usr/bin/timeout|/bin/timeout)
\t\t\t\t\tcontinue
\t\t\t\t\t;;
\t\t\tesac
\t\t\tif [ -x "$token" ] && [ ! -d "$token" ]; then
\t\t\t\techo "$token"
\t\t\t\treturn 0
\t\t\tfi
\t\tdone < <(grep -Eo '/[^[:space:]"'\\''()]+' "$candidate")
\tfi
\techo "$candidate"
}

debugger="$(select_debugger || true)"
if [ -z "$debugger" ]; then
\techo "PIRE_DEBUG_BACKEND=unknown"
\techo "No supported debugger is available inside the benchmark container" >&2
\texit 127
fi

debug_target="$(resolve_debug_target "$target_binary")"
echo "PIRE_DEBUG_BACKEND=$debugger"
if [ "$debugger" = "gdb" ]; then
\texec timeout -s SIGKILL ${DEBUG_TIMEOUT_SECONDS} gdb --batch -q -x /pire-debug/debug.gdb --args "$debug_target"
fi

exec timeout -s SIGKILL ${DEBUG_TIMEOUT_SECONDS} lldb --batch -Q -s /pire-debug/debug.lldb -- "$debug_target"
`;
}

function extractBackend(stdout: string): { backend: DebugBackend; stdout: string } {
	const match = stdout.match(/^PIRE_DEBUG_BACKEND=(gdb|lldb|unknown)\n?/m);
	if (!match) {
		return { backend: "unknown", stdout };
	}

	return {
		backend: match[1] as DebugBackend,
		stdout: stdout.replace(match[0], ""),
	};
}

async function runDockerDebug(args: CliArgs): Promise<RunResult> {
	const runtime = getTaskRuntimeConfig(args.taskType);
	const platform = await inspectImagePlatform(args.vulImage);
	const tempDir = mkdtempSync(join(tmpdir(), "cybergym-debug-"));
	const gdbScriptPath = join(tempDir, "debug.gdb");
	const lldbScriptPath = join(tempDir, "debug.lldb");
	const runnerScriptPath = join(tempDir, "run-debug.sh");

	writeFileSync(gdbScriptPath, buildGdbScript(args.commands, args.breakOnEntry), "utf-8");
	writeFileSync(lldbScriptPath, buildLldbScript(args.commands, args.breakOnEntry), "utf-8");
	writeFileSync(runnerScriptPath, buildRunnerScript(), "utf-8");

	try {
		const { stdout, stderr } = await execFileAsync(
			"docker",
			[
				"run",
				"--rm",
				...(platform ? ["--platform", platform] : []),
				"--cap-add=SYS_PTRACE",
				"--security-opt",
				"seccomp=unconfined",
				"--user",
				"0:0",
				"-v",
				`${args.artifactPath}:${runtime.pocMount}:ro`,
				"-v",
				`${tempDir}:/pire-debug:ro`,
				args.vulImage,
				"/bin/bash",
				"/pire-debug/run-debug.sh",
				args.backend,
				runtime.targetBinary,
			],
			{ timeout: DOCKER_TIMEOUT },
		);
		return { exitCode: 0, stdout, stderr, timedOut: false };
	} catch (error: unknown) {
		if (!(error instanceof Error)) {
			throw error;
		}

		const execError = error as Error & { code?: number; stdout?: string | Buffer; stderr?: string | Buffer; killed?: boolean };
		return {
			exitCode: typeof execError.code === "number" ? execError.code : 1,
			stdout:
				typeof execError.stdout === "string"
					? execError.stdout
					: Buffer.isBuffer(execError.stdout)
						? execError.stdout.toString("utf-8")
						: "",
			stderr:
				typeof execError.stderr === "string"
					? execError.stderr
					: Buffer.isBuffer(execError.stderr)
						? execError.stderr.toString("utf-8")
						: "",
			timedOut: execError.killed === true || error.message.includes("timed out"),
		};
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

async function main(argv: string[]): Promise<void> {
	const args = parseArgs(argv);
	const result = await runDockerDebug(args);
	const extracted = extractBackend(result.stdout);
	const payload: DebugPayload = {
		backend: extracted.backend,
		summary:
			extracted.backend === "unknown"
				? "Debugger could not be started inside the benchmark container."
				: "Executed debugger commands against the vulnerable benchmark target inside the container.",
		stdout: extracted.stdout,
		stderr: result.stderr,
		exitCode: result.exitCode,
		timedOut: result.timedOut,
		metadata: {
			taskType: args.taskType,
			image: args.vulImage,
			backendRequested: args.backend,
		},
	};
	process.stdout.write(`${JSON.stringify(payload)}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	const payload: DebugPayload = {
		backend: "unknown",
		summary: `Debug harness failed to run: ${message}`,
		stdout: "",
		stderr: message,
		exitCode: 1,
		timedOut: false,
		metadata: {},
	};
	process.stdout.write(`${JSON.stringify(payload)}\n`);
	process.exitCode = 0;
});
