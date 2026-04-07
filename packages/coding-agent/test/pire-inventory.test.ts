import { describe, expect, test } from "vitest";
import { type EnvironmentInventory, formatInventorySummary } from "../../../.pire/extensions/pire/inventory.js";

describe("pire environment inventory helpers", () => {
	test("formatInventorySummary includes runtime posture details", () => {
		const inventory: EnvironmentInventory = {
			cwd: "/tmp/lab",
			platform: "linux",
			arch: "x64",
			release: "node",
			nodeVersion: "v24.0.0",
			shell: "/bin/bash",
			homeDir: "/home/tester",
			tempDir: "/tmp",
			container: true,
			writableDirs: ["/tmp/lab", "/tmp"],
			networkInterfaces: ["eth0"],
			dnsConfigured: true,
			ptraceScope: "1",
			seccompMode: "2",
			tracerPid: "0",
			networkPosture: "Outbound access may be available.",
			sandboxPosture: "Container indicators detected. ptrace_scope=1. seccomp=2.",
			tools: [
				{ name: "file", available: true, version: "file-5.45" },
				{ name: "readelf", available: false },
			],
		};

		const summary = formatInventorySummary(inventory);
		expect(summary).toContain("- node: v24.0.0");
		expect(summary).toContain("- interfaces: eth0");
		expect(summary).toContain("- dns: configured");
		expect(summary).toContain("- ptrace scope: 1");
		expect(summary).toContain("- seccomp: 2");
		expect(summary).toContain("- network posture: Outbound access may be available.");
		expect(summary).toContain("- sandbox posture: Container indicators detected. ptrace_scope=1. seccomp=2.");
	});
});
