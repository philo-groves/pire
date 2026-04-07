import { describe, expect, test } from "vitest";
import {
	createStarterBinaryReEvalSuite,
	parsePireEvalRunBundle,
	parsePireEvalTaskSuite,
	scorePireEvalRunBundle,
	stringifyPireEvalRunBundle,
	stringifyPireEvalTaskSuite,
	summarizePireEvalRunScore,
	validatePireEvalRunBundle,
	validatePireEvalTaskSuite,
} from "../src/core/pire/eval-bundles.js";

describe("pire eval bundles", () => {
	test("creates a valid starter binary RE suite and round-trips it through JSON", () => {
		const suite = createStarterBinaryReEvalSuite();
		expect(validatePireEvalTaskSuite(suite)).toEqual([]);

		const parsed = parsePireEvalTaskSuite(stringifyPireEvalTaskSuite(suite));
		expect(parsed.suiteId).toBe(suite.suiteId);
		expect(parsed.tasks).toHaveLength(suite.tasks.length);
		expect(parsed.focus).toBe("binary-re");
	});

	test("scores a run bundle, tracks missing tasks, and summarizes aggregate results", () => {
		const suite = createStarterBinaryReEvalSuite();
		const [taskA, taskB] = suite.tasks;
		if (!taskA || !taskB) {
			throw new Error("starter suite is unexpectedly empty");
		}

		const run = parsePireEvalRunBundle(
			stringifyPireEvalRunBundle({
				version: 1,
				suiteId: suite.suiteId,
				runId: "run-001",
				model: "claude-sonnet-4-5",
				submissions: [
					{
						taskId: taskA.id,
						evidence: [{ kind: "command", ref: "tool:bash:01" }],
						findingOutcome: "candidate",
						exploitability: "limited",
						judgement: {
							dimensions: {
								discovery: "hit",
								classification: "partial",
								rootCause: "partial",
								exploitability: "partial",
								reporting: "hit",
							},
						},
					},
					{
						taskId: taskB.id,
						evidence: [{ kind: "artifact", ref: "artifact:/tmp/disasm.txt" }],
						findingOutcome: "confirmed",
						exploitability: "limited",
						judgement: {
							dimensions: {
								discovery: "hit",
								classification: "hit",
								rootCause: "hit",
								exploitability: "hit",
								proof: "hit",
							},
						},
					},
				],
			}),
		);

		expect(validatePireEvalRunBundle(suite, run)).toEqual([]);

		const score = scorePireEvalRunBundle(suite, run);
		expect(score.taskScores).toHaveLength(2);
		expect(score.missingTaskIds.length).toBe(suite.tasks.length - 2);
		expect(score.unexpectedTaskIds).toEqual([]);
		expect(score.earned).toBeGreaterThan(0);

		const summary = summarizePireEvalRunScore(score);
		expect(summary[0]).toBe("Pire Eval Run Score");
		expect(summary.some((line) => line.includes(`- suite: ${suite.suiteId}`))).toBe(true);
		expect(summary.some((line) => line.includes("- scored tasks: 2"))).toBe(true);
	});

	test("flags run bundles with mismatched suite ids or duplicate submissions", () => {
		const suite = createStarterBinaryReEvalSuite();
		const task = suite.tasks[0];
		if (!task) {
			throw new Error("starter suite is unexpectedly empty");
		}

		const issues = validatePireEvalRunBundle(suite, {
			version: 1,
			suiteId: "wrong-suite",
			runId: "run-dup",
			submissions: [
				{
					taskId: task.id,
					evidence: [],
					judgement: { dimensions: { discovery: "hit" } },
				},
				{
					taskId: task.id,
					evidence: [],
					judgement: { dimensions: { discovery: "partial" } },
				},
			],
		});

		expect(issues).toContain(`run suiteId wrong-suite does not match task suite ${suite.suiteId}`);
		expect(issues).toContain(`duplicate submission for task id: ${task.id}`);
	});
});
