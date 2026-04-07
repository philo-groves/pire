import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ExecResult } from "@mariozechner/pi-coding-agent";

export interface UnpackArtifactObservation {
	path: string;
	type?: "firmware" | "log" | "other";
	command?: string;
	finding?: string;
}

export interface UnpackToolDetails {
	tool: string;
	targetPath: string;
	command: string[];
	commandString: string;
	exitCode: number;
	killed: boolean;
	stdoutPreview: string;
	stderrPreview: string;
	summary: string;
	artifacts: UnpackArtifactObservation[];
}

interface ToolExecResult extends UnpackToolDetails {}

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
	artifacts: UnpackArtifactObservation[],
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

export async function runUnpackBinwalkScan(
	exec: ExecFn,
	cwd: string,
	targetPath: string,
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const result = await exec("binwalk", [targetPath], { signal });
	const logPath = await persistLog(
		cwd,
		`binwalk-scan-${getArtifactStem(targetPath)}.log`,
		`${result.stdout}${result.stderr}`.trimEnd() + "\n",
	);

	return runTool(
		async () => result,
		"binwalk",
		[targetPath],
		targetPath,
		"unpack_binwalk_scan",
		[
			{
				path: targetPath,
				type: "firmware",
				finding: `binwalk scan for ${targetPath}`,
			},
			{
				path: logPath,
				type: "log",
				finding: `binwalk scan output for ${targetPath}`,
			},
		],
		signal,
	);
}

export async function runUnpackBinwalkExtract(
	exec: ExecFn,
	cwd: string,
	targetPath: string,
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const artifactDir = await ensureArtifactDir(cwd);
	const extractDir = join(artifactDir, `binwalk-extract-${getArtifactStem(targetPath)}`);
	await mkdir(extractDir, { recursive: true });
	const result = await exec("binwalk", ["-e", "--directory", extractDir, targetPath], { signal });
	const logPath = await persistLog(
		cwd,
		`binwalk-extract-${getArtifactStem(targetPath)}.log`,
		`${result.stdout}${result.stderr}`.trimEnd() + "\n",
	);

	return runTool(
		async () => result,
		"binwalk",
		["-e", "--directory", extractDir, targetPath],
		targetPath,
		"unpack_binwalk_extract",
		[
			{
				path: targetPath,
				type: "firmware",
				finding: `binwalk extraction for ${targetPath}`,
			},
			{
				path: extractDir,
				type: "firmware",
				finding: `binwalk extraction directory for ${targetPath}`,
			},
			{
				path: logPath,
				type: "log",
				finding: `binwalk extraction log for ${targetPath}`,
			},
		],
		signal,
	);
}

export async function runUnpackArchiveList(
	exec: ExecFn,
	cwd: string,
	targetPath: string,
	format: "tar" | "zip",
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const result =
		format === "tar"
			? await exec("tar", ["-tf", targetPath], { signal })
			: await exec("unzip", ["-l", targetPath], { signal });
	const logPath = await persistLog(
		cwd,
		`${format}-list-${getArtifactStem(targetPath)}.log`,
		`${result.stdout}${result.stderr}`.trimEnd() + "\n",
	);

	return runTool(
		async () => result,
		format === "tar" ? "tar" : "unzip",
		format === "tar" ? ["-tf", targetPath] : ["-l", targetPath],
		targetPath,
		"unpack_archive_list",
		[
			{
				path: targetPath,
				type: "firmware",
				finding: `${format} archive listing for ${targetPath}`,
			},
			{
				path: logPath,
				type: "log",
				finding: `${format} listing log for ${targetPath}`,
			},
		],
		signal,
	);
}
