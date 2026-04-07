import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ExecResult } from "@mariozechner/pi-coding-agent";

export interface NetArtifactObservation {
	path: string;
	type?: "pcap" | "log" | "text" | "json" | "other";
	command?: string;
	finding?: string;
}

export interface NetToolDetails {
	tool: string;
	target: string;
	command: string[];
	commandString: string;
	exitCode: number;
	killed: boolean;
	stdoutPreview: string;
	stderrPreview: string;
	artifacts: NetArtifactObservation[];
}

interface ToolExecResult extends NetToolDetails {
	summary: string;
}

type ExecFn = (command: string, args: string[], options?: { signal?: AbortSignal; cwd?: string }) => Promise<ExecResult>;

const PREVIEW_LINE_LIMIT = 80;
const PREVIEW_CHAR_LIMIT = 8000;

function quoteShellArg(value: string): string {
	if (/^[A-Za-z0-9_./:@?&=%:+,-]+$/.test(value)) {
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

function slugify(value: string): string {
	const slug = value
		.toLowerCase()
		.replace(/^[a-z]+:\/\//, "")
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug.length > 0 ? slug.slice(0, 80) : "artifact";
}

async function makeArtifactDir(cwd: string): Promise<string> {
	const artifactDir = join(cwd, ".pire", "artifacts");
	await mkdir(artifactDir, { recursive: true });
	return artifactDir;
}

async function persistOutputLog(cwd: string, filename: string, contents: string): Promise<string> {
	const artifactDir = await makeArtifactDir(cwd);
	const logPath = join(artifactDir, filename);
	await writeFile(logPath, contents, "utf-8");
	return logPath;
}

async function runTool(
	exec: ExecFn,
	command: string,
	args: string[],
	target: string,
	toolName: string,
	artifacts: NetArtifactObservation[],
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
		target,
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

export async function runNetCurlHead(
	exec: ExecFn,
	cwd: string,
	url: string,
	options: { followRedirects: boolean; maxTimeSeconds: number },
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const args = ["-I", "-sS", "--max-time", String(options.maxTimeSeconds)];
	if (options.followRedirects) {
		args.push("-L");
	}
	args.push(url);
	const result = await exec("curl", args, { signal });
	const logPath = await persistOutputLog(
		cwd,
		`curl-head-${slugify(url)}.log`,
		`${result.stdout}${result.stderr}`.trimEnd() + "\n",
	);

	return runTool(
		async () => result,
		"curl",
		args,
		url,
		"net_curl_head",
		[
			{
				path: logPath,
				type: "log",
				finding: `HTTP header capture for ${url}`,
			},
		],
		signal,
	);
}

export async function runNetTsharkSummary(
	exec: ExecFn,
	cwd: string,
	pcapPath: string,
	options: { view: "protocol-hierarchy" | "endpoints-ip" | "conversations-ip" },
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const viewArgs: Record<typeof options.view, string[]> = {
		"protocol-hierarchy": ["-q", "-z", "io,phs"],
		"endpoints-ip": ["-q", "-z", "endpoints,ip"],
		"conversations-ip": ["-q", "-z", "conv,ip"],
	};
	const args = ["-r", pcapPath, ...viewArgs[options.view]];
	const result = await exec("tshark", args, { signal });
	const logPath = await persistOutputLog(
		cwd,
		`tshark-${options.view}-${basename(pcapPath)}.log`,
		`${result.stdout}${result.stderr}`.trimEnd() + "\n",
	);

	return runTool(
		async () => result,
		"tshark",
		args,
		pcapPath,
		"net_tshark_summary",
		[
			{
				path: pcapPath,
				type: "pcap",
				finding: `PCAP summarized with ${options.view}`,
			},
			{
				path: logPath,
				type: "log",
				finding: `tshark ${options.view} output for ${pcapPath}`,
			},
		],
		signal,
	);
}

export async function runNetTsharkFollow(
	exec: ExecFn,
	cwd: string,
	pcapPath: string,
	options: { streamIndex: number; protocol: "tcp" | "udp" | "http" },
	signal?: AbortSignal,
): Promise<ToolExecResult> {
	const args = ["-r", pcapPath, "-q", "-z", `follow,${options.protocol},ascii,${options.streamIndex}`];
	const result = await exec("tshark", args, { signal });
	const logPath = await persistOutputLog(
		cwd,
		`tshark-follow-${options.protocol}-${options.streamIndex}-${basename(pcapPath)}.log`,
		`${result.stdout}${result.stderr}`.trimEnd() + "\n",
	);

	return runTool(
		async () => result,
		"tshark",
		args,
		pcapPath,
		"net_tshark_follow",
		[
			{
				path: pcapPath,
				type: "pcap",
				finding: `PCAP stream follow for ${options.protocol} stream ${options.streamIndex}`,
			},
			{
				path: logPath,
				type: "log",
				finding: `Follow output for ${options.protocol} stream ${options.streamIndex}`,
			},
		],
		signal,
	);
}
