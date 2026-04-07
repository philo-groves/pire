import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createStarterBinaryReEvalSuite, scorePireEvalRunBundle } from "../src/core/pire/eval-bundles.js";
import { createPireEvalRunBundleFromSession } from "../src/core/pire/eval-runner.js";

describe("pire eval session extraction", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir) {
				await rm(dir, { recursive: true, force: true });
			}
		}
	});

	test("extracts run-bundle submissions from pire tracker and artifact state", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "pire-eval-session-"));
		tempDirs.push(cwd);

		const sessionDir = join(cwd, ".pire", "session");
		const findingsPath = join(sessionDir, "findings.json");
		const artifactsPath = join(cwd, ".pire", "artifacts.json");
		mkdirSync(sessionDir, { recursive: true });

		writeFileSync(
			findingsPath,
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
			artifactsPath,
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

		const suite = createStarterBinaryReEvalSuite();
		const trimmedSuite = {
			...suite,
			tasks: suite.tasks.filter((task) => task.id === "binre-disasm-001" || task.id === "binre-toctou-001"),
		};

		const run = await createPireEvalRunBundleFromSession({
			cwd,
			suite: trimmedSuite,
			runId: "session-run-001",
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
		});

		expect(run.submissions).toHaveLength(2);
		expect(run.submissions[0]?.findingOutcome).toBe("confirmed");
		expect(run.submissions[0]?.judgement.dimensions.discovery).toBe("hit");
		expect(run.submissions[0]?.judgement.dimensions.proof).toBe("hit");
		expect(run.submissions[0]?.judgement.dimensions.primitives).toBe("partial");
		expect(
			run.submissions[0]?.evidence.some((entry) => entry.kind === "command" && entry.ref === "tool:bash:toolu_01"),
		).toBe(true);
		expect(
			run.submissions[0]?.evidence.some(
				(entry) => entry.kind === "artifact" && entry.ref === "artifact:/tmp/disasm.txt",
			),
		).toBe(true);

		expect(run.submissions[1]?.findingOutcome).toBe("candidate");
		expect(run.submissions[1]?.judgement.dimensions.proof).toBe("partial");

		const score = scorePireEvalRunBundle(trimmedSuite, run);
		expect(score.taskScores).toHaveLength(2);
		expect(score.missingTaskIds).toEqual([]);
	});
});
