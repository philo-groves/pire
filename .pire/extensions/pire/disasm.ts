import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ExecResult } from "@mariozechner/pi-coding-agent";

export interface DisasmArtifactObservation {
	path: string;
	type?: "binary" | "log" | "text" | "other";
	command?: string;
	finding?: string;
}

export interface DisasmToolDetails {
	tool: string;
	targetPath: string;
	command: string[];
	commandString: string;
	exitCode: number;
	killed: boolean;
	stdoutPreview: string;
	stderrPreview: string;
	summary: string;
	artifacts: DisasmArtifactObservation[];
}

interface ToolExecResult extends DisasmToolDetails {}

type ExecFn = (command: string, args: string[], options?: { signal?: AbortSignal; cwd?: string }) => Promise<ExecResult>;

const PREVIEW_LINE_LIMIT = 80;
const PREVIEW_CHAR_LIMIT = 8000;

function quoteShellArg(value: string): string {
	if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
		return value;
	}
	return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function commandToString(command: string, args: string[]): string {
	return [command, ...args].map((value) => quoteShellArg(value)).join(" ");
}

function truncateOutput(text: string, maxLines = PREVIEW_LINE_LIMIT): string {
	const normalized = text.trim();
	if (normalized.length === 0) {
		return "";
	}

	const clippedChars = normalized.length > PREVIEW_CHAR_LIMIT ? `${normalized.slice(0, PREVIEW_CHAR_LIMIT)}\n...` : normalized;
	const lines = clippedChars.split("\n");
	if (lines.length <= maxLines) {
		return clippedChars;
	}

	return `${lines.slice(0, maxLines).join("\n")}\n... ${lines.length - maxLines} more lines`;
}

function getArtifactStem(targetPath: string): string {
	return basename(targetPath).replace(/[^A-Za-z0-9._-]+/g, "_");
}

async function ensureArtifactDir(cwd: string): Promise<string> {
	const artifactDir = join(cwd, ".pire", "artifacts");
	await mkdir(artifactDir, { recursive: true });
	return artifactDir;
}

async function persistLog(cwd: string, filename: string, contents: string): Promise<string> {
	const artifactDir = await ensureArtifactDir(cwd);
	const path = join(artifactDir, filename);
	await writeFile(path, contents, "utf-8");
	return path;
}

async function runTool(
	exec: ExecFn,
	command: string,
	args: string[],
	targetPath: string,
	toolName: string,
	artifacts: DisasmArtifactObservation[],
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const result = await exec(command, args, { signal });
	const commandString = commandToString(command, args);
	const stdoutPreview = truncateOutput(result.stdout);
	const stderrPreview = truncateOutput(result.stderr);
	const statusText =
		result.code === 0 ? "ok" : result.killed ? `killed (exit ${result.code})` : `failed (exit ${result.code})`;
	const preview = stdoutPreview || stderrPreview || "no output";

	return {
		tool: toolName,
		targetPath,
		command: [command, ...args],
		commandString,
		exitCode: result.code,
		killed: result.killed,
		stdoutPreview,
		stderrPreview,
		summary: `${toolName}: ${statusText}\ncommand: ${commandString}\n${preview}`,
		artifacts: artifacts.map((artifact) => ({
			...artifact,
			command: artifact.command ?? commandString,
		})),
	};
}

export async function runDisasmRizinInfo(
	exec: ExecFn,
	cwd: string,
	targetPath: string,
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const args = ["-q", "-c", "iI;iS", targetPath];
	const result = await exec("rizin", args, { signal });
	const logPath = await persistLog(
		cwd,
		`rizin-info-${getArtifactStem(targetPath)}.log`,
		`${result.stdout}${result.stderr}`.trimEnd() + "\n",
	);

	return runTool(
		async () => result,
		"rizin",
		args,
		targetPath,
		"disasm_rizin_info",
		[
			{
				path: targetPath,
				type: "binary",
				finding: `rizin info summary for ${targetPath}`,
			},
			{
				path: logPath,
				type: "log",
				finding: `rizin info log for ${targetPath}`,
			},
		],
		signal,
	);
}

export async function runDisasmRizinFunctions(
	exec: ExecFn,
	cwd: string,
	targetPath: string,
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const args = ["-q", "-c", "aaa;afll", targetPath];
	const result = await exec("rizin", args, { signal });
	const logPath = await persistLog(
		cwd,
		`rizin-functions-${getArtifactStem(targetPath)}.log`,
		`${result.stdout}${result.stderr}`.trimEnd() + "\n",
	);

	return runTool(
		async () => result,
		"rizin",
		args,
		targetPath,
		"disasm_rizin_functions",
		[
			{
				path: targetPath,
				type: "binary",
				finding: `rizin function list for ${targetPath}`,
			},
			{
				path: logPath,
				type: "log",
				finding: `rizin function listing for ${targetPath}`,
			},
		],
		signal,
	);
}

export async function runDisasmRadare2GadgetSearch(
	exec: ExecFn,
	cwd: string,
	targetPath: string,
	options: { pattern: string; maxResults?: number },
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const limit = options.maxResults ?? 100;
	const searchCommand = `/R ${options.pattern}`;
	const args = ["-q", "-c", searchCommand, targetPath];
	const result = await exec("radare2", args, { signal });

	const rawOutput = `${result.stdout}${result.stderr}`.trimEnd();
	const lines = rawOutput.split("\n");
	const truncated = lines.length > limit ? `${lines.slice(0, limit).join("\n")}\n... ${lines.length - limit} more gadgets` : rawOutput;

	const logPath = await persistLog(
		cwd,
		`radare2-gadgets-${getArtifactStem(targetPath)}.log`,
		`${truncated}\n`,
	);

	return runTool(
		async () => ({ ...result, stdout: truncated, stderr: "" }),
		"radare2",
		args,
		targetPath,
		"disasm_radare2_gadgets",
		[
			{
				path: targetPath,
				type: "binary",
				finding: `radare2 gadget search for '${options.pattern}' in ${targetPath}`,
			},
			{
				path: logPath,
				type: "log",
				finding: `radare2 gadget search results for ${targetPath}`,
			},
		],
		signal,
	);
}

export async function runDisasmRadare2Disassembly(
	exec: ExecFn,
	cwd: string,
	targetPath: string,
	options: { functionName?: string; lineCount: number },
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const locationCommand = options.functionName
		? `aaa;s ${options.functionName};pdf ${Math.max(1, options.lineCount)}`
		: `aaa;pdf ${Math.max(1, options.lineCount)}`;
	const args = ["-q", "-c", locationCommand, targetPath];
	const result = await exec("radare2", args, { signal });
	const logPath = await persistLog(
		cwd,
		`radare2-disasm-${getArtifactStem(targetPath)}.log`,
		`${result.stdout}${result.stderr}`.trimEnd() + "\n",
	);

	return runTool(
		async () => result,
		"radare2",
		args,
		targetPath,
		"disasm_radare2_disassembly",
		[
			{
				path: targetPath,
				type: "binary",
				finding: `radare2 disassembly preview for ${targetPath}`,
			},
			{
				path: logPath,
				type: "log",
				finding: `radare2 disassembly log for ${targetPath}`,
			},
		],
		signal,
	);
}
