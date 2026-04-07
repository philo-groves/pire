import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
	runDisasmRadare2Disassembly,
	runDisasmRizinFunctions,
	runDisasmRizinInfo,
} from "../../../.pire/extensions/pire/disasm.js";

describe("pire disasm helpers", () => {
	test("runDisasmRizinInfo persists info output as a log artifact", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pire-disasm-"));
		const calls: Array<{ command: string; args: string[] }> = [];
		const details = await runDisasmRizinInfo(
			async (command, args) => {
				calls.push({ command, args });
				return {
					stdout: "arch x86\nbits 64",
					stderr: "",
					code: 0,
					killed: false,
				};
			},
			tempDir,
			"/tmp/sample.bin",
		);

		expect(calls).toEqual([{ command: "rizin", args: ["-q", "-c", "iI;iS", "/tmp/sample.bin"] }]);
		expect(details.summary).toContain("disasm_rizin_info: ok");
		expect(details.artifacts).toHaveLength(2);
		expect(details.artifacts[1]?.path).toContain(".pire/artifacts/rizin-info-sample.bin.log");
	});

	test("runDisasmRizinFunctions persists function listings as an artifact log", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pire-disasm-"));
		const calls: Array<{ command: string; args: string[] }> = [];
		const details = await runDisasmRizinFunctions(
			async (command, args) => {
				calls.push({ command, args });
				return {
					stdout: "0x401000 32 sym.main",
					stderr: "",
					code: 0,
					killed: false,
				};
			},
			tempDir,
			"/tmp/sample.bin",
		);

		expect(calls).toEqual([{ command: "rizin", args: ["-q", "-c", "aaa;afll", "/tmp/sample.bin"] }]);
		expect(details.summary).toContain("disasm_rizin_functions: ok");
		expect(details.artifacts[1]?.path).toContain(".pire/artifacts/rizin-functions-sample.bin.log");
	});

	test("runDisasmRadare2Disassembly supports bounded disassembly previews", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pire-disasm-"));
		const calls: Array<{ command: string; args: string[] }> = [];
		const details = await runDisasmRadare2Disassembly(
			async (command, args) => {
				calls.push({ command, args });
				return {
					stdout: "0x00401000      push rbp\n0x00401001      mov rbp, rsp",
					stderr: "",
					code: 0,
					killed: false,
				};
			},
			tempDir,
			"/tmp/sample.bin",
			{
				functionName: "sym.main",
				lineCount: 24,
			},
		);

		expect(calls).toEqual([
			{
				command: "radare2",
				args: ["-q", "-c", "aaa;s sym.main;pdf 24", "/tmp/sample.bin"],
			},
		]);
		expect(details.summary).toContain("disasm_radare2_disassembly: ok");
		expect(details.artifacts[1]?.path).toContain(".pire/artifacts/radare2-disasm-sample.bin.log");
	});
});
