import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ExecResult } from "@mariozechner/pi-coding-agent";

export interface DebugArtifactObservation {
	path: string;
	type?: "binary" | "trace" | "log" | "dump" | "other";
	command?: string;
	finding?: string;
}

export interface DebugToolDetails {
	tool: string;
	targetPath: string;
	command: string[];
	commandString: string;
	exitCode: number;
	killed: boolean;
	stdoutPreview: string;
	stderrPreview: string;
	summary: string;
	artifacts: DebugArtifactObservation[];
}

interface ToolExecResult extends DebugToolDetails {}

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
	artifacts: DebugArtifactObservation[],
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

function makeLogPath(cwd: string, prefix: string, targetPath: string): string {
	const stem = basename(targetPath).replace(/[^A-Za-z0-9._-]+/g, "_");
	return join(cwd, ".pire", "artifacts", `${prefix}-${stem}.log`);
}

export async function runDebugGdbCommands(
	exec: ExecFn,
	cwd: string,
	targetPath: string,
	commands: string[],
	options?: { argv?: string[]; breakOnEntry?: boolean },
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const logPath = makeLogPath(cwd, "gdb-commands", targetPath);
	await mkdir(join(cwd, ".pire", "artifacts"), { recursive: true });

	const args = ["--batch", "-q"];
	if (options?.breakOnEntry) {
		args.push("-ex", "break main", "-ex", "run");
	}
	for (const cmd of commands) {
		args.push("-ex", cmd);
	}
	if (options?.argv && options.argv.length > 0) {
		args.push("--args", targetPath, ...options.argv);
	} else {
		args.push(targetPath);
	}

	return runTool(
		exec,
		"gdb",
		args,
		targetPath,
		"debug_gdb_commands",
		[
			{
				path: targetPath,
				type: "binary",
				finding: `debug_gdb_commands ran ${commands.length} command(s) against ${targetPath}`,
			},
			{
				path: logPath,
				type: "log",
				finding: `gdb command output for ${targetPath}`,
			},
		],
		signal,
	);
}

export async function runDebugGdbScript(
	exec: ExecFn,
	cwd: string,
	targetPath: string,
	script: string,
	options?: { argv?: string[] },
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const artifactDir = join(cwd, ".pire", "artifacts");
	await mkdir(artifactDir, { recursive: true });
	const stem = basename(targetPath).replace(/[^A-Za-z0-9._-]+/g, "_");
	const scriptPath = join(artifactDir, `gdb-script-${stem}-${Date.now()}.py`);
	const { writeFile } = await import("node:fs/promises");
	await writeFile(scriptPath, script, "utf-8");

	const args = ["--batch", "-q", "-x", scriptPath];
	if (options?.argv && options.argv.length > 0) {
		args.push("--args", targetPath, ...options.argv);
	} else {
		args.push(targetPath);
	}

	return runTool(
		exec,
		"gdb",
		args,
		targetPath,
		"debug_gdb_script",
		[
			{
				path: targetPath,
				type: "binary",
				finding: `debug_gdb_script executed Python script against ${targetPath}`,
			},
			{
				path: scriptPath,
				type: "log",
				finding: `gdb Python script for ${targetPath}`,
			},
		],
		signal,
	);
}

export async function runDebugGdb(
	exec: ExecFn,
	targetPath: string,
	view: "info-file" | "info-functions" | "info-sharedlibrary",
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const viewToCommand: Record<typeof view, string> = {
		"info-file": "info file",
		"info-functions": "info functions",
		"info-sharedlibrary": "info sharedlibrary",
	};

	return runTool(
		exec,
		"gdb",
		["--batch", "-q", "-ex", viewToCommand[view], targetPath],
		targetPath,
		"debug_gdb",
		[
			{
				path: targetPath,
				type: "binary",
				finding: `debug_gdb inspected ${targetPath}`,
			},
		],
		signal,
	);
}

export async function runDebugLldb(
	exec: ExecFn,
	targetPath: string,
	view: "image-list" | "target-modules" | "breakpoint-list",
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const viewToCommand: Record<typeof view, string> = {
		"image-list": "image list",
		"target-modules": "target modules list",
		"breakpoint-list": "breakpoint list",
	};

	return runTool(
		exec,
		"lldb",
		["--batch", "-Q", "-o", viewToCommand[view], "--", targetPath],
		targetPath,
		"debug_lldb",
		[
			{
				path: targetPath,
				type: "binary",
				finding: `debug_lldb inspected ${targetPath}`,
			},
		],
		signal,
	);
}

export async function runDebugStrace(
	exec: ExecFn,
	cwd: string,
	targetPath: string,
	options: { argv: string[]; followForks: boolean; stringLimit: number },
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const logPath = makeLogPath(cwd, "strace", targetPath);
	await mkdir(join(cwd, ".pire", "artifacts"), { recursive: true });
	const args = ["-o", logPath, "-s", String(options.stringLimit)];
	if (options.followForks) {
		args.push("-f");
	}
	args.push(targetPath, ...options.argv);

	return runTool(
		exec,
		"strace",
		args,
		targetPath,
		"debug_strace",
		[
			{
				path: targetPath,
				type: "binary",
				finding: `debug_strace traced ${targetPath}`,
			},
			{
				path: logPath,
				type: "trace",
				finding: `strace output for ${targetPath}`,
			},
		],
		signal,
	);
}

export async function runDebugLtrace(
	exec: ExecFn,
	cwd: string,
	targetPath: string,
	options: { argv: string[]; followForks: boolean; stringLimit: number },
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const logPath = makeLogPath(cwd, "ltrace", targetPath);
	await mkdir(join(cwd, ".pire", "artifacts"), { recursive: true });
	const args = ["-o", logPath, "-s", String(options.stringLimit)];
	if (options.followForks) {
		args.push("-f");
	}
	args.push(targetPath, ...options.argv);

	return runTool(
		exec,
		"ltrace",
		args,
		targetPath,
		"debug_ltrace",
		[
			{
				path: targetPath,
				type: "binary",
				finding: `debug_ltrace traced ${targetPath}`,
			},
			{
				path: logPath,
				type: "trace",
				finding: `ltrace output for ${targetPath}`,
			},
		],
		signal,
	);
}
