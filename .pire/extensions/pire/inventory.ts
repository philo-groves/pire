import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { homedir, networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecResult } from "@mariozechner/pi-coding-agent";

export interface ToolProbe {
	name: string;
	available: boolean;
	path?: string;
	version?: string;
	error?: string;
}

export interface EnvironmentInventory {
	cwd: string;
	platform: NodeJS.Platform;
	arch: string;
	release: string;
	nodeVersion: string;
	shell: string | undefined;
	homeDir: string;
	tempDir: string;
	container: boolean;
	writableDirs: string[];
	networkInterfaces: string[];
	dnsConfigured: boolean;
	ptraceScope?: string;
	seccompMode?: string;
	tracerPid?: string;
	networkPosture: string;
	sandboxPosture: string;
	tools: ToolProbe[];
}

type ExecFn = (command: string, args: string[]) => Promise<ExecResult>;

const TOOL_PROBES: Array<{ name: string; versionArgs: string[] }> = [
	{ name: "file", versionArgs: ["--version"] },
	{ name: "strings", versionArgs: ["--version"] },
	{ name: "readelf", versionArgs: ["--version"] },
	{ name: "objdump", versionArgs: ["--version"] },
	{ name: "nm", versionArgs: ["--version"] },
	{ name: "xxd", versionArgs: ["-h"] },
	{ name: "sha256sum", versionArgs: ["--version"] },
	{ name: "rizin", versionArgs: ["-v"] },
	{ name: "radare2", versionArgs: ["-v"] },
	{ name: "gdb", versionArgs: ["--version"] },
	{ name: "lldb", versionArgs: ["--version"] },
	{ name: "rr", versionArgs: ["--version"] },
	{ name: "strace", versionArgs: ["-V"] },
	{ name: "ltrace", versionArgs: ["-V"] },
	{ name: "perf", versionArgs: ["--version"] },
	{ name: "bpftrace", versionArgs: ["--version"] },
	{ name: "qemu-aarch64", versionArgs: ["--version"] },
	{ name: "qemu-system-x86_64", versionArgs: ["--version"] },
	{ name: "tcpdump", versionArgs: ["--version"] },
	{ name: "tshark", versionArgs: ["--version"] },
	{ name: "curl", versionArgs: ["--version"] },
	{ name: "afl-fuzz", versionArgs: ["--version"] },
	{ name: "honggfuzz", versionArgs: ["--version"] },
];

function isWritable(path: string): boolean {
	try {
		accessSync(path, constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

function isContainerized(): boolean {
	if (existsSync("/.dockerenv")) {
		return true;
	}

	try {
		const cgroup = readFileSync("/proc/1/cgroup", "utf-8");
		return /(docker|containerd|kubepods|podman)/i.test(cgroup);
	} catch {
		return false;
	}
}

function readProcFile(path: string): string | undefined {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return undefined;
	}
}

function detectNetworkPosture(): { networkInterfaces: string[]; dnsConfigured: boolean; posture: string } {
	const interfaces = networkInterfaces();
	const activeInterfaces = Object.entries(interfaces)
		.filter(([, entries]) => (entries ?? []).some((entry) => entry.internal === false))
		.map(([name]) => name)
		.sort();
	const resolvConf = readProcFile("/etc/resolv.conf") ?? "";
	const dnsConfigured = resolvConf
		.split("\n")
		.some((line) => line.trim().startsWith("nameserver") && line.trim().length > "nameserver".length);

	if (activeInterfaces.length === 0) {
		return {
			networkInterfaces: [],
			dnsConfigured,
			posture: dnsConfigured
				? "No non-loopback interfaces detected, but DNS resolvers are configured. Treat connectivity as constrained until verified."
				: "No non-loopback interfaces or DNS resolvers detected. Treat outbound access as unlikely until verified.",
		};
	}

	return {
		networkInterfaces: activeInterfaces,
		dnsConfigured,
		posture: dnsConfigured
			? `Non-loopback interfaces detected (${activeInterfaces.join(", ")}) and DNS resolvers are configured. Outbound access may be available.`
			: `Non-loopback interfaces detected (${activeInterfaces.join(", ")}), but no DNS resolvers were found in /etc/resolv.conf.`,
	};
}

function detectSandboxPosture(container: boolean): {
	ptraceScope?: string;
	seccompMode?: string;
	tracerPid?: string;
	posture: string;
} {
	const ptraceScope = readProcFile("/proc/sys/kernel/yama/ptrace_scope")?.trim();
	const status = readProcFile("/proc/self/status");
	const seccompMode = status
		?.split("\n")
		.find((line) => line.startsWith("Seccomp:"))
		?.split(":")[1]
		?.trim();
	const tracerPid = status
		?.split("\n")
		.find((line) => line.startsWith("TracerPid:"))
		?.split(":")[1]
		?.trim();

	const postureParts: string[] = [];
	postureParts.push(container ? "Container indicators detected." : "No container markers detected.");
	if (ptraceScope !== undefined) {
		postureParts.push(`ptrace_scope=${ptraceScope}.`);
	}
	if (seccompMode !== undefined) {
		postureParts.push(`seccomp=${seccompMode}.`);
	}
	if (tracerPid !== undefined && tracerPid !== "0") {
		postureParts.push(`TracerPid=${tracerPid}.`);
	}
	if (ptraceScope === undefined && seccompMode === undefined) {
		postureParts.push("Kernel sandbox details were not directly readable.");
	}

	return {
		ptraceScope,
		seccompMode,
		tracerPid,
		posture: postureParts.join(" "),
	};
}

function summarizeVersion(result: ExecResult): string | undefined {
	const output = `${result.stdout}\n${result.stderr}`
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.length > 0);
	return output;
}

async function probeTool(exec: ExecFn, tool: { name: string; versionArgs: string[] }): Promise<ToolProbe> {
	const pathResult = await exec("bash", ["-lc", `command -v ${tool.name}`]);
	if (pathResult.code !== 0) {
		return {
			name: tool.name,
			available: false,
		};
	}

	const binaryPath = pathResult.stdout.trim().split("\n")[0];
	const versionResult = await exec(tool.name, tool.versionArgs);
	return {
		name: tool.name,
		available: true,
		path: binaryPath,
		version: summarizeVersion(versionResult),
		error: versionResult.code === 0 ? undefined : summarizeVersion(versionResult) ?? `exit ${versionResult.code}`,
	};
}

export async function collectEnvironmentInventory(cwd: string, exec: ExecFn): Promise<EnvironmentInventory> {
	const homeDir = homedir();
	const tempDir = tmpdir();
	const writableCandidates = [cwd, join(cwd, ".pire"), join(cwd, ".pi"), tempDir, homeDir];
	const writableDirs = writableCandidates.filter((path, index) => writableCandidates.indexOf(path) === index && isWritable(path));
	const container = isContainerized();
	const networkPosture = detectNetworkPosture();
	const sandboxPosture = detectSandboxPosture(container);
	const tools = await Promise.all(TOOL_PROBES.map((tool) => probeTool(exec, tool)));

	return {
		cwd,
		platform: process.platform,
		arch: process.arch,
		release: process.release.name,
		nodeVersion: process.version,
		shell: process.env.SHELL ?? process.env.ComSpec,
		homeDir,
		tempDir,
		container,
		writableDirs,
		networkInterfaces: networkPosture.networkInterfaces,
		dnsConfigured: networkPosture.dnsConfigured,
		ptraceScope: sandboxPosture.ptraceScope,
		seccompMode: sandboxPosture.seccompMode,
		tracerPid: sandboxPosture.tracerPid,
		networkPosture: networkPosture.posture,
		sandboxPosture: sandboxPosture.posture,
		tools,
	};
}

export function formatInventorySummary(inventory: EnvironmentInventory): string {
	const availableTools = inventory.tools.filter((tool) => tool.available);
	const unavailableTools = inventory.tools.filter((tool) => !tool.available).map((tool) => tool.name);

	const lines = [
		"Environment Inventory",
		`- platform: ${inventory.platform}`,
		`- arch: ${inventory.arch}`,
		`- runtime: ${inventory.release}`,
		`- node: ${inventory.nodeVersion}`,
		`- cwd: ${inventory.cwd}`,
		`- shell: ${inventory.shell ?? "unknown"}`,
		`- container: ${inventory.container ? "detected" : "not detected"}`,
		`- writable dirs: ${inventory.writableDirs.join(", ") || "none detected"}`,
		`- interfaces: ${inventory.networkInterfaces.join(", ") || "loopback only / none detected"}`,
		`- dns: ${inventory.dnsConfigured ? "configured" : "not configured"}`,
		`- ptrace scope: ${inventory.ptraceScope ?? "unknown"}`,
		`- seccomp: ${inventory.seccompMode ?? "unknown"}`,
		`- available tools: ${availableTools.length}/${inventory.tools.length}`,
	];

	if (availableTools.length > 0) {
		lines.push("- key tool versions:");
		for (const tool of availableTools.slice(0, 10)) {
			lines.push(`  - ${tool.name}: ${tool.version ?? tool.path ?? "available"}`);
		}
	}

	if (unavailableTools.length > 0) {
		lines.push(`- missing tools: ${unavailableTools.join(", ")}`);
	}

	lines.push(`- network posture: ${inventory.networkPosture}`);
	lines.push(`- sandbox posture: ${inventory.sandboxPosture}`);

	return lines.join("\n");
}
