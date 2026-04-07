import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runDecompGhidraDecompile, runDecompGhidraFunctions } from "../../../.pire/extensions/pire/decomp.js";

describe("pire decomp helpers", () => {
	test("runDecompGhidraFunctions builds an analyzeHeadless function inventory flow", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pire-decomp-"));
		const calls: Array<{ command: string; args: string[] }> = [];
		const details = await runDecompGhidraFunctions(
			async (command, args) => {
				calls.push({ command, args });
				return {
					stdout: "wrote function list",
					stderr: "",
					code: 0,
					killed: false,
				};
			},
			tempDir,
			"/tmp/sample.bin",
		);

		expect(calls[0]?.command).toBe("analyzeHeadless");
		expect(calls[0]?.args).toContain("-import");
		expect(calls[0]?.args).toContain("-postScript");
		expect(details.summary).toContain("decomp_ghidra_functions: ok");
		expect(details.artifacts).toHaveLength(4);
		expect(details.artifacts[1]?.path).toContain(".pire/artifacts/ghidra-functions-sample.bin.txt");
		expect(details.artifacts[2]?.path).toContain(".pire/artifacts/ghidra-functions-sample.bin.log");
	});

	test("runDecompGhidraDecompile builds an analyzeHeadless decompilation flow", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pire-decomp-"));
		const calls: Array<{ command: string; args: string[] }> = [];
		const details = await runDecompGhidraDecompile(
			async (command, args) => {
				calls.push({ command, args });
				return {
					stdout: "decompiled sym.main",
					stderr: "",
					code: 0,
					killed: false,
				};
			},
			tempDir,
			"/tmp/sample.bin",
			{
				functionName: "sym.main",
			},
		);

		expect(calls[0]?.command).toBe("analyzeHeadless");
		expect(calls[0]?.args).toContain("-scriptPath");
		expect(details.summary).toContain("decomp_ghidra_decompile: ok");
		expect(details.artifacts).toHaveLength(4);
		expect(details.artifacts[1]?.path).toContain(".pire/artifacts/ghidra-decompile-sample.bin.txt");
		expect(details.artifacts[2]?.path).toContain(".pire/artifacts/ghidra-decompile-sample.bin.log");
	});
});
