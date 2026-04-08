import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = process.cwd();
const FIXTURE_DIR = join(PACKAGE_ROOT, "test", "fixtures", "pire-evals");

describe("pire eval cli consistency checks", () => {
	test("includes scenario task issues in case and suite issue summaries", async () => {
		const result = await execFileAsync(
			"npx",
			[
				"tsx",
				"./src/pire-eval-cli.ts",
				"--suite",
				join(FIXTURE_DIR, "deep-scenario-suite.json"),
				"--cases-dir",
				join(FIXTURE_DIR, "deep-scenario-cases"),
				"--json",
			],
			{
				cwd: PACKAGE_ROOT,
			},
		);

		const parsed = JSON.parse(result.stdout) as {
			scores: Array<{ caseName: string; issues: string[] }>;
			suite: { averageIssues: number };
		};

		const byCaseName = new Map(parsed.scores.map((score) => [score.caseName, score] as const));
		expect(parsed.suite.averageIssues).toBeGreaterThan(0);
		expect(byCaseName.get("plugin-host-proof-gap")?.issues).toContain(
			"high-impact exploitability claims require proof to score credibly",
		);
		expect(byCaseName.get("plugin-host-proof-gap")?.issues).toContain(
			"ctf task requires captured flag evidence for FLAG_PLUGIN_HOST_ESCAPE",
		);
		expect(byCaseName.get("plugin-host-near-miss")?.issues).toContain("missing required objectives: sandbox-escape");
	});

	test("flags expected-run drift when requested", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "pire-eval-expected-run-check-"));
		const casesDir = join(tempDir, "deep-scenario-cases");
		const caseDir = join(casesDir, "plugin-host-proof-gap");

		await cp(join(FIXTURE_DIR, "deep-scenario-cases"), casesDir, { recursive: true });

		const expectedRunPath = join(caseDir, "expected-run.json");
		const expectedRun = JSON.parse(await readFile(expectedRunPath, "utf-8")) as {
			runId: string;
		};
		expectedRun.runId = "mismatched-run-id";
		await writeFile(expectedRunPath, `${JSON.stringify(expectedRun, null, 2)}\n`, "utf-8");

		const result = await execFileAsync(
			"npx",
			[
				"tsx",
				"./src/pire-eval-cli.ts",
				"--suite",
				join(FIXTURE_DIR, "deep-scenario-suite.json"),
				"--cases-dir",
				casesDir,
				"--check-expected-runs",
				"--json",
			],
			{
				cwd: PACKAGE_ROOT,
			},
		);

		const parsed = JSON.parse(result.stdout) as {
			scores: Array<{ caseName: string; issues: string[] }>;
		};

		const byCaseName = new Map(parsed.scores.map((score) => [score.caseName, score] as const));
		expect(byCaseName.get("plugin-host-proof-gap")?.issues).toContain(
			"expected-run.json does not match extracted run bundle for plugin-host-proof-gap",
		);
	});
});
