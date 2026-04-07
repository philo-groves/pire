import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
	formatPireEvalRunScoreReport,
	getPireEvalStorageDir,
	resolvePireEvalStoredArtifactPath,
	scorePireEvalRunFromFiles,
} from "../src/core/pire/eval-runner.js";

const FIXTURE_DIR = join(process.cwd(), "test", "fixtures", "pire-evals");

describe("pire eval runner", () => {
	test("loads suite and run fixtures from disk and produces a stable report", async () => {
		const result = await scorePireEvalRunFromFiles({
			suitePath: join(FIXTURE_DIR, "binary-re-starter-suite.json"),
			runPath: join(FIXTURE_DIR, "binary-re-sample-run.json"),
		});

		expect(result.suite.suiteId).toBe("pire-binary-re-starter-v1");
		expect(result.run.runId).toBe("sample-run-001");
		expect(result.score.taskScores).toHaveLength(3);
		expect(result.score.missingTaskIds.length).toBe(0);
		expect(result.score.earned).toBeGreaterThan(0);

		const report = formatPireEvalRunScoreReport(result.score);
		expect(report).toContain("Pire Eval Run Score");
		expect(report).toContain("- run: sample-run-001");
		expect(report).toContain("- scored tasks: 3");
		expect(report).toContain("- task scores:");
		expect(report).toContain("binre-disasm-001");
		expect(report).toContain("binre-heap-001");
		expect(report).toContain("binre-toctou-001");
	});

	test("resolves conventional stored eval artifact paths under .pire/session/evals", () => {
		const cwd = "/tmp/pire-project";
		expect(getPireEvalStorageDir(cwd)).toBe("/tmp/pire-project/.pire/session/evals");
		expect(
			resolvePireEvalStoredArtifactPath(cwd, {
				kind: "baselines",
				name: "last-good",
				ext: "json",
			}),
		).toBe("/tmp/pire-project/.pire/session/evals/baselines/last-good.json");
		expect(
			resolvePireEvalStoredArtifactPath(cwd, {
				kind: "reports",
				name: "nightly",
				ext: "md",
			}),
		).toBe("/tmp/pire-project/.pire/session/evals/reports/nightly.md");
	});
});
