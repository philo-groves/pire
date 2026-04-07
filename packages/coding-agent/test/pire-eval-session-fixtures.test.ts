import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parsePireEvalRunBundle } from "../src/core/pire/eval-bundles.js";
import { createPireEvalRunBundleFromBindingFile, scorePireEvalSessionFromFiles } from "../src/core/pire/eval-runner.js";

const FIXTURE_DIR = join(process.cwd(), "test", "fixtures", "pire-evals");
const SUITE_PATH = join(FIXTURE_DIR, "binary-re-starter-suite.json");

async function loadExpectedRun(caseName: string) {
	return parsePireEvalRunBundle(
		await readFile(join(FIXTURE_DIR, "session-cases", caseName, "expected-run.json"), "utf-8"),
	);
}

describe("pire eval session fixtures", () => {
	test("extracts stable run bundles from confirmed and candidate binary RE fixture sessions", async () => {
		for (const caseName of ["heap-disasm-confirmed", "toctou-candidate"]) {
			const cwd = join(FIXTURE_DIR, "session-cases", caseName);
			const result = await createPireEvalRunBundleFromBindingFile({
				cwd,
				suitePath: SUITE_PATH,
				bindingsPath: join(cwd, "bindings.json"),
			});

			expect(result.run).toEqual(await loadExpectedRun(caseName));
		}
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
});
