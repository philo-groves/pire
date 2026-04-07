import type { ExecResult } from "@mariozechner/pi-coding-agent";

export interface BinaryArtifactObservation {
	path: string;
	type?: "binary" | "text" | "log" | "json" | "other";
	command?: string;
	finding?: string;
}

export interface BinaryToolDetails {
	tool: string;
	targetPath: string;
	command: string[];
	commandString: string;
	exitCode: number;
	killed: boolean;
	stdoutPreview: string;
	stderrPreview: string;
	artifacts: BinaryArtifactObservation[];
}

interface ToolExecResult extends BinaryToolDetails {
	summary: string;
}

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

async function runTool(
	exec: ExecFn,
	command: string,
	args: string[],
	targetPath: string,
	toolName: string,
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
		artifacts: [
			{
				path: targetPath,
				type: "binary",
				command: commandString,
				finding: `${toolName} inspected ${targetPath}`,
			},
		],
	};
}

export async function runBinaryFile(exec: ExecFn, targetPath: string, signal?: AbortSignal): Promise<ToolExecResult> {
	return runTool(exec, "file", ["-b", targetPath], targetPath, "binary_file", signal);
}

export async function runBinaryStrings(
	exec: ExecFn,
	targetPath: string,
	options: { minLength: number; limit: number },
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const result = await runTool(exec, "strings", ["-n", String(options.minLength), targetPath], targetPath, "binary_strings", signal);
	const lines = result.stdoutPreview.split("\n").filter((line) => line.length > 0);
	const limited = lines.slice(0, options.limit);
	const preview = limited.length > 0 ? limited.join("\n") : result.stdoutPreview || "no strings found";

	return {
		...result,
		stdoutPreview: preview,
		summary: `binary_strings: ${result.exitCode === 0 ? "ok" : `failed (exit ${result.exitCode})`}\ncommand: ${result.commandString}\n${preview}`,
	};
}

export async function runBinaryReadelf(
	exec: ExecFn,
	targetPath: string,
	view: "file-header" | "sections" | "program-headers" | "symbols" | "dynamic",
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const viewToArgs: Record<typeof view, string[]> = {
		"file-header": ["-h", targetPath],
		sections: ["-S", targetPath],
		"program-headers": ["-l", targetPath],
		symbols: ["-s", targetPath],
		dynamic: ["-d", targetPath],
	};

	return runTool(exec, "readelf", viewToArgs[view], targetPath, "binary_readelf", signal);
}

export async function runBinaryObjdump(
	exec: ExecFn,
	targetPath: string,
	options: { section?: string; lineLimit: number },
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const args = ["-d"];
	if (options.section) {
		args.push(`--section=${options.section}`);
	}
	args.push(targetPath);

	const result = await runTool(exec, "objdump", args, targetPath, "binary_objdump", signal);
	const lines = result.stdoutPreview.split("\n").filter((line) => line.length > 0);
	const preview = lines.slice(0, options.lineLimit).join("\n") || result.stdoutPreview || "no disassembly output";

	return {
		...result,
		stdoutPreview: preview,
		summary: `binary_objdump: ${result.exitCode === 0 ? "ok" : `failed (exit ${result.exitCode})`}\ncommand: ${result.commandString}\n${preview}`,
	};
}

export async function runBinaryNm(
	exec: ExecFn,
	targetPath: string,
	options: { demangle: boolean; definedOnly: boolean; lineLimit: number },
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const args: string[] = [];
	if (options.demangle) {
		args.push("-C");
	}
	if (options.definedOnly) {
		args.push("--defined-only");
	}
	args.push(targetPath);

	const result = await runTool(exec, "nm", args, targetPath, "binary_nm", signal);
	const lines = result.stdoutPreview.split("\n").filter((line) => line.length > 0);
	const preview = lines.slice(0, options.lineLimit).join("\n") || result.stdoutPreview || "no symbol output";

	return {
		...result,
		stdoutPreview: preview,
		summary: `binary_nm: ${result.exitCode === 0 ? "ok" : `failed (exit ${result.exitCode})`}\ncommand: ${result.commandString}\n${preview}`,
	};
}

export async function runBinaryHexdump(
	exec: ExecFn,
	targetPath: string,
	options: { offset: number; length: number },
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	return runTool(
		exec,
		"xxd",
		["-g", "1", "-s", String(options.offset), "-l", String(options.length), targetPath],
		targetPath,
		"binary_xxd",
		signal,
	);
}
