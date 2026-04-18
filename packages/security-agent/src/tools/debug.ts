import { type ExecFileException, execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@mariozechner/pi-ai";
import { type DebugBackend, type DebugBackendPreference, type DebugSpec, executeExternalDebug } from "../debug-spec.js";

const execFileAsync = promisify(execFile);
const MAX_STDOUT_CHARS = 50_000;
const MAX_STDERR_CHARS = 10_000;

export interface DebugToolDetails {
	mode: "local" | "external";
	backend: DebugBackend;
	targetPath?: string;
	pid?: number;
	artifactPath?: string;
	command: string[];
	commandString: string;
	exitCode: number;
	killed: boolean;
	timedOut: boolean;
	stdout: string;
	stderr: string;
	truncated: boolean;
	logPath: string;
	summary?: string;
	metadata?: Record<string, unknown>;
}

const debugToolSchema = Type.Object({
	target_path: Type.Optional(
		Type.String({
			description: "Executable or binary path to debug. Required when attaching by pid is not used.",
		}),
	),
	pid: Type.Optional(Type.Number({ description: "Process ID to attach to instead of launching a target path." })),
	artifact_path: Type.Optional(
		Type.String({
			description:
				"Artifact or input path for an external debug harness. Use this when the runtime provides a harness-managed target instead of a local executable.",
		}),
	),
	argv: Type.Optional(Type.Array(Type.String(), { description: "Arguments passed when launching target_path." })),
	commands: Type.Array(Type.String(), { description: "Debugger commands to execute in order." }),
	backend: Type.Optional(
		Type.Union([Type.Literal("auto"), Type.Literal("gdb"), Type.Literal("lldb")], {
			description: "Debugger backend. Defaults to auto-select by host OS.",
		}),
	),
	break_on_entry: Type.Optional(
		Type.Boolean({
			description: "When launching a target path, set a breakpoint at main and run before executing commands.",
		}),
	),
	timeout_ms: Type.Optional(Type.Number({ description: "Debugger timeout in milliseconds." })),
	goal: Type.Optional(
		Type.String({
			description: "Short note describing what runtime fact or effect this debug session should confirm.",
		}),
	),
});

type DebugToolParams = Static<typeof debugToolSchema>;

function normalizeOutput(output: string, maxLength: number): { text: string; truncated: boolean } {
	if (output.length <= maxLength) {
		return { text: output, truncated: false };
	}

	return {
		text: output.slice(-maxLength),
		truncated: true,
	};
}

function isExecFileException(
	error: unknown,
): error is ExecFileException & { stdout?: string | Buffer; stderr?: string | Buffer } {
	return error instanceof Error;
}

function normalizeExecOutput(output: unknown): string {
	if (typeof output === "string") {
		return output;
	}

	if (Buffer.isBuffer(output)) {
		return output.toString("utf-8");
	}

	return "";
}

function quoteShellArg(value: string): string {
	if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
		return value;
	}

	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function commandToString(command: string, args: string[]): string {
	return [command, ...args].map((value) => quoteShellArg(value)).join(" ");
}

async function commandExists(command: "gdb" | "lldb"): Promise<boolean> {
	try {
		await execFileAsync("bash", ["-lc", `command -v ${command}`], {
			timeout: 5000,
			maxBuffer: 1024 * 1024,
			env: process.env,
		});
		return true;
	} catch {
		return false;
	}
}

async function resolveBackend(requested: DebugBackendPreference): Promise<"gdb" | "lldb"> {
	if (requested !== "auto") {
		if (await commandExists(requested)) {
			return requested;
		}
		throw new Error(`Requested debugger "${requested}" is not available on this host`);
	}

	const candidates: Array<"gdb" | "lldb"> = process.platform === "darwin" ? ["lldb", "gdb"] : ["gdb", "lldb"];
	for (const candidate of candidates) {
		if (await commandExists(candidate)) {
			return candidate;
		}
	}

	throw new Error("No supported debugger is available on this host (looked for gdb and lldb)");
}

function validateParams(params: DebugToolParams, hasExternalSpec: boolean): string | undefined {
	const hasTargetPath = typeof params.target_path === "string" && params.target_path.trim().length > 0;
	const hasPid = typeof params.pid === "number";
	const hasArtifactPath = typeof params.artifact_path === "string" && params.artifact_path.trim().length > 0;
	const pid = params.pid;

	if (hasArtifactPath && (hasTargetPath || hasPid)) {
		return 'Provide either "artifact_path" or one local target selector, not both.';
	}
	if (hasArtifactPath) {
		if (!hasExternalSpec) {
			return '"artifact_path" requires an external debug harness configured by the runtime.';
		}
		if (params.commands.length === 0) {
			return '"commands" must contain at least one debugger command.';
		}
		return undefined;
	}
	if (hasTargetPath === hasPid) {
		return 'Provide exactly one of "target_path" or "pid".';
	}
	if (hasPid && (pid === undefined || !Number.isInteger(pid) || pid <= 0)) {
		return '"pid" must be a positive integer.';
	}
	if (params.commands.length === 0) {
		return '"commands" must contain at least one debugger command.';
	}
	return undefined;
}

function resolveTargetPath(cwd: string, targetPath: string | undefined): string | undefined {
	if (!targetPath) {
		return undefined;
	}

	return resolve(cwd, targetPath);
}

function resolveArtifactPath(cwd: string, artifactPath: string | undefined): string | undefined {
	if (!artifactPath) {
		return undefined;
	}

	return resolve(cwd, artifactPath);
}

function validateExistingPath(kind: "target" | "artifact", path: string | undefined): string | undefined {
	if (!path) {
		return undefined;
	}
	if (!existsSync(path)) {
		return `${kind} does not exist: ${path}`;
	}
	return undefined;
}

function createLogPath(
	artifactsDir: string,
	backend: DebugBackend,
	targetPath?: string,
	pid?: number,
	artifactPath?: string,
): string {
	const stem = artifactPath
		? basename(artifactPath).replace(/[^A-Za-z0-9._-]+/g, "_")
		: targetPath
			? basename(targetPath).replace(/[^A-Za-z0-9._-]+/g, "_")
			: `pid-${pid ?? "unknown"}`;
	return join(artifactsDir, `${backend}-${stem}-${Date.now()}.log`);
}

function normalizeLldbCommand(command: string): string {
	const trimmed = command.trim();
	if (trimmed.length === 0) {
		return trimmed;
	}

	const breakMatch = /^(?:break|b)\s+(.+)$/.exec(trimmed);
	if (breakMatch) {
		return `breakpoint set --name ${breakMatch[1]}`;
	}

	const printMatch = /^print\s+(.+)$/.exec(trimmed);
	if (printMatch) {
		return `expression -- ${printMatch[1]}`;
	}

	if (trimmed === "backtrace") {
		return "bt";
	}

	return trimmed;
}

function normalizeDebuggerCommand(backend: "gdb" | "lldb", command: string): string {
	if (backend === "lldb") {
		return normalizeLldbCommand(command);
	}

	return command;
}

function buildInvocation(
	backend: "gdb" | "lldb",
	params: DebugToolParams,
	targetPath?: string,
): { command: string; args: string[] } {
	const argv = params.argv ?? [];
	if (backend === "gdb") {
		const args = ["--batch", "-q"];
		if (params.break_on_entry && !params.pid) {
			args.push("-ex", "break main", "-ex", "run");
		}
		for (const debuggerCommand of params.commands) {
			args.push("-ex", debuggerCommand);
		}
		if (params.pid) {
			args.push("-p", String(params.pid));
		} else if (targetPath) {
			if (argv.length > 0) {
				args.push("--args", targetPath, ...argv);
			} else {
				args.push(targetPath);
			}
		}
		return { command: "gdb", args };
	}

	const args = ["--batch", "-Q"];
	if (params.pid) {
		args.push("-p", String(params.pid));
	}
	if (params.break_on_entry && !params.pid) {
		args.push("-o", "breakpoint set --name main", "-o", "run");
	}
	for (const debuggerCommand of params.commands) {
		args.push("-o", normalizeDebuggerCommand(backend, debuggerCommand));
	}
	if (!params.pid && targetPath) {
		args.push("--", targetPath, ...argv);
	}
	return { command: "lldb", args };
}

function formatContent(
	details: DebugToolDetails,
	validationError?: string,
): { text: string; details: DebugToolDetails } {
	const lines = [
		`Mode: ${details.mode}`,
		`Debugger: ${details.backend}`,
		`Command: ${details.commandString}`,
		`Exit code: ${details.exitCode}${details.timedOut ? " (timed out)" : ""}`,
		`Log: ${details.logPath}`,
	];
	if (details.targetPath) {
		lines.push(`Target: ${details.targetPath}`);
	}
	if (details.pid) {
		lines.push(`PID: ${details.pid}`);
	}
	if (details.artifactPath) {
		lines.push(`Artifact: ${details.artifactPath}`);
	}
	if (details.summary) {
		lines.push(`Summary: ${details.summary}`);
	}
	if (validationError) {
		lines.push(`Error: ${validationError}`);
	}
	if (details.stdout) {
		lines.push("", "stdout:", details.stdout);
	}
	if (details.stderr) {
		lines.push("", "stderr:", details.stderr);
	}
	if (!details.stdout && !details.stderr) {
		lines.push("", "(no output)");
	}

	return {
		text: lines.join("\n"),
		details,
	};
}

async function writeDebugLog(logPath: string, details: DebugToolDetails): Promise<void> {
	const lines = [
		`mode: ${details.mode}`,
		`backend: ${details.backend}`,
		`command: ${details.commandString}`,
		`exit_code: ${details.exitCode}`,
		`killed: ${details.killed}`,
		`timed_out: ${details.timedOut}`,
	];
	if (details.targetPath) {
		lines.push(`target_path: ${details.targetPath}`);
	}
	if (details.pid) {
		lines.push(`pid: ${details.pid}`);
	}
	if (details.artifactPath) {
		lines.push(`artifact_path: ${details.artifactPath}`);
	}
	if (details.summary) {
		lines.push(`summary: ${details.summary}`);
	}
	if (details.metadata) {
		lines.push(`metadata: ${JSON.stringify(details.metadata)}`);
	}
	lines.push("", "[stdout]", details.stdout, "", "[stderr]", details.stderr);
	await writeFile(logPath, `${lines.join("\n")}\n`, "utf-8");
}

export function createDebugTool(
	cwd: string,
	artifactsDir: string,
	externalSpec?: DebugSpec,
): AgentTool<typeof debugToolSchema, DebugToolDetails> {
	const description = externalSpec
		? "Run debugger commands against a local target path or live pid, or against a harness-managed target via artifact_path when an external debug harness is configured. Auto-selects gdb on Linux and lldb on Darwin unless overridden."
		: "Run debugger commands against a local target path or live pid. Auto-selects gdb on Linux and lldb on Darwin unless overridden.";

	return {
		name: "debug",
		label: "Debug",
		description,
		parameters: debugToolSchema,
		async execute(_toolCallId: string, params: DebugToolParams) {
			const validationError = validateParams(params, externalSpec !== undefined);
			const targetPath = resolveTargetPath(cwd, params.target_path);
			const artifactPath = resolveArtifactPath(cwd, params.artifact_path);
			const targetError = validateExistingPath("target", targetPath);
			const artifactError = validateExistingPath("artifact", artifactPath);
			mkdirSync(dirname(artifactsDir), { recursive: true });
			mkdirSync(artifactsDir, { recursive: true });
			if (validationError || targetError || artifactError) {
				const fallbackBackend: DebugBackend =
					artifactPath || params.artifact_path ? "unknown" : process.platform === "darwin" ? "lldb" : "gdb";
				const logPath = createLogPath(artifactsDir, fallbackBackend, targetPath, params.pid, artifactPath);
				const details: DebugToolDetails = {
					mode: artifactPath || params.artifact_path ? "external" : "local",
					backend: fallbackBackend,
					targetPath,
					pid: params.pid,
					artifactPath,
					command: [],
					commandString: "",
					exitCode: 1,
					killed: false,
					timedOut: false,
					stdout: "",
					stderr: validationError ?? targetError ?? artifactError ?? "",
					truncated: false,
					logPath,
				};
				await writeDebugLog(logPath, details);
				const response = formatContent(details, validationError ?? targetError ?? artifactError);
				return {
					content: [{ type: "text", text: response.text }],
					details: response.details,
				};
			}

			if (artifactPath && externalSpec) {
				const external = await executeExternalDebug(externalSpec, {
					artifactPath,
					goal: params.goal,
					commands: params.commands,
					backend: params.backend ?? "auto",
					breakOnEntry: params.break_on_entry ?? false,
					workspaceCwd: cwd,
				});
				const logPath = createLogPath(artifactsDir, external.backend, targetPath, params.pid, artifactPath);
				const details: DebugToolDetails = {
					mode: "external",
					backend: external.backend,
					targetPath,
					pid: params.pid,
					artifactPath,
					command: external.command,
					commandString: external.commandString,
					exitCode: external.exitCode,
					killed: false,
					timedOut: external.timedOut,
					stdout: external.stdout,
					stderr: external.stderr,
					truncated: external.truncated,
					logPath,
					summary: external.summary,
					metadata: external.metadata,
				};
				await writeDebugLog(logPath, details);
				const response = formatContent(details);
				return {
					content: [{ type: "text", text: response.text }],
					details: response.details,
				};
			}

			const backend = await resolveBackend(params.backend ?? "auto");
			const logPath = createLogPath(artifactsDir, backend, targetPath, params.pid, artifactPath);

			const invocation = buildInvocation(backend, params, targetPath);
			const commandString = commandToString(invocation.command, invocation.args);
			try {
				const childResult = await execFileAsync(invocation.command, invocation.args, {
					cwd,
					timeout: params.timeout_ms ?? 60000,
					maxBuffer: 5 * 1024 * 1024,
					env: process.env,
				});
				const stdout = normalizeOutput(childResult.stdout, MAX_STDOUT_CHARS);
				const stderr = normalizeOutput(childResult.stderr, MAX_STDERR_CHARS);
				const details: DebugToolDetails = {
					mode: "local",
					backend,
					targetPath,
					pid: params.pid,
					artifactPath,
					command: [invocation.command, ...invocation.args],
					commandString,
					exitCode: 0,
					killed: false,
					timedOut: false,
					stdout: stdout.text,
					stderr: stderr.text,
					truncated: stdout.truncated || stderr.truncated,
					logPath,
				};
				await writeDebugLog(logPath, details);
				const response = formatContent(details);
				return {
					content: [{ type: "text", text: response.text }],
					details: response.details,
				};
			} catch (error: unknown) {
				if (!isExecFileException(error)) {
					throw error;
				}

				const stdout = normalizeOutput(normalizeExecOutput(error.stdout), MAX_STDOUT_CHARS);
				const stderr = normalizeOutput(normalizeExecOutput(error.stderr), MAX_STDERR_CHARS);
				const details: DebugToolDetails = {
					mode: "local",
					backend,
					targetPath,
					pid: params.pid,
					artifactPath,
					command: [invocation.command, ...invocation.args],
					commandString,
					exitCode: typeof error.code === "number" ? error.code : 1,
					killed: error.killed === true,
					timedOut: error.killed === true || error.message.includes("timed out"),
					stdout: stdout.text,
					stderr: stderr.text || error.message,
					truncated: stdout.truncated || stderr.truncated,
					logPath,
				};
				await writeDebugLog(logPath, details);
				const response = formatContent(details);
				return {
					content: [{ type: "text", text: response.text }],
					details: response.details,
				};
			}
		},
	};
}
