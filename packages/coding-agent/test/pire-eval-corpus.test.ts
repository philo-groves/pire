import { describe, expect, test } from "vitest";
import {
	createStarterBinaryReEvalCorpus,
	summarizeBinaryReEvalCorpus,
	validateBinaryReEvalCorpus,
} from "../src/core/pire/eval-corpus.js";

describe("pire binary RE eval corpus", () => {
	test("provides a starter corpus covering key binary RE bug classes and workflows", () => {
		const corpus = createStarterBinaryReEvalCorpus();
		const summary = summarizeBinaryReEvalCorpus(corpus);

		expect(corpus.every((task) => task.lane === "reverse-engineering" || task.lane === "chain")).toBe(true);
		expect(summary.totalTasks).toBeGreaterThanOrEqual(18);
		expect(summary.reverseEngineeringTasks).toBeGreaterThan(0);
		expect(summary.chainTasks).toBeGreaterThanOrEqual(3);
		expect(summary.byBugClass.uaf).toBeGreaterThan(0);
		expect(summary.byBugClass["heap-overflow"]).toBeGreaterThan(0);
		expect(summary.byBugClass["oob-read"]).toBeGreaterThan(0);
		expect(summary.byBugClass["oob-write"]).toBeGreaterThan(0);
		expect(summary.byBugClass.toctou).toBeGreaterThan(0);
		expect(summary.byFocus.disassembly).toBeGreaterThan(0);
		expect(summary.byFocus.decompilation).toBeGreaterThan(0);
		expect(summary.byFocus["surface-mapping"]).toBeGreaterThan(0);
		expect(summary.strippedTasks).toBeGreaterThan(0);
		expect(summary.exploitabilityTargets.none).toBeGreaterThan(0);
		expect(summary.exploitabilityTargets.rce).toBeGreaterThan(0);
		expect(summary.exploitabilityTargets.chain).toBeGreaterThanOrEqual(5);
		expect(summary.exploitabilityTargets.dos).toBeGreaterThan(0);
		expect(summary.sophisticatedChainTasks).toBeGreaterThanOrEqual(5);
		expect(summary.maxRequiredBugChainLength).toBeGreaterThanOrEqual(4);
		expect(summary.byBugClass["double-free"]).toBeGreaterThanOrEqual(2);
		expect(summary.byFocus["crash-triage"]).toBeGreaterThanOrEqual(2);
		expect(summary.byFocus["primitive-extraction"]).toBeGreaterThanOrEqual(2);
	});

	test("includes multiple decoy tasks that penalize overclaiming", () => {
		const corpus = createStarterBinaryReEvalCorpus();
		const decoys = corpus.filter((task) => task.expected?.exploitability === "none");
		expect(decoys.length).toBeGreaterThanOrEqual(2);
		// Decoys should still be real bugs — confirmed findings with no security impact
		for (const decoy of decoys) {
			expect(decoy.expected?.findingOutcome).toBe("confirmed");
		}
	});

	test("tasks with custom rubrics have weights that sum to 100", () => {
		const corpus = createStarterBinaryReEvalCorpus();
		const tasksWithRubric = corpus.filter((task) => task.rubric !== undefined);
		expect(tasksWithRubric.length).toBeGreaterThan(0);
		for (const task of tasksWithRubric) {
			const total = Object.values(task.rubric!).reduce((sum, w) => sum + w, 0);
			expect(total).toBe(100);
		}
	});

	test("validates the starter corpus cleanly, keeps shell-first command expectations, and defines explicit chain depth", () => {
		const corpus = createStarterBinaryReEvalCorpus();
		expect(validateBinaryReEvalCorpus(corpus)).toEqual([]);

		for (const task of corpus) {
			expect(task.expectedCommands.length).toBeGreaterThan(0);
			expect(
				task.expectedCommands.some((command) => command === "bash" || command === "gdb" || command === "objdump"),
			).toBe(true);
			if (task.lane === "chain") {
				expect(task.requiredBugChainLength).toBeGreaterThanOrEqual(3);
				expect(task.requiredBugClasses?.length).toBeGreaterThanOrEqual(task.requiredBugChainLength ?? 0);
				expect(task.expected?.exploitability).toBe("chain");
			}
		}
	});
});
