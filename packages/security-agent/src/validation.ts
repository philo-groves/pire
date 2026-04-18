import { type ExecFileException, execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_CHARS = 20_000;

const VALIDATION_STATUSES = [
	"rejected",
	"accepted_no_trigger",
	"triggered",
	"proof_complete",
	"blocked",
	"ambiguous",
] as const;

export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export interface ValidationSpec {
	name: string;
	description: string;
	command: string[];
	cwd?: string;
	timeoutMs: number;
	env: Record<string, string>;
	specPath: string;
}

export interface ValidationRequest {
	artifactPath: string;
	goal?: string;
	workspaceCwd: string;
}

export interface ValidationResult {
	status: ValidationStatus;
	summary: string;
	nextStep?: string;
	stdout: string;
	stderr: string;
	exitCode: number;
	timedOut: boolean;
	truncated: boolean;
	metadata?: Record<string, unknown>;
}

export interface ValidationToolDetails extends ValidationResult {
	artifactPath: string;
	attempt: number;
	validator: string;
}

export interface ValidationSessionState {
	attempts: number;
	lastResult?: ValidationToolDetails;
	history: ValidationToolDetails[];
}

interface ValidationPayload {
	status: ValidationStatus;
	summary: string;
	nextStep?: string;
	stdout?: string;
	stderr?: string;
	exitCode?: number;
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

function isValidationStatus(value: unknown): value is ValidationStatus {
	return typeof value === "string" && VALIDATION_STATUSES.includes(value as ValidationStatus);
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

function interpolateTemplate(template: string, values: Record<string, string>): string {
	return template.replace(/{{\s*([a-z_]+)\s*}}/gi, (match, rawKey: string) => {
		const key = rawKey.toLowerCase();
		return values[key] ?? match;
	});
}

function parseValidationPayload(stdout: string): ValidationPayload | undefined {
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

		const status = parsed.status;
		const summary = parsed.summary;
		if (!isValidationStatus(status) || typeof summary !== "string") {
			continue;
		}

		const nextStep = typeof parsed.nextStep === "string" ? parsed.nextStep : undefined;
		const payloadStdout = typeof parsed.stdout === "string" ? parsed.stdout : undefined;
		const payloadStderr = typeof parsed.stderr === "string" ? parsed.stderr : undefined;
		const exitCode = typeof parsed.exitCode === "number" ? parsed.exitCode : undefined;
		const metadata = isRecord(parsed.metadata) ? parsed.metadata : undefined;

		return {
			status,
			summary,
			nextStep,
			stdout: payloadStdout,
			stderr: payloadStderr,
			exitCode,
			metadata,
		};
	}

	return undefined;
}

function loadStringRecord(value: unknown, fieldName: string): Record<string, string> {
	if (value === undefined) {
		return {};
	}

	if (!isRecord(value)) {
		throw new Error(`Validation spec field "${fieldName}" must be an object of strings`);
	}

	const result: Record<string, string> = {};
	for (const [key, fieldValue] of Object.entries(value)) {
		if (typeof fieldValue !== "string") {
			throw new Error(`Validation spec field "${fieldName}.${key}" must be a string`);
		}
		result[key] = fieldValue;
	}
	return result;
}

async function runValidationCommand(spec: ValidationSpec, request: ValidationRequest): Promise<CommandResult> {
	const templateValues: Record<string, string> = {
		artifact_path: request.artifactPath,
		artifact_dir: dirname(request.artifactPath),
		goal: request.goal ?? "",
		workspace_cwd: request.workspaceCwd,
		spec_dir: dirname(spec.specPath),
	};
	const command = spec.command.map((part) => interpolateTemplate(part, templateValues));
	if (command.length === 0) {
		throw new Error("Validation command is empty");
	}

	const env: NodeJS.ProcessEnv = {
		...process.env,
		PIRE_ARTIFACT_PATH: request.artifactPath,
		PIRE_ARTIFACT_DIR: dirname(request.artifactPath),
		PIRE_VALIDATION_GOAL: request.goal ?? "",
		PIRE_WORKSPACE_CWD: request.workspaceCwd,
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
		return { exitCode: 0, stdout, stderr, timedOut: false };
	} catch (error: unknown) {
		if (!isExecFileException(error)) {
			throw error;
		}

		return {
			exitCode: typeof error.code === "number" ? error.code : 1,
			stdout: normalizeExecOutput(error.stdout),
			stderr: normalizeExecOutput(error.stderr),
			timedOut: error.killed === true || error.message.includes("timed out"),
		};
	}
}

export function loadValidationSpec(specPath: string): ValidationSpec {
	const resolvedSpecPath = resolve(specPath);
	const parsed = JSON.parse(readFileSync(resolvedSpecPath, "utf-8")) as unknown;
	if (!isRecord(parsed)) {
		throw new Error("Validation spec must be a JSON object");
	}

	const name = parsed.name;
	const description = parsed.description;
	const command = parsed.command;
	const cwd = parsed.cwd;
	const timeoutMs = parsed.timeout_ms;

	if (typeof name !== "string" || name.trim().length === 0) {
		throw new Error('Validation spec field "name" must be a non-empty string');
	}
	if (typeof description !== "string" || description.trim().length === 0) {
		throw new Error('Validation spec field "description" must be a non-empty string');
	}
	if (!isStringArray(command) || command.length === 0) {
		throw new Error('Validation spec field "command" must be a non-empty string array');
	}
	if (cwd !== undefined && typeof cwd !== "string") {
		throw new Error('Validation spec field "cwd" must be a string');
	}
	if (timeoutMs !== undefined && typeof timeoutMs !== "number") {
		throw new Error('Validation spec field "timeout_ms" must be a number');
	}

	return {
		name,
		description,
		command,
		cwd: cwd ? resolve(dirname(resolvedSpecPath), cwd) : undefined,
		timeoutMs: timeoutMs ?? 60_000,
		env: loadStringRecord(parsed.env, "env"),
		specPath: resolvedSpecPath,
	};
}

export async function executeValidation(spec: ValidationSpec, request: ValidationRequest): Promise<ValidationResult> {
	const commandResult = await runValidationCommand(spec, request);
	const payload = parseValidationPayload(commandResult.stdout);

	if (payload) {
		const stdout = normalizeOutput(payload.stdout ?? "");
		const stderr = normalizeOutput(payload.stderr ?? "");
		return {
			status: payload.status,
			summary: payload.summary,
			nextStep: payload.nextStep,
			stdout: stdout.text,
			stderr: stderr.text,
			exitCode: payload.exitCode ?? commandResult.exitCode,
			timedOut: commandResult.timedOut,
			truncated: stdout.truncated || stderr.truncated,
			metadata: payload.metadata,
		};
	}

	const stdout = normalizeOutput(commandResult.stdout);
	const stderr = normalizeOutput(commandResult.stderr);
	return {
		status: commandResult.timedOut ? "blocked" : "ambiguous",
		summary: commandResult.timedOut
			? "Validator timed out before returning structured feedback."
			: "Validator did not return structured JSON feedback.",
		stdout: stdout.text,
		stderr: stderr.text,
		exitCode: commandResult.exitCode,
		timedOut: commandResult.timedOut,
		truncated: stdout.truncated || stderr.truncated,
	};
}
