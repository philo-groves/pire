import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parsePireEvalRunBundle } from "../src/core/pire/eval-bundles.js";
import { createPireEvalRunBundleFromBindingFile, scorePireEvalSessionFromFiles } from "../src/core/pire/eval-runner.js";

const FIXTURE_DIR = join(process.cwd(), "test", "fixtures", "pire-evals");
const SUITE_PATH = join(FIXTURE_DIR, "binary-re-starter-suite.json");
const SCENARIO_SUITE_PATH = join(FIXTURE_DIR, "scenario-suite.json");

async function loadExpectedRun(caseRoot: string, caseName: string) {
	return parsePireEvalRunBundle(await readFile(join(caseRoot, caseName, "expected-run.json"), "utf-8"));
}

describe("pire eval session fixtures", () => {
	test("extracts stable run bundles from confirmed and candidate binary RE fixture sessions", async () => {
		for (const caseName of ["heap-disasm-confirmed", "toctou-candidate"]) {
			const caseRoot = join(FIXTURE_DIR, "session-cases");
			const cwd = join(caseRoot, caseName);
			const result = await createPireEvalRunBundleFromBindingFile({
				cwd,
				suitePath: SUITE_PATH,
				bindingsPath: join(cwd, "bindings.json"),
			});

			expect(result.run).toEqual(await loadExpectedRun(caseRoot, caseName));
		}
	});

	test("extracts stable run bundles from pass, near-miss, and fail scenario fixture sessions", async () => {
		const caseRoot = join(FIXTURE_DIR, "scenario-cases");
		for (const caseName of ["renderer-rce-pass", "network-rce-near-miss", "helper-privesc-fail"]) {
			const cwd = join(caseRoot, caseName);
			const result = await createPireEvalRunBundleFromBindingFile({
				cwd,
				suitePath: SCENARIO_SUITE_PATH,
				bindingsPath: join(cwd, "bindings.json"),
			});

			expect(result.run).toEqual(await loadExpectedRun(caseRoot, caseName));
		}
	});

	test("extracts a stable improved helper scenario iteration fixture", async () => {
		const caseRoot = join(FIXTURE_DIR, "scenario-cases-iteration");
		const caseName = "helper-privesc-near-miss";
		const cwd = join(caseRoot, caseName);
		const result = await createPireEvalRunBundleFromBindingFile({
			cwd,
			suitePath: SCENARIO_SUITE_PATH,
			bindingsPath: join(cwd, "bindings.json"),
		});

		expect(result.run).toEqual(await loadExpectedRun(caseRoot, caseName));
	});

	test("scores fixture sessions directly from suite, bindings, and persisted .pire state", async () => {
		const heapCase = join(FIXTURE_DIR, "session-cases", "heap-disasm-confirmed");
		const toctouCase = join(FIXTURE_DIR, "session-cases", "toctou-candidate");

		const heapResult = await scorePireEvalSessionFromFiles({
			cwd: heapCase,
			suitePath: SUITE_PATH,
			bindingsPath: join(heapCase, "bindings.json"),
		});
		const toctouResult = await scorePireEvalSessionFromFiles({
			cwd: toctouCase,
			suitePath: SUITE_PATH,
			bindingsPath: join(toctouCase, "bindings.json"),
		});

		expect(heapResult.bindingFile.runId).toBe("heap-case-001");
		expect(heapResult.score.taskScores).toHaveLength(1);
		expect(heapResult.score.missingTaskIds.length).toBe(heapResult.suite.tasks.length - 1);
		expect(heapResult.score.issues).toContain(`missing submissions for ${heapResult.suite.tasks.length - 1} task(s)`);
		expect(heapResult.score.earned).toBeGreaterThan(toctouResult.score.earned);

		expect(toctouResult.bindingFile.runId).toBe("toctou-case-001");
		expect(toctouResult.score.taskScores).toHaveLength(1);
		expect(toctouResult.score.earned).toBeGreaterThan(0);
	});

	test("scores scenario fixture sessions into pass, near-miss, and fail order", async () => {
		const caseRoot = join(FIXTURE_DIR, "scenario-cases");
		const rendererCase = join(caseRoot, "renderer-rce-pass");
		const networkCase = join(caseRoot, "network-rce-near-miss");
		const helperCase = join(caseRoot, "helper-privesc-fail");

		const rendererResult = await scorePireEvalSessionFromFiles({
			cwd: rendererCase,
			suitePath: SCENARIO_SUITE_PATH,
			bindingsPath: join(rendererCase, "bindings.json"),
		});
		const networkResult = await scorePireEvalSessionFromFiles({
			cwd: networkCase,
			suitePath: SCENARIO_SUITE_PATH,
			bindingsPath: join(networkCase, "bindings.json"),
		});
		const helperResult = await scorePireEvalSessionFromFiles({
			cwd: helperCase,
			suitePath: SCENARIO_SUITE_PATH,
			bindingsPath: join(helperCase, "bindings.json"),
		});

		expect(rendererResult.bindingFile.runId).toBe("scenario-renderer-001");
		expect(networkResult.bindingFile.runId).toBe("scenario-network-001");
		expect(helperResult.bindingFile.runId).toBe("scenario-helper-001");
		expect(rendererResult.score.taskScores).toHaveLength(1);
		expect(networkResult.score.taskScores).toHaveLength(1);
		expect(helperResult.score.taskScores).toHaveLength(1);
		expect(rendererResult.score.earned).toBeGreaterThan(networkResult.score.earned);
		expect(networkResult.score.earned).toBeGreaterThan(helperResult.score.earned);
		expect(rendererResult.score.issues).toContain("missing submissions for 2 task(s)");
	});

	test("scores the improved helper iteration above the original fail fixture", async () => {
		const originalFailCase = join(FIXTURE_DIR, "scenario-cases", "helper-privesc-fail");
		const iterationCase = join(FIXTURE_DIR, "scenario-cases-iteration", "helper-privesc-near-miss");

		const originalFailResult = await scorePireEvalSessionFromFiles({
			cwd: originalFailCase,
			suitePath: SCENARIO_SUITE_PATH,
			bindingsPath: join(originalFailCase, "bindings.json"),
		});
		const iterationResult = await scorePireEvalSessionFromFiles({
			cwd: iterationCase,
			suitePath: SCENARIO_SUITE_PATH,
			bindingsPath: join(iterationCase, "bindings.json"),
		});

		expect(iterationResult.bindingFile.runId).toBe("scenario-helper-iteration-001");
		expect(iterationResult.score.earned).toBeGreaterThan(originalFailResult.score.earned);
		expect(iterationResult.score.taskScores[0]?.normalized).toBeGreaterThan(
			originalFailResult.score.taskScores[0]?.normalized ?? 0,
		);
	});
});
