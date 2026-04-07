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

		expect(corpus.every((task) => task.lane === "reverse-engineering")).toBe(true);
		expect(summary.totalTasks).toBeGreaterThanOrEqual(7);
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
	});

	test("validates the starter corpus cleanly and keeps shell-first command expectations", () => {
		const corpus = createStarterBinaryReEvalCorpus();
		expect(validateBinaryReEvalCorpus(corpus)).toEqual([]);

		for (const task of corpus) {
			expect(task.expectedCommands.length).toBeGreaterThan(0);
			expect(
				task.expectedCommands.some((command) => command === "bash" || command === "gdb" || command === "objdump"),
			).toBe(true);
		}
	});
});
