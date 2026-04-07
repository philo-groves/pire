import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
		expect(result.stdout).toContain("- average score:");
		expect(result.stdout).toContain("- average issues:");
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
			suite: {
				cases: number;
				averageNormalized: number;
				averageIssues: number;
				regressions: string[];
			};
		};

		expect(parsed.scores).toHaveLength(2);
		expect(parsed.suite.cases).toBe(2);
		expect(parsed.suite.averageNormalized).toBeGreaterThan(0);
		expect(parsed.suite.averageIssues).toBeGreaterThan(0);
		expect(parsed.scores[0]?.caseName).toBe("heap-disasm-confirmed");
		expect(parsed.scores[1]?.caseName).toBe("toctou-candidate");
		expect(parsed.scores[0]?.normalized).toBeGreaterThanOrEqual(parsed.scores[1]?.normalized ?? 0);
		expect(parsed.suite.regressions).toEqual([]);
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

	test("fails in enforce mode when suite-level expectations regress", async () => {
		await expect(
			execFileAsync(
				"npx",
				[
					"tsx",
					"./src/pire-eval-cli.ts",
					"--suite",
					join(FIXTURE_DIR, "binary-re-starter-suite.json"),
					"--cases-dir",
					join(FIXTURE_DIR, "session-cases-suite-regression"),
					"--enforce",
				],
				{
					cwd: PACKAGE_ROOT,
				},
			),
		).rejects.toMatchObject({
			stderr: expect.stringContaining("suite average normalized score"),
		});
	});

	test("writes markdown and jsonl report artifacts for CI inspection", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "pire-eval-report-"));
		const markdownPath = join(tempDir, "report.md");
		const jsonlPath = join(tempDir, "report.jsonl");

		await execFileAsync(
			"npx",
			[
				"tsx",
				"./src/pire-eval-cli.ts",
				"--suite",
				join(FIXTURE_DIR, "binary-re-starter-suite.json"),
				"--cases-dir",
				join(FIXTURE_DIR, "session-cases"),
				"--report",
				markdownPath,
			],
			{
				cwd: PACKAGE_ROOT,
			},
		);

		await execFileAsync(
			"npx",
			[
				"tsx",
				"./src/pire-eval-cli.ts",
				"--suite",
				join(FIXTURE_DIR, "binary-re-starter-suite.json"),
				"--cases-dir",
				join(FIXTURE_DIR, "session-cases"),
				"--report",
				jsonlPath,
			],
			{
				cwd: PACKAGE_ROOT,
			},
		);

		const markdown = await readFile(markdownPath, "utf-8");
		const jsonl = await readFile(jsonlPath, "utf-8");

		expect(markdown).toContain("# Pire Eval Report");
		expect(markdown).toContain("## Suite Summary");
		expect(markdown).toContain("heap-disasm-confirmed");
		expect(markdown).toContain("toctou-candidate");

		const jsonlLines = jsonl.trim().split("\n");
		expect(jsonlLines).toHaveLength(3);
		expect(JSON.parse(jsonlLines[0] ?? "{}")).toMatchObject({ type: "suite", cases: 2 });
		expect(JSON.parse(jsonlLines[1] ?? "{}")).toMatchObject({ type: "case", caseName: "heap-disasm-confirmed" });
		expect(JSON.parse(jsonlLines[2] ?? "{}")).toMatchObject({ type: "case", caseName: "toctou-candidate" });
	});

	test("compares current results against a prior json baseline and reports deltas", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "pire-eval-baseline-"));
		const baselinePath = join(tempDir, "baseline.json");
		const reportPath = join(tempDir, "delta-report.md");

		await execFileAsync(
			"npx",
			[
				"tsx",
				"./src/pire-eval-cli.ts",
				"--suite",
				join(FIXTURE_DIR, "binary-re-starter-suite.json"),
				"--cases-dir",
				join(FIXTURE_DIR, "session-cases"),
				"--json",
				"--report",
				baselinePath,
			],
			{
				cwd: PACKAGE_ROOT,
			},
		);

		const result = await execFileAsync(
			"npx",
			[
				"tsx",
				"./src/pire-eval-cli.ts",
				"--suite",
				join(FIXTURE_DIR, "binary-re-starter-suite.json"),
				"--cases-dir",
				join(FIXTURE_DIR, "session-cases-regression"),
				"--baseline",
				baselinePath,
				"--report",
				reportPath,
			],
			{
				cwd: PACKAGE_ROOT,
			},
		);

		const report = await readFile(reportPath, "utf-8");

		expect(result.stdout).toContain("- vs baselines:");
		expect(result.stdout).toContain("baseline: score");
		expect(result.stdout).toContain("baseline delta=");
		expect(report).toContain("Vs baseline:");
		expect(report).toContain("baseline delta=");
	});

	test("supports multiple named baselines in json and markdown outputs", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "pire-eval-multi-baseline-"));
		const mainBaselinePath = join(tempDir, "main.json");
		const lastGoodBaselinePath = join(tempDir, "last-good.json");
		const reportPath = join(tempDir, "multi-baseline.md");

		await execFileAsync(
			"npx",
			[
				"tsx",
				"./src/pire-eval-cli.ts",
				"--suite",
				join(FIXTURE_DIR, "binary-re-starter-suite.json"),
				"--cases-dir",
				join(FIXTURE_DIR, "session-cases"),
				"--json",
				"--report",
				mainBaselinePath,
			],
			{
				cwd: PACKAGE_ROOT,
			},
		);

		await execFileAsync(
			"npx",
			[
				"tsx",
				"./src/pire-eval-cli.ts",
				"--suite",
				join(FIXTURE_DIR, "binary-re-starter-suite.json"),
				"--cases-dir",
				join(FIXTURE_DIR, "session-cases-regression"),
				"--json",
				"--report",
				lastGoodBaselinePath,
			],
			{
				cwd: PACKAGE_ROOT,
			},
		);

		const result = await execFileAsync(
			"npx",
			[
				"tsx",
				"./src/pire-eval-cli.ts",
				"--suite",
				join(FIXTURE_DIR, "binary-re-starter-suite.json"),
				"--cases-dir",
				join(FIXTURE_DIR, "session-cases-suite-regression"),
				"--baseline",
				`main=${mainBaselinePath}`,
				"--baseline",
				`last-good=${lastGoodBaselinePath}`,
				"--json",
				"--report",
				reportPath,
			],
			{
				cwd: PACKAGE_ROOT,
			},
		);

		const parsed = JSON.parse(result.stdout) as {
			scores: Array<{ caseName: string; baselines?: Array<{ name: string }> }>;
			suite: { baselines?: Array<{ name: string }> };
		};
		const report = await readFile(reportPath, "utf-8");

		expect(parsed.suite.baselines?.map((entry) => entry.name)).toEqual(["main", "last-good"]);
		expect(parsed.scores[0]?.baselines?.map((entry) => entry.name)).toEqual(["main", "last-good"]);
		expect(report).toContain("Vs main:");
		expect(report).toContain("Vs last-good:");
		expect(report).toContain("main delta=");
		expect(report).toContain("last-good delta=");
	});

	test("enforces maximum case drop against a named baseline", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "pire-eval-baseline-gate-"));
		const baselinePath = join(tempDir, "last-good.json");
		const gatedCasesDir = join(tempDir, "gated-cases");

		await execFileAsync(
			"npx",
			[
				"tsx",
				"./src/pire-eval-cli.ts",
				"--suite",
				join(FIXTURE_DIR, "binary-re-starter-suite.json"),
				"--cases-dir",
				join(FIXTURE_DIR, "session-cases"),
				"--json",
				"--report",
				baselinePath,
			],
			{
				cwd: PACKAGE_ROOT,
			},
		);

		await cp(join(FIXTURE_DIR, "session-cases-suite-regression"), gatedCasesDir, { recursive: true });
		await writeFile(
			join(gatedCasesDir, "cases.json"),
			`${JSON.stringify(
				{
					title: "Baseline drop gate cases",
				},
				null,
				2,
			)}\n`,
			"utf-8",
		);
		await writeFile(
			join(gatedCasesDir, "heap-disasm-confirmed", "case.json"),
			`${JSON.stringify(
				{
					title: "Confirmed heap-disassembly session",
					expectation: {
						maxNormalizedDropByBaseline: {
							"last-good": 0.05,
						},
					},
				},
				null,
				2,
			)}\n`,
			"utf-8",
		);
		await writeFile(
			join(gatedCasesDir, "heap-disasm-confirmed", "bindings.json"),
			`${JSON.stringify(
				{
					version: 1,
					suiteId: "pire-binary-re-starter-v1",
					runId: "heap-case-001",
					model: "claude-sonnet-4-5",
					notes: ["fixture session: degraded heap/disasm case"],
					bindings: [
						{
							taskId: "binre-disasm-001",
							findingId: "find-heap-001",
							exploitability: "limited",
							judgement: {
								dimensions: {
									discovery: "partial",
									classification: "miss",
									rootCause: "miss",
									proof: "miss",
									reporting: "miss",
									primitives: "miss",
								},
							},
						},
					],
				},
				null,
				2,
			)}\n`,
			"utf-8",
		);

		await expect(
			execFileAsync(
				"npx",
				[
					"tsx",
					"./src/pire-eval-cli.ts",
					"--suite",
					join(FIXTURE_DIR, "binary-re-starter-suite.json"),
					"--cases-dir",
					gatedCasesDir,
					"--baseline",
					`last-good=${baselinePath}`,
					"--enforce",
				],
				{
					cwd: PACKAGE_ROOT,
				},
			),
		).rejects.toMatchObject({
			stderr: expect.stringContaining("last-good normalized delta"),
		});
	});
});
