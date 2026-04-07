import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import pireExtension from "../../../../.pire/extensions/pire/index.js";
import {
	createStarterBinaryReEvalSuite,
	type PireEvalRunBundle,
	stringifyPireEvalTaskSuite,
} from "../../src/core/pire/eval-bundles.js";
import { createHarness, type Harness } from "./harness.js";

const PIRE_EXTENSION_PATH = "/home/philo/pire/.pire/extensions/pire/index.ts";

describe("pire eval export command", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("exports a scored eval run bundle from persisted pire session state", async () => {
		const harness = await createHarness({
			extensionFactories: [{ factory: pireExtension, path: PIRE_EXTENSION_PATH }],
		});
		harnesses.push(harness);

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		const suite = {
			...createStarterBinaryReEvalSuite(),
			tasks: createStarterBinaryReEvalSuite().tasks.filter(
				(task) => task.id === "binre-disasm-001" || task.id === "binre-toctou-001",
			),
		};
		const suitePath = join(harness.tempDir, "binary-suite.json");
		const bindingsPath = join(harness.tempDir, "bindings.json");
		const outputPath = join(harness.tempDir, "exports", "run-001.json");
		const sessionDir = join(harness.tempDir, ".pire", "session");
		mkdirSync(sessionDir, { recursive: true });

		writeFileSync(suitePath, stringifyPireEvalTaskSuite(suite), "utf-8");
		writeFileSync(
			bindingsPath,
			`${JSON.stringify(
				{
					version: 1,
					suiteId: suite.suiteId,
					runId: "run-001",
					model: "claude-sonnet-4-5",
					bindings: [
						{
							taskId: "binre-disasm-001",
							findingId: "find-001",
							exploitability: "limited",
							judgement: {
								dimensions: {
									primitives: "partial",
								},
							},
						},
						{
							taskId: "binre-toctou-001",
							findingTitleIncludes: "ownership check",
							exploitability: "limited",
						},
					],
				},
				null,
				2,
			)}\n`,
			"utf-8",
		);
		writeFileSync(
			join(sessionDir, "findings.json"),
			`${JSON.stringify(
				{
					version: 1,
					updatedAt: "2026-04-07T16:30:00.000Z",
					findings: [
						{
							id: "find-001",
							title: "Heap copy loop corrupts adjacent chunk",
							status: "confirmed",
							severity: "high",
							statement: "The parser copy loop overruns the destination chunk with attacker-controlled length.",
							basis: ["ev-001"],
							relatedEvidenceIds: ["ev-001"],
							relatedArtifactIds: ["artifact:/tmp/disasm.txt"],
							reproStatus: "reproduced",
							createdAt: "2026-04-07T16:01:00.000Z",
							updatedAt: "2026-04-07T16:10:00.000Z",
						},
						{
							id: "find-002",
							title: "Privileged helper races config file ownership check",
							status: "candidate",
							severity: "medium",
							statement: "The helper checks ownership and later reopens the same path for use.",
							basis: ["ev-002"],
							relatedEvidenceIds: ["ev-002"],
							relatedArtifactIds: ["artifact:/tmp/toctou.log"],
							reproStatus: "partial",
							createdAt: "2026-04-07T16:05:00.000Z",
							updatedAt: "2026-04-07T16:12:00.000Z",
						},
					],
					evidence: [
						{
							id: "ev-001",
							kind: "tool-result",
							summary: "objdump shows memcpy-sized copy loop",
							commandId: "tool:bash:toolu_01",
							artifactIds: ["artifact:/tmp/disasm.txt"],
							supports: ["find-001"],
							refutes: [],
							createdAt: "2026-04-07T16:02:00.000Z",
						},
						{
							id: "ev-002",
							kind: "trace",
							summary: "strace shows check/open split across the same path",
							commandId: "tool:bash:toolu_02",
							artifactIds: ["artifact:/tmp/toctou.log"],
							supports: ["find-002"],
							refutes: [],
							createdAt: "2026-04-07T16:06:00.000Z",
						},
					],
				},
				null,
				2,
			)}\n`,
			"utf-8",
		);
		writeFileSync(
			join(harness.tempDir, ".pire", "artifacts.json"),
			`${JSON.stringify(
				{
					version: 1,
					updatedAt: "2026-04-07T16:30:00.000Z",
					artifacts: [
						{ path: "/tmp/disasm.txt", type: "text" },
						{ path: "/tmp/toctou.log", type: "log" },
					],
				},
				null,
				2,
			)}\n`,
			"utf-8",
		);

		await harness.session.prompt(`/eval-export ${suitePath} :: ${bindingsPath} :: run-001 :: ${outputPath}`);

		const run = JSON.parse(readFileSync(outputPath, "utf-8")) as PireEvalRunBundle;
		expect(run.runId).toBe("run-001");
		expect(run.submissions).toHaveLength(2);
		expect(run.submissions[0]?.taskId).toBe("binre-disasm-001");
		expect(run.submissions[1]?.taskId).toBe("binre-toctou-001");
		expect(run.submissions[0]?.judgement.dimensions.discovery).toBe("hit");
		expect(run.submissions[0]?.judgement.dimensions.proof).toBe("hit");
		expect(run.submissions[1]?.judgement.dimensions.proof).toBe("partial");
		expect(
			run.submissions[0]?.evidence.some(
				(entry) => entry.kind === "artifact" && entry.ref === "artifact:/tmp/disasm.txt",
			),
		).toBe(true);
	});
});
