import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runDebugGdb, runDebugStrace } from "../../../.pire/extensions/pire/debug.js";

describe("pire debug helpers", () => {
	test("runDebugGdb builds bounded batch command metadata", async () => {
		const calls: Array<{ command: string; args: string[] }> = [];
		const details = await runDebugGdb(
			async (command, args) => {
				calls.push({ command, args });
				return {
					stdout: "Symbols from /tmp/sample.bin\nmain\nhelper",
					stderr: "",
					code: 0,
					killed: false,
				};
			},
			"/tmp/sample.bin",
			"info-functions",
		);

		expect(calls).toEqual([
			{
				command: "gdb",
				args: ["--batch", "-q", "-ex", "info functions", "/tmp/sample.bin"],
			},
		]);
		expect(details.commandString).toContain("gdb --batch -q -ex");
		expect(details.summary).toContain("debug_gdb: ok");
		expect(details.artifacts[0]?.path).toBe("/tmp/sample.bin");
		expect(details.artifacts[0]?.type).toBe("binary");
	});

	test("runDebugStrace emits trace-log artifacts under .pire/artifacts", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pire-debug-"));
		const calls: Array<{ command: string; args: string[] }> = [];
		const details = await runDebugStrace(
			async (command, args) => {
				calls.push({ command, args });
				return {
					stdout: "",
					stderr: "strace version 6.x",
					code: 0,
					killed: false,
				};
			},
			tempDir,
			"/tmp/sample.bin",
			{
				argv: ["--flag"],
				followForks: true,
				stringLimit: 512,
			},
		);

		expect(calls[0]?.command).toBe("strace");
		expect(calls[0]?.args).toContain("-f");
		expect(calls[0]?.args).toContain("--flag");
		expect(details.summary).toContain("debug_strace: ok");
		expect(details.artifacts).toHaveLength(2);
		expect(details.artifacts[1]?.path).toContain(".pire/artifacts/strace-sample.bin.log");
		expect(details.artifacts[1]?.type).toBe("trace");
	});
});
