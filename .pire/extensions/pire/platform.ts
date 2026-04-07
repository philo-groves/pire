import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ExecResult } from "@mariozechner/pi-coding-agent";

export interface PlatformArtifactObservation {
	path: string;
	type?: "binary" | "log" | "text" | "json" | "plist" | "other";
	command?: string;
	finding?: string;
}

export interface PlatformToolDetails {
	tool: string;
	target: string;
	command: string[];
	commandString: string;
	exitCode: number;
	killed: boolean;
	stdoutPreview: string;
	stderrPreview: string;
	summary: string;
	artifacts: PlatformArtifactObservation[];
	unavailable?: string;
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
	const slug = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return slug.length > 0 ? slug.slice(0, 80) : "artifact";
}

function looksUnavailable(result: ExecResult): boolean {
	const stderr = result.stderr.toLowerCase();
	const stdout = result.stdout.toLowerCase();
	return (
		result.code === 127 ||
		stderr.includes("not found") ||
		stderr.includes("is not recognized") ||
		stdout.includes("is not recognized")
	);
}

async function makeArtifactDir(cwd: string): Promise<string> {
	const artifactDir = join(cwd, ".pire", "artifacts");
	await mkdir(artifactDir, { recursive: true });
	return artifactDir;
}

async function persistOutputLog(cwd: string, filename: string, contents: string): Promise<string> {
	const artifactDir = await makeArtifactDir(cwd);
	const logPath = join(artifactDir, filename);
	await writeFile(logPath, contents.trimEnd() + "\n", "utf-8");
	return logPath;
}

async function execFirstAvailable(
	exec: ExecFn,
	candidates: string[],
	args: string[],
	signal?: AbortSignal,
): Promise<{ command: string; result: ExecResult }> {
	let lastResult: ExecResult | undefined;
	for (const candidate of candidates) {
		try {
			const result = await exec(candidate, args, { signal });
			if (!looksUnavailable(result) || candidate === candidates[candidates.length - 1]) {
				return { command: candidate, result };
			}
			lastResult = result;
		} catch {
			continue;
		}
	}
	return {
		command: candidates[0] ?? "unknown",
		result:
			lastResult ??
			{
				code: 127,
				killed: false,
				stdout: "",
				stderr: `No available executable from: ${candidates.join(", ")}`,
			},
	};
}

async function buildDetails(
	cwd: string,
	tool: string,
	target: string,
	commandCandidates: string[],
	args: string[],
	logFilename: string,
	artifacts: PlatformArtifactObservation[],
	signal?: AbortSignal,
	exec?: ExecFn,
): Promise<PlatformToolDetails> {
	if (!exec) {
		throw new Error("exec is required");
	}
	const { command, result } = await execFirstAvailable(exec, commandCandidates, args, signal);
	const commandString = commandToString(command, args);
	const stdoutPreview = truncateOutput(result.stdout);
	const stderrPreview = truncateOutput(result.stderr);
	const statusText =
		result.code === 0 ? "ok" : result.killed ? `killed (exit ${result.code})` : `failed (exit ${result.code})`;
	const preview = stdoutPreview || stderrPreview || "no output";
	const logPath = await persistOutputLog(cwd, logFilename, `${result.stdout}${result.stderr}`);
	return {
		tool,
		target,
		command: [command, ...args],
		commandString,
		exitCode: result.code,
		killed: result.killed,
		stdoutPreview,
		stderrPreview,
		summary: `${tool}: ${statusText}\ncommand: ${commandString}\n${preview}`,
		artifacts: [
			...artifacts,
			{
				path: logPath,
				type: "log",
				finding: `${tool} output for ${target}`,
				command: commandString,
			},
		],
		unavailable: looksUnavailable(result) ? result.stderr || result.stdout || undefined : undefined,
	};
}

export async function runPlatformPowershell(
	exec: ExecFn,
	cwd: string,
	view: "system-summary" | "services" | "processes" | "defender-status",
	signal?: AbortSignal,
): Promise<PlatformToolDetails> {
	const scriptByView: Record<typeof view, string> = {
		"system-summary":
			"$PSVersionTable.PSVersion; Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber, OSArchitecture",
		services: "Get-Service | Sort-Object Status, DisplayName | Select-Object -First 80 Status, Name, DisplayName",
		processes: "Get-Process | Sort-Object CPU -Descending | Select-Object -First 40 ProcessName, Id, CPU, Path",
		"defender-status":
			"Get-MpComputerStatus | Select-Object AMServiceEnabled, AntispywareEnabled, AntivirusEnabled, RealTimeProtectionEnabled",
	};
	return buildDetails(
		cwd,
		"platform_powershell",
		view,
		["pwsh", "powershell", "powershell.exe"],
		["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", scriptByView[view]],
		`platform-powershell-${view}.log`,
		[],
		signal,
		exec,
	);
}

export async function runPlatformHyperv(
	exec: ExecFn,
	cwd: string,
	view: "vm-list" | "vm-network" | "vm-checkpoints",
	signal?: AbortSignal,
): Promise<PlatformToolDetails> {
	const scriptByView: Record<typeof view, string> = {
		"vm-list": "Get-VM | Select-Object Name, State, Generation, Version, CPUUsage, MemoryAssigned",
		"vm-network": "Get-VMNetworkAdapter -All | Select-Object VMName, SwitchName, MacAddress, Status, IPAddresses",
		"vm-checkpoints": "Get-VMSnapshot -VMName * | Select-Object VMName, Name, SnapshotType, CreationTime",
	};
	return buildDetails(
		cwd,
		"platform_hyperv",
		view,
		["pwsh", "powershell", "powershell.exe"],
		["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", scriptByView[view]],
		`platform-hyperv-${view}.log`,
		[],
		signal,
		exec,
	);
}

export async function runPlatformMacos(
	exec: ExecFn,
	cwd: string,
	targetPath: string,
	view: "codesign" | "entitlements" | "otool-load-commands" | "plist" | "xattrs",
	signal?: AbortSignal,
): Promise<PlatformToolDetails> {
	const commandByView: Record<typeof view, { command: string; args: string[] }> = {
		codesign: { command: "codesign", args: ["-dvv", targetPath] },
		entitlements: { command: "codesign", args: ["-d", "--entitlements", ":-", targetPath] },
		"otool-load-commands": { command: "otool", args: ["-l", targetPath] },
		plist: { command: "plutil", args: ["-p", targetPath] },
		xattrs: { command: "xattr", args: ["-l", targetPath] },
	};
	const selected = commandByView[view];
	return buildDetails(
		cwd,
		"platform_macos",
		targetPath,
		[selected.command],
		selected.args,
		`platform-macos-${view}-${slugify(basename(targetPath))}.log`,
		[
			{
				path: targetPath,
				type: view === "plist" ? "plist" : "binary",
				finding: `platform_macos inspected ${targetPath}`,
			},
		],
		signal,
		exec,
	);
}

export async function runPlatformXcrun(
	exec: ExecFn,
	cwd: string,
	view: "simctl-list" | "devicectl-list" | "sdk-paths",
	signal?: AbortSignal,
): Promise<PlatformToolDetails> {
	const argsByView: Record<typeof view, string[]> = {
		"simctl-list": ["simctl", "list"],
		"devicectl-list": ["devicectl", "list", "devices"],
		"sdk-paths": ["--sdk", "iphoneos", "--show-sdk-path"],
	};
	return buildDetails(
		cwd,
		"platform_xcrun",
		view,
		["xcrun"],
		argsByView[view],
		`platform-xcrun-${view}.log`,
		[],
		signal,
		exec,
	);
}
