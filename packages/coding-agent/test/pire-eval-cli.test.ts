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
		expect(result.stdout).toContain("severity=");
		expect(report).toContain("Vs baseline:");
		expect(report).toContain("baseline delta=");
		expect(report).toContain("severity");
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
			scores: Array<{ caseName: string; baselines?: Array<{ name: string; severity: string }> }>;
			suite: { baselines?: Array<{ name: string; severity: string }> };
		};
		const report = await readFile(reportPath, "utf-8");

		expect(parsed.suite.baselines?.map((entry) => entry.name)).toEqual(["main", "last-good"]);
		expect(parsed.scores[0]?.baselines?.map((entry) => entry.name)).toEqual(["main", "last-good"]);
		expect(parsed.suite.baselines?.every((entry) => typeof entry.severity === "string")).toBe(true);
		expect(parsed.scores[0]?.baselines?.every((entry) => typeof entry.severity === "string")).toBe(true);
		expect(report).toContain("Vs main:");
		expect(report).toContain("Vs last-good:");
		expect(report).toContain("main delta=");
		expect(report).toContain("last-good delta=");
		expect(report).toContain("severity");
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

	test("uses configurable severity thresholds from case.json and cases.json", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "pire-eval-severity-config-"));
		const baselinePath = join(tempDir, "baseline.json");
		const customCasesDir = join(tempDir, "custom-severity-cases");

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

		await cp(join(FIXTURE_DIR, "session-cases-suite-regression"), customCasesDir, { recursive: true });
		await writeFile(
			join(customCasesDir, "cases.json"),
			`${JSON.stringify(
				{
					title: "Custom severity thresholds",
					expectation: {
						minAverageNormalized: 0.45,
						maxAverageIssues: 3,
						maxRegressions: 0,
						minCases: 2,
						maxCases: 2,
					},
					severityThresholds: {
						noticeScoreDrop: 0.01,
						warningScoreDrop: 1,
						criticalScoreDrop: 2,
						noticeIssuesIncrease: 1,
						warningIssuesIncrease: 10,
						criticalIssuesIncrease: 20,
					},
				},
				null,
				2,
			)}\n`,
			"utf-8",
		);
		await writeFile(
			join(customCasesDir, "heap-disasm-confirmed", "case.json"),
			`${JSON.stringify(
				{
					title: "Confirmed heap-disassembly session",
					expectation: {
						minNormalized: 0.5,
						maxIssues: 3,
						maxRank: 1,
					},
					severityThresholds: {
						noticeScoreDrop: 0.01,
						warningScoreDrop: 1,
						criticalScoreDrop: 2,
						noticeIssuesIncrease: 1,
						warningIssuesIncrease: 10,
						criticalIssuesIncrease: 20,
					},
				},
				null,
				2,
			)}\n`,
			"utf-8",
		);
		await writeFile(
			join(customCasesDir, "heap-disasm-confirmed", "bindings.json"),
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

		const result = await execFileAsync(
			"npx",
			[
				"tsx",
				"./src/pire-eval-cli.ts",
				"--suite",
				join(FIXTURE_DIR, "binary-re-starter-suite.json"),
				"--cases-dir",
				customCasesDir,
				"--baseline",
				`last-good=${baselinePath}`,
				"--json",
			],
			{
				cwd: PACKAGE_ROOT,
			},
		);

		const parsed = JSON.parse(result.stdout) as {
			scores: Array<{ caseName: string; baselines?: Array<{ name: string; severity: string }> }>;
			suite: { baselines?: Array<{ name: string; severity: string }> };
		};

		expect(parsed.suite.baselines?.find((entry) => entry.name === "last-good")?.severity).toBe("notice");
		expect(parsed.scores.find((entry) => entry.caseName === "heap-disasm-confirmed")?.baselines?.[0]?.severity).toBe(
			"notice",
		);
	});

	test("applies lane-aware default severity policies when no overrides are present", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "pire-eval-lane-defaults-"));
		const baselinePath = join(tempDir, "baseline.json");
		const defaultCasesDir = join(tempDir, "lane-default-cases");

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

		await cp(join(FIXTURE_DIR, "session-cases"), defaultCasesDir, { recursive: true });
		await writeFile(
			join(defaultCasesDir, "heap-disasm-confirmed", "bindings.json"),
			`${JSON.stringify(
				{
					version: 1,
					suiteId: "pire-binary-re-starter-v1",
					runId: "heap-case-001",
					model: "claude-sonnet-4-5",
					notes: ["fixture session: lane-default disasm severity case"],
					bindings: [
						{
							taskId: "binre-disasm-001",
							findingId: "find-heap-001",
							exploitability: "limited",
							judgement: {
								dimensions: {
									classification: "partial",
									proof: "partial",
									reporting: "miss",
									primitives: "partial",
								},
							},
							notes: ["copy-length primitive observed in disassembly"],
						},
					],
				},
				null,
				2,
			)}\n`,
			"utf-8",
		);
		await writeFile(
			join(defaultCasesDir, "toctou-candidate", "bindings.json"),
			`${JSON.stringify(
				{
					version: 1,
					suiteId: "pire-binary-re-starter-v1",
					runId: "toctou-case-001",
					notes: ["fixture session: lane-default exploitability severity case"],
					bindings: [
						{
							taskId: "binre-toctou-001",
							findingTitleIncludes: "ownership check",
							exploitability: "limited",
							judgement: {
								dimensions: {
									discovery: "partial",
									exploitability: "partial",
									reporting: "miss",
								},
							},
							notes: ["race observed but exploit remains partial"],
						},
					],
				},
				null,
				2,
			)}\n`,
			"utf-8",
		);

		const result = await execFileAsync(
			"npx",
			[
				"tsx",
				"./src/pire-eval-cli.ts",
				"--suite",
				join(FIXTURE_DIR, "binary-re-starter-suite.json"),
				"--cases-dir",
				defaultCasesDir,
				"--baseline",
				`last-good=${baselinePath}`,
				"--json",
			],
			{
				cwd: PACKAGE_ROOT,
			},
		);

		const parsed = JSON.parse(result.stdout) as {
			scores: Array<{ caseName: string; baselines?: Array<{ name: string; severity: string }> }>;
		};

		expect(parsed.scores.find((entry) => entry.caseName === "heap-disasm-confirmed")?.baselines?.[0]?.severity).toBe(
			"warning",
		);
		expect(parsed.scores.find((entry) => entry.caseName === "toctou-candidate")?.baselines?.[0]?.severity).toBe(
			"notice",
		);
	});

	test("persists named reports and baselines under .pire/session/evals and reloads @baseline refs", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "pire-eval-storage-layout-"));
		const suitePath = join(FIXTURE_DIR, "binary-re-starter-suite.json");
		const casesPath = join(FIXTURE_DIR, "session-cases");

		await execFileAsync(
			"npx",
			[
				"tsx",
				join(PACKAGE_ROOT, "src/pire-eval-cli.ts"),
				"--suite",
				suitePath,
				"--cases-dir",
				casesPath,
				"--save-report",
				"main",
				"--save-baseline",
				"last-good",
			],
			{
				cwd: tempDir,
			},
		);

		const storedReportJson = join(tempDir, ".pire", "session", "evals", "reports", "main.json");
		const storedReportMd = join(tempDir, ".pire", "session", "evals", "reports", "main.md");
		const storedBaseline = join(tempDir, ".pire", "session", "evals", "baselines", "last-good.json");

		expect(await readFile(storedReportJson, "utf-8")).toContain('"suite"');
		expect(await readFile(storedReportMd, "utf-8")).toContain("# Pire Eval Report");
		expect(await readFile(storedBaseline, "utf-8")).toContain('"scores"');

		const degradedCasesDir = join(tempDir, "degraded-cases");
		await cp(join(FIXTURE_DIR, "session-cases-suite-regression"), degradedCasesDir, { recursive: true });

		const rerun = await execFileAsync(
			"npx",
			[
				"tsx",
				join(PACKAGE_ROOT, "src/pire-eval-cli.ts"),
				"--suite",
				suitePath,
				"--cases-dir",
				degradedCasesDir,
				"--baseline",
				"@last-good",
				"--save-report",
				"regression",
			],
			{
				cwd: tempDir,
			},
		);

		expect(rerun.stdout).toContain("- vs baselines:");
		expect(
			await readFile(join(tempDir, ".pire", "session", "evals", "reports", "regression.json"), "utf-8"),
		).toContain("last-good");
		expect(await readFile(join(tempDir, ".pire", "session", "evals", "reports", "regression.md"), "utf-8")).toContain(
			"Vs last-good",
		);
	});

	test("promotes a named baseline only when the run has no regressions", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "pire-eval-promote-clean-"));
		const suitePath = join(FIXTURE_DIR, "binary-re-starter-suite.json");
		const casesPath = join(FIXTURE_DIR, "session-cases");

		await execFileAsync(
			"npx",
			[
				"tsx",
				join(PACKAGE_ROOT, "src/pire-eval-cli.ts"),
				"--suite",
				suitePath,
				"--cases-dir",
				casesPath,
				"--promote-baseline",
				"last-good",
			],
			{
				cwd: tempDir,
			},
		);

		expect(
			await readFile(join(tempDir, ".pire", "session", "evals", "baselines", "last-good.json"), "utf-8"),
		).toContain('"scores"');
	});

	test("promotes a named report alias only when the run has no regressions", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "pire-eval-promote-report-clean-"));
		const suitePath = join(FIXTURE_DIR, "binary-re-starter-suite.json");
		const casesPath = join(FIXTURE_DIR, "session-cases");

		await execFileAsync(
			"npx",
			[
				"tsx",
				join(PACKAGE_ROOT, "src/pire-eval-cli.ts"),
				"--suite",
				suitePath,
				"--cases-dir",
				casesPath,
				"--promote-report",
				"main",
			],
			{
				cwd: tempDir,
			},
		);

		expect(await readFile(join(tempDir, ".pire", "session", "evals", "reports", "main.json"), "utf-8")).toContain(
			'"suite"',
		);
		expect(await readFile(join(tempDir, ".pire", "session", "evals", "reports", "main.md"), "utf-8")).toContain(
			"# Pire Eval Report",
		);
	});

	test("refuses to promote a named baseline when regressions are present", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "pire-eval-promote-regression-"));
		const suitePath = join(FIXTURE_DIR, "binary-re-starter-suite.json");
		const cleanCasesPath = join(FIXTURE_DIR, "session-cases");
		const regressionCasesPath = join(FIXTURE_DIR, "session-cases-suite-regression");
		const baselinePath = join(tempDir, ".pire", "session", "evals", "baselines", "last-good.json");

		await execFileAsync(
			"npx",
			[
				"tsx",
				join(PACKAGE_ROOT, "src/pire-eval-cli.ts"),
				"--suite",
				suitePath,
				"--cases-dir",
				cleanCasesPath,
				"--promote-baseline",
				"last-good",
			],
			{
				cwd: tempDir,
			},
		);

		const originalBaseline = await readFile(baselinePath, "utf-8");

		await expect(
			execFileAsync(
				"npx",
				[
					"tsx",
					join(PACKAGE_ROOT, "src/pire-eval-cli.ts"),
					"--suite",
					suitePath,
					"--cases-dir",
					regressionCasesPath,
					"--promote-baseline",
					"last-good",
				],
				{
					cwd: tempDir,
				},
			),
		).rejects.toMatchObject({
			stderr: expect.stringContaining("cannot promote eval artifacts while regressions are present"),
		});

		expect(await readFile(baselinePath, "utf-8")).toBe(originalBaseline);
	});

	test("refuses to promote a named report alias when regressions are present", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "pire-eval-promote-report-regression-"));
		const suitePath = join(FIXTURE_DIR, "binary-re-starter-suite.json");
		const cleanCasesPath = join(FIXTURE_DIR, "session-cases");
		const regressionCasesPath = join(FIXTURE_DIR, "session-cases-suite-regression");
		const reportJsonPath = join(tempDir, ".pire", "session", "evals", "reports", "main.json");
		const reportMarkdownPath = join(tempDir, ".pire", "session", "evals", "reports", "main.md");

		await execFileAsync(
			"npx",
			[
				"tsx",
				join(PACKAGE_ROOT, "src/pire-eval-cli.ts"),
				"--suite",
				suitePath,
				"--cases-dir",
				cleanCasesPath,
				"--promote-report",
				"main",
			],
			{
				cwd: tempDir,
			},
		);

		const originalJsonReport = await readFile(reportJsonPath, "utf-8");
		const originalMarkdownReport = await readFile(reportMarkdownPath, "utf-8");

		await expect(
			execFileAsync(
				"npx",
				[
					"tsx",
					join(PACKAGE_ROOT, "src/pire-eval-cli.ts"),
					"--suite",
					suitePath,
					"--cases-dir",
					regressionCasesPath,
					"--promote-report",
					"main",
				],
				{
					cwd: tempDir,
				},
			),
		).rejects.toMatchObject({
			stderr: expect.stringContaining("cannot promote eval artifacts while regressions are present"),
		});

		expect(await readFile(reportJsonPath, "utf-8")).toBe(originalJsonReport);
		expect(await readFile(reportMarkdownPath, "utf-8")).toBe(originalMarkdownReport);
	});
});
