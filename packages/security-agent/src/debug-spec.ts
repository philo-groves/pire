import { type ExecFileException, execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_CHARS = 20_000;
const DEBUG_BACKENDS = ["gdb", "lldb", "unknown"] as const;

export type DebugBackend = (typeof DEBUG_BACKENDS)[number];
export type DebugBackendPreference = "auto" | "gdb" | "lldb";

export interface DebugSpec {
	name: string;
	description: string;
	command: string[];
	cwd?: string;
	timeoutMs: number;
	env: Record<string, string>;
	specPath: string;
}

export interface DebugRequest {
	artifactPath: string;
	goal?: string;
	commands: string[];
	backend: DebugBackendPreference;
	breakOnEntry: boolean;
	workspaceCwd: string;
}

export interface ExternalDebugResult {
	backend: DebugBackend;
	summary?: string;
	stdout: string;
	stderr: string;
	exitCode: number;
	timedOut: boolean;
	truncated: boolean;
	metadata?: Record<string, unknown>;
	command: string[];
	commandString: string;
}

interface DebugPayload {
	backend?: DebugBackend;
	summary?: string;
	stdout?: string;
	stderr?: string;
	exitCode?: number;
	timedOut?: boolean;
	metadata?: Record<string, unknown>;
}

interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
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

function normalizeOutput(output: string): { text: string; truncated: boolean } {
	if (output.length <= MAX_OUTPUT_CHARS) {
		return { text: output, truncated: false };
	}

	return {
		text: output.slice(-MAX_OUTPUT_CHARS),
		truncated: true,
	};
}

function isDebugBackend(value: unknown): value is DebugBackend {
	return typeof value === "string" && DEBUG_BACKENDS.includes(value as DebugBackend);
}

function interpolateTemplate(template: string, values: Record<string, string>): string {
	return template.replace(/{{\s*([a-z_]+)\s*}}/gi, (match, rawKey: string) => {
		const key = rawKey.toLowerCase();
		return values[key] ?? match;
	});
}

function parseDebugPayload(stdout: string): DebugPayload | undefined {
	const trimmed = stdout.trim();
	if (trimmed.length === 0) {
		return undefined;
	}

	const candidates = [trimmed];
	const lines = trimmed
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const lastLine = lines.at(-1);
	if (lastLine && lastLine !== trimmed) {
		candidates.push(lastLine);
	}

	for (const candidate of candidates) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(candidate);
		} catch {
			continue;
		}

		if (!isRecord(parsed)) {
			continue;
		}

		const payload: DebugPayload = {};
		if (isDebugBackend(parsed.backend)) {
			payload.backend = parsed.backend;
		}
		if (typeof parsed.summary === "string") {
			payload.summary = parsed.summary;
		}
		if (typeof parsed.stdout === "string") {
			payload.stdout = parsed.stdout;
		}
		if (typeof parsed.stderr === "string") {
			payload.stderr = parsed.stderr;
		}
		if (typeof parsed.exitCode === "number") {
			payload.exitCode = parsed.exitCode;
		}
		if (typeof parsed.timedOut === "boolean") {
			payload.timedOut = parsed.timedOut;
		}
		if (isRecord(parsed.metadata)) {
			payload.metadata = parsed.metadata;
		}
		return payload;
	}

	return undefined;
}

function loadStringRecord(value: unknown, fieldName: string): Record<string, string> {
	if (value === undefined) {
		return {};
	}

	if (!isRecord(value)) {
		throw new Error(`Debug spec field "${fieldName}" must be an object of strings`);
	}

	const result: Record<string, string> = {};
	for (const [key, fieldValue] of Object.entries(value)) {
		if (typeof fieldValue !== "string") {
			throw new Error(`Debug spec field "${fieldName}.${key}" must be a string`);
		}
		result[key] = fieldValue;
	}
	return result;
}

function quoteShellArg(value: string): string {
	if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
		return value;
	}

	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function commandToString(command: string[]): string {
	return command.map((value) => quoteShellArg(value)).join(" ");
}

async function runDebugCommand(spec: DebugSpec, request: DebugRequest): Promise<CommandResult & { command: string[] }> {
	const templateValues: Record<string, string> = {
		artifact_path: request.artifactPath,
		artifact_dir: dirname(request.artifactPath),
		goal: request.goal ?? "",
		workspace_cwd: request.workspaceCwd,
		spec_dir: dirname(spec.specPath),
		backend: request.backend,
		commands_json: JSON.stringify(request.commands),
		break_on_entry: request.breakOnEntry ? "true" : "false",
	};
	const command = spec.command.map((part) => interpolateTemplate(part, templateValues));
	if (command.length === 0) {
		throw new Error("Debug command is empty");
	}

	const env: NodeJS.ProcessEnv = {
		...process.env,
		PIRE_ARTIFACT_PATH: request.artifactPath,
		PIRE_ARTIFACT_DIR: dirname(request.artifactPath),
		PIRE_DEBUG_GOAL: request.goal ?? "",
		PIRE_WORKSPACE_CWD: request.workspaceCwd,
		PIRE_DEBUG_BACKEND: request.backend,
		PIRE_DEBUG_COMMANDS_JSON: JSON.stringify(request.commands),
		PIRE_DEBUG_BREAK_ON_ENTRY: request.breakOnEntry ? "true" : "false",
	};
	for (const [key, value] of Object.entries(spec.env)) {
		env[key] = interpolateTemplate(value, templateValues);
	}

	try {
		const { stdout, stderr } = await execFileAsync(command[0], command.slice(1), {
			cwd: spec.cwd ?? request.workspaceCwd,
			timeout: spec.timeoutMs,
			maxBuffer: 5 * 1024 * 1024,
			env,
		});
		return { exitCode: 0, stdout, stderr, timedOut: false, command };
	} catch (error: unknown) {
		if (!isExecFileException(error)) {
			throw error;
		}

		return {
			exitCode: typeof error.code === "number" ? error.code : 1,
			stdout: normalizeExecOutput(error.stdout),
			stderr: normalizeExecOutput(error.stderr),
			timedOut: error.killed === true || error.message.includes("timed out"),
			command,
		};
	}
}

export function loadDebugSpec(specPath: string): DebugSpec {
	const resolvedSpecPath = resolve(specPath);
	const parsed = JSON.parse(readFileSync(resolvedSpecPath, "utf-8")) as unknown;
	if (!isRecord(parsed)) {
		throw new Error("Debug spec must be a JSON object");
	}

	const name = parsed.name;
	const description = parsed.description;
	const command = parsed.command;
	const cwd = parsed.cwd;
	const timeoutMs = parsed.timeout_ms;

	if (typeof name !== "string" || name.trim().length === 0) {
		throw new Error('Debug spec field "name" must be a non-empty string');
	}
	if (typeof description !== "string" || description.trim().length === 0) {
		throw new Error('Debug spec field "description" must be a non-empty string');
	}
	if (!isStringArray(command) || command.length === 0) {
		throw new Error('Debug spec field "command" must be a non-empty array of strings');
	}
	if (cwd !== undefined && typeof cwd !== "string") {
		throw new Error('Debug spec field "cwd" must be a string when provided');
	}
	if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new Error('Debug spec field "timeout_ms" must be a positive number');
	}

	return {
		name,
		description,
		command,
		cwd: cwd ? resolve(dirname(resolvedSpecPath), cwd) : undefined,
		timeoutMs,
		env: loadStringRecord(parsed.env, "env"),
		specPath: resolvedSpecPath,
	};
}

export async function executeExternalDebug(spec: DebugSpec, request: DebugRequest): Promise<ExternalDebugResult> {
	const result = await runDebugCommand(spec, request);
	const payload = parseDebugPayload(result.stdout);
	const normalizedStdout = normalizeOutput(payload?.stdout ?? result.stdout);
	const normalizedStderr = normalizeOutput(payload?.stderr ?? result.stderr);

	return {
		backend: payload?.backend ?? "unknown",
		summary: payload?.summary,
		stdout: normalizedStdout.text,
		stderr: normalizedStderr.text,
		exitCode: payload?.exitCode ?? result.exitCode,
		timedOut: payload?.timedOut ?? result.timedOut,
		truncated: normalizedStdout.truncated || normalizedStderr.truncated,
		metadata: payload?.metadata,
		command: result.command,
		commandString: commandToString(result.command),
	};
}
