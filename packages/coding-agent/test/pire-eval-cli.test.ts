import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = process.cwd();
const FIXTURE_DIR = join(PACKAGE_ROOT, "test", "fixtures", "pire-evals");

describe("pire eval cli", () => {
	test("scores all fixture session cases and prints a leaderboard", async () => {
		const result = await execFileAsync(
			"npx",
			[
				"tsx",
				"./src/pire-eval-cli.ts",
				"--suite",
				join(FIXTURE_DIR, "binary-re-starter-suite.json"),
				"--cases-dir",
				join(FIXTURE_DIR, "session-cases"),
			],
			{
				cwd: PACKAGE_ROOT,
			},
		);

		expect(result.stdout).toContain("Pire Eval Session Leaderboard");
		expect(result.stdout).toContain("- cases: 2");
		expect(result.stdout).toContain("heap-disasm-confirmed");
		expect(result.stdout).toContain("toctou-candidate");
		expect(result.stdout).toContain("run=heap-case-001");
		expect(result.stdout).toContain("run=toctou-case-001");
		expect(result.stdout).toContain("- regressions: 0");
	});

	test("emits JSON output for downstream harness processing", async () => {
		const result = await execFileAsync(
			"npx",
			[
				"tsx",
				"./src/pire-eval-cli.ts",
				"--suite",
				join(FIXTURE_DIR, "binary-re-starter-suite.json"),
				"--cases-dir",
				join(FIXTURE_DIR, "session-cases"),
				"--json",
			],
			{
				cwd: PACKAGE_ROOT,
			},
		);

		const parsed = JSON.parse(result.stdout) as {
			scores: Array<{ caseName: string; runId: string; normalized: number; regressions: string[] }>;
			regressions: string[];
		};

		expect(parsed.scores).toHaveLength(2);
		expect(parsed.scores[0]?.caseName).toBe("heap-disasm-confirmed");
		expect(parsed.scores[1]?.caseName).toBe("toctou-candidate");
		expect(parsed.scores[0]?.normalized).toBeGreaterThanOrEqual(parsed.scores[1]?.normalized ?? 0);
		expect(parsed.regressions).toEqual([]);
		expect(parsed.scores.every((score) => score.regressions.length === 0)).toBe(true);
	});

	test("fails in enforce mode when a case misses expectation metadata", async () => {
		await expect(
			execFileAsync(
				"npx",
				[
					"tsx",
					"./src/pire-eval-cli.ts",
					"--suite",
					join(FIXTURE_DIR, "binary-re-starter-suite.json"),
					"--cases-dir",
					join(FIXTURE_DIR, "session-cases-regression"),
					"--enforce",
				],
				{
					cwd: PACKAGE_ROOT,
				},
			),
		).rejects.toMatchObject({
			stderr: expect.stringContaining("regression expectations failed"),
		});
	});
});
