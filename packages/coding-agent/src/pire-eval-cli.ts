#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import process from "node:process";
import { scorePireEvalSessionFromFiles } from "./core/pire/eval-runner.js";

interface PireEvalCliArgs {
	suitePath?: string;
	casesDir?: string;
	baselinePath?: string;
	baselines: PireEvalBaselineInput[];
	enforce?: boolean;
	json?: boolean;
	reportPath?: string;
}

interface PireEvalBaselineInput {
	name: string;
	path: string;
}

interface PireEvalCaseExpectation {
	minNormalized?: number;
	maxIssues?: number;
	minRank?: number;
	maxRank?: number;
	maxNormalizedDropByBaseline?: Record<string, number>;
	maxIssuesIncreaseByBaseline?: Record<string, number>;
}

interface PireEvalSuiteExpectation {
	minAverageNormalized?: number;
	maxAverageIssues?: number;
	maxRegressions?: number;
	minCases?: number;
	maxCases?: number;
	maxAverageNormalizedDropByBaseline?: Record<string, number>;
	maxAverageIssuesIncreaseByBaseline?: Record<string, number>;
}

interface PireEvalCaseDefinition {
	title?: string;
	expectation?: PireEvalCaseExpectation;
	severityThresholds?: PireEvalDeltaSeverityThresholds;
}

interface PireEvalSuiteDefinition {
	title?: string;
	expectation?: PireEvalSuiteExpectation;
	severityThresholds?: PireEvalDeltaSeverityThresholds;
}

interface PireEvalCaseScore {
	caseName: string;
	runId: string;
	earned: number;
	max: number;
	normalized: number;
	scoredTasks: number;
	missingTasks: number;
	issues: string[];
	expectation?: PireEvalCaseExpectation;
	severityThresholds?: PireEvalDeltaSeverityThresholds;
	regressions: string[];
	baselines?: PireEvalCaseBaseline[];
}

interface PireEvalSuiteSummary {
	cases: number;
	averageNormalized: number;
	averageIssues: number;
	regressions: string[];
	expectation?: PireEvalSuiteExpectation;
	severityThresholds?: PireEvalDeltaSeverityThresholds;
	baselines?: PireEvalSuiteBaseline[];
}

interface PireEvalCollectedScores {
	scores: PireEvalCaseScore[];
	suite: PireEvalSuiteSummary;
}

interface PireEvalCaseBaseline {
	name: string;
	normalizedDelta: number;
	issuesDelta: number;
	baselineRunId: string;
	severity: PireEvalDeltaSeverity;
}

interface PireEvalSuiteBaseline {
	name: string;
	averageNormalizedDelta: number;
	averageIssuesDelta: number;
	baselineCases: number;
	severity: PireEvalDeltaSeverity;
}

type PireEvalDeltaSeverity = "none" | "notice" | "warning" | "critical";

interface PireEvalDeltaSeverityThresholds {
	noticeScoreDrop?: number;
	warningScoreDrop?: number;
	criticalScoreDrop?: number;
	noticeIssuesIncrease?: number;
	warningIssuesIncrease?: number;
	criticalIssuesIncrease?: number;
}

const DEFAULT_SEVERITY_THRESHOLDS: Required<PireEvalDeltaSeverityThresholds> = {
	noticeScoreDrop: 0.03,
	warningScoreDrop: 0.1,
	criticalScoreDrop: 0.2,
	noticeIssuesIncrease: 1,
	warningIssuesIncrease: 2,
	criticalIssuesIncrease: 3,
};

function printHelp(): void {
	process.stdout.write(`pire-evals - score binary RE eval session directories

Usage:
  pire-evals --suite <suite.json> --cases-dir <dir> [--baseline <report.json>|name=report.json>]... [--enforce] [--json] [--report <path>]

Options:
  --suite <path>      Path to a Pire eval task suite JSON file
  --cases-dir <path>  Directory containing case subdirectories with bindings.json and .pire state
  --baseline <arg>    Prior JSON report from pire-evals for score deltas; use name=path for multiple named baselines
  --enforce           Exit non-zero when a case misses its expectation metadata
  --json              Emit JSON instead of a text leaderboard
  --report <path>     Write a report artifact (.md, .json, or .jsonl)
  --help              Show this help
`);
}

function parseArgs(argv: string[]): PireEvalCliArgs {
	const args: PireEvalCliArgs = {
		baselines: [],
	};

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--suite" && index + 1 < argv.length) {
			args.suitePath = argv[++index];
		} else if (arg === "--cases-dir" && index + 1 < argv.length) {
			args.casesDir = argv[++index];
		} else if (arg === "--baseline" && index + 1 < argv.length) {
			const value = argv[++index];
			const separatorIndex = value.indexOf("=");
			if (separatorIndex === -1) {
				args.baselinePath = value;
				args.baselines.push({ name: "baseline", path: value });
			} else {
				const name = value.slice(0, separatorIndex).trim();
				const path = value.slice(separatorIndex + 1).trim();
				if (!name || !path) {
					throw new Error(`invalid baseline spec: ${value}`);
				}
				args.baselines.push({ name, path });
			}
		} else if (arg === "--enforce") {
			args.enforce = true;
		} else if (arg === "--json") {
			args.json = true;
		} else if (arg === "--report" && index + 1 < argv.length) {
			args.reportPath = argv[++index];
		} else if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		} else {
			throw new Error(`unknown option: ${arg}`);
		}
	}

	return args;
}

function formatSignedDelta(value: number, digits = 2): string {
	const rounded = value.toFixed(digits);
	return value > 0 ? `+${rounded}` : rounded;
}

function resolveSeverityThresholds(
	thresholds?: PireEvalDeltaSeverityThresholds,
): Required<PireEvalDeltaSeverityThresholds> {
	return {
		noticeScoreDrop: thresholds?.noticeScoreDrop ?? DEFAULT_SEVERITY_THRESHOLDS.noticeScoreDrop,
		warningScoreDrop: thresholds?.warningScoreDrop ?? DEFAULT_SEVERITY_THRESHOLDS.warningScoreDrop,
		criticalScoreDrop: thresholds?.criticalScoreDrop ?? DEFAULT_SEVERITY_THRESHOLDS.criticalScoreDrop,
		noticeIssuesIncrease: thresholds?.noticeIssuesIncrease ?? DEFAULT_SEVERITY_THRESHOLDS.noticeIssuesIncrease,
		warningIssuesIncrease: thresholds?.warningIssuesIncrease ?? DEFAULT_SEVERITY_THRESHOLDS.warningIssuesIncrease,
		criticalIssuesIncrease: thresholds?.criticalIssuesIncrease ?? DEFAULT_SEVERITY_THRESHOLDS.criticalIssuesIncrease,
	};
}

function classifyDeltaSeverity(
	scoreDelta: number,
	issuesDelta: number,
	thresholds?: PireEvalDeltaSeverityThresholds,
): PireEvalDeltaSeverity {
	const resolved = resolveSeverityThresholds(thresholds);
	if (scoreDelta <= -resolved.criticalScoreDrop || issuesDelta >= resolved.criticalIssuesIncrease) {
		return "critical";
	}
	if (scoreDelta <= -resolved.warningScoreDrop || issuesDelta >= resolved.warningIssuesIncrease) {
		return "warning";
	}
	if (scoreDelta <= -resolved.noticeScoreDrop || issuesDelta >= resolved.noticeIssuesIncrease) {
		return "notice";
	}
	return "none";
}

function formatBaselineSummary(baselines: PireEvalSuiteBaseline[]): string {
	return baselines
		.map(
			(baseline) =>
				`${baseline.name}: score ${formatSignedDelta(baseline.averageNormalizedDelta)}, issues ${formatSignedDelta(baseline.averageIssuesDelta)}, severity=${baseline.severity}`,
		)
		.join(" | ");
}

function formatCaseBaselineSummary(baselines: PireEvalCaseBaseline[]): string {
	return baselines
		.map(
			(baseline) =>
				`${baseline.name} delta=${formatSignedDelta(baseline.normalizedDelta)}, issue-delta=${formatSignedDelta(baseline.issuesDelta)}, severity=${baseline.severity}`,
		)
		.join(" | ");
}

function parseCaseDefinition(text: string): PireEvalCaseDefinition {
	return JSON.parse(text) as PireEvalCaseDefinition;
}

function parseSuiteDefinition(text: string): PireEvalSuiteDefinition {
	return JSON.parse(text) as PireEvalSuiteDefinition;
}

async function loadCaseDefinition(path: string): Promise<PireEvalCaseDefinition | undefined> {
	try {
		return parseCaseDefinition(await readFile(path, "utf-8"));
	} catch (error) {
		const readError = error as NodeJS.ErrnoException;
		if (readError.code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}

async function loadSuiteDefinition(path: string): Promise<PireEvalSuiteDefinition | undefined> {
	try {
		return parseSuiteDefinition(await readFile(path, "utf-8"));
	} catch (error) {
		const readError = error as NodeJS.ErrnoException;
		if (readError.code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}

function collectRegressions(score: PireEvalCaseScore, rank: number): string[] {
	const expectation = score.expectation;
	if (!expectation) {
		return [];
	}

	const regressions: string[] = [];
	if (expectation.minNormalized !== undefined && score.normalized < expectation.minNormalized) {
		regressions.push(
			`normalized score ${score.normalized.toFixed(2)} fell below minimum ${expectation.minNormalized.toFixed(2)}`,
		);
	}
	if (expectation.maxIssues !== undefined && score.issues.length > expectation.maxIssues) {
		regressions.push(`issues ${score.issues.length} exceeded maximum ${expectation.maxIssues}`);
	}
	if (expectation.minRank !== undefined && rank < expectation.minRank) {
		regressions.push(`rank ${rank} was better than minimum expected rank ${expectation.minRank}`);
	}
	if (expectation.maxRank !== undefined && rank > expectation.maxRank) {
		regressions.push(`rank ${rank} exceeded maximum expected rank ${expectation.maxRank}`);
	}
	if (expectation.maxNormalizedDropByBaseline && score.baselines) {
		for (const baseline of score.baselines) {
			const maxDrop = expectation.maxNormalizedDropByBaseline[baseline.name];
			if (maxDrop !== undefined && baseline.normalizedDelta < -maxDrop) {
				regressions.push(
					`${baseline.name} normalized delta ${formatSignedDelta(baseline.normalizedDelta)} exceeded allowed drop ${formatSignedDelta(-maxDrop)}`,
				);
			}
		}
	}
	if (expectation.maxIssuesIncreaseByBaseline && score.baselines) {
		for (const baseline of score.baselines) {
			const maxIncrease = expectation.maxIssuesIncreaseByBaseline[baseline.name];
			if (maxIncrease !== undefined && baseline.issuesDelta > maxIncrease) {
				regressions.push(
					`${baseline.name} issues delta ${formatSignedDelta(baseline.issuesDelta)} exceeded allowed increase ${formatSignedDelta(maxIncrease)}`,
				);
			}
		}
	}
	return regressions;
}

function collectSuiteRegressions(
	scores: PireEvalCaseScore[],
	expectation?: PireEvalSuiteExpectation,
): PireEvalSuiteSummary {
	const cases = scores.length;
	const totalNormalized = scores.reduce((sum, score) => sum + score.normalized, 0);
	const totalIssues = scores.reduce((sum, score) => sum + score.issues.length, 0);
	const averageNormalized = cases === 0 ? 0 : totalNormalized / cases;
	const averageIssues = cases === 0 ? 0 : totalIssues / cases;
	const regressions = scores.flatMap((score) => score.regressions.map((entry) => `${score.caseName}: ${entry}`));

	if (expectation?.minAverageNormalized !== undefined && averageNormalized < expectation.minAverageNormalized) {
		regressions.push(
			`suite average normalized score ${averageNormalized.toFixed(2)} fell below minimum ${expectation.minAverageNormalized.toFixed(2)}`,
		);
	}
	if (expectation?.maxAverageIssues !== undefined && averageIssues > expectation.maxAverageIssues) {
		regressions.push(
			`suite average issues ${averageIssues.toFixed(2)} exceeded maximum ${expectation.maxAverageIssues.toFixed(2)}`,
		);
	}
	if (expectation?.maxRegressions !== undefined && regressions.length > expectation.maxRegressions) {
		regressions.push(`suite regressions ${regressions.length} exceeded maximum ${expectation.maxRegressions}`);
	}
	if (expectation?.minCases !== undefined && cases < expectation.minCases) {
		regressions.push(`suite cases ${cases} fell below minimum ${expectation.minCases}`);
	}
	if (expectation?.maxCases !== undefined && cases > expectation.maxCases) {
		regressions.push(`suite cases ${cases} exceeded maximum ${expectation.maxCases}`);
	}
	return {
		cases,
		averageNormalized,
		averageIssues,
		regressions,
		expectation,
		severityThresholds: undefined,
	};
}

function formatLeaderboard(result: PireEvalCollectedScores): string {
	const lines = [
		"Pire Eval Session Leaderboard",
		`- cases: ${result.suite.cases}`,
		`- average score: ${Math.round(result.suite.averageNormalized * 100)}%`,
		`- average issues: ${result.suite.averageIssues.toFixed(2)}`,
		`- regressions: ${result.suite.regressions.length}`,
	];
	if (result.suite.baselines && result.suite.baselines.length > 0) {
		lines.push(`- vs baselines: ${formatBaselineSummary(result.suite.baselines)}`);
	}

	for (const score of result.scores) {
		const issueSuffix = score.issues.length > 0 ? `, issues=${score.issues.length}` : "";
		const regressionSuffix = score.regressions.length > 0 ? `, regressions=${score.regressions.length}` : "";
		const baselineSuffix =
			score.baselines && score.baselines.length > 0 ? `, ${formatCaseBaselineSummary(score.baselines)}` : "";
		lines.push(
			`- ${score.caseName}: ${score.earned}/${score.max} (${Math.round(score.normalized * 100)}%), run=${score.runId}, tasks=${score.scoredTasks}, missing=${score.missingTasks}${issueSuffix}${regressionSuffix}${baselineSuffix}`,
		);
	}

	if (result.suite.regressions.length > 0) {
		lines.push("- regression details:");
		for (const regression of result.suite.regressions) {
			lines.push(`  - ${regression}`);
		}
	}

	return `${lines.join("\n")}\n`;
}

function formatMarkdownReport(result: PireEvalCollectedScores): string {
	const lines = [
		"# Pire Eval Report",
		"",
		"## Suite Summary",
		`- Cases: ${result.suite.cases}`,
		`- Average score: ${Math.round(result.suite.averageNormalized * 100)}%`,
		`- Average issues: ${result.suite.averageIssues.toFixed(2)}`,
		`- Regressions: ${result.suite.regressions.length}`,
		"",
		"## Cases",
	];
	if (result.suite.baselines && result.suite.baselines.length > 0) {
		lines.splice(
			7,
			0,
			...result.suite.baselines.map(
				(baseline) =>
					`- Vs ${baseline.name}: score delta ${formatSignedDelta(baseline.averageNormalizedDelta)}, issues delta ${formatSignedDelta(baseline.averageIssuesDelta)}, severity ${baseline.severity}`,
			),
		);
	}

	for (const score of result.scores) {
		const baselineSuffix =
			score.baselines && score.baselines.length > 0 ? `, ${formatCaseBaselineSummary(score.baselines)}` : "";
		lines.push(
			`- ${score.caseName}: ${score.earned}/${score.max} (${Math.round(score.normalized * 100)}%), run=${score.runId}, tasks=${score.scoredTasks}, missing=${score.missingTasks}, issues=${score.issues.length}, regressions=${score.regressions.length}${baselineSuffix}`,
		);
	}

	if (result.suite.regressions.length > 0) {
		lines.push("", "## Regressions");
		for (const regression of result.suite.regressions) {
			lines.push(`- ${regression}`);
		}
	}

	return `${lines.join("\n")}\n`;
}

function formatJsonlReport(result: PireEvalCollectedScores): string {
	const lines = [
		JSON.stringify({
			type: "suite",
			cases: result.suite.cases,
			averageNormalized: result.suite.averageNormalized,
			averageIssues: result.suite.averageIssues,
			regressions: result.suite.regressions,
			expectation: result.suite.expectation,
			baselines: result.suite.baselines,
		}),
	];

	for (const score of result.scores) {
		lines.push(
			JSON.stringify({
				type: "case",
				caseName: score.caseName,
				runId: score.runId,
				earned: score.earned,
				max: score.max,
				normalized: score.normalized,
				scoredTasks: score.scoredTasks,
				missingTasks: score.missingTasks,
				issues: score.issues,
				regressions: score.regressions,
				expectation: score.expectation,
				baselines: score.baselines,
			}),
		);
	}

	return `${lines.join("\n")}\n`;
}

function formatReport(result: PireEvalCollectedScores, reportPath: string): string {
	switch (extname(reportPath).toLowerCase()) {
		case ".json":
			return `${JSON.stringify(result, null, 2)}\n`;
		case ".jsonl":
			return formatJsonlReport(result);
		default:
			return formatMarkdownReport(result);
	}
}

async function writeReport(reportPath: string, result: PireEvalCollectedScores): Promise<void> {
	const targetPath = resolve(reportPath);
	await writeFile(targetPath, formatReport(result, targetPath), "utf-8");
}

function applySuiteBaselineExpectations(
	suite: PireEvalSuiteSummary,
	expectation?: PireEvalSuiteExpectation,
): PireEvalSuiteSummary {
	if (!expectation) {
		return suite;
	}

	const regressions = [...suite.regressions];
	for (const baseline of suite.baselines ?? []) {
		const maxDrop = expectation.maxAverageNormalizedDropByBaseline?.[baseline.name];
		if (maxDrop !== undefined && baseline.averageNormalizedDelta < -maxDrop) {
			regressions.push(
				`${baseline.name} average score delta ${formatSignedDelta(baseline.averageNormalizedDelta)} exceeded allowed drop ${formatSignedDelta(-maxDrop)}`,
			);
		}
		const maxIncrease = expectation.maxAverageIssuesIncreaseByBaseline?.[baseline.name];
		if (maxIncrease !== undefined && baseline.averageIssuesDelta > maxIncrease) {
			regressions.push(
				`${baseline.name} average issues delta ${formatSignedDelta(baseline.averageIssuesDelta)} exceeded allowed increase ${formatSignedDelta(maxIncrease)}`,
			);
		}
	}

	return {
		...suite,
		regressions,
	};
}

function reclassifyBaselineSeverities(result: PireEvalCollectedScores): PireEvalCollectedScores {
	return {
		scores: result.scores.map((score) => ({
			...score,
			baselines: score.baselines?.map((baseline) => ({
				...baseline,
				severity: classifyDeltaSeverity(baseline.normalizedDelta, baseline.issuesDelta, score.severityThresholds),
			})),
		})),
		suite: {
			...result.suite,
			baselines: result.suite.baselines?.map((baseline) => ({
				...baseline,
				severity: classifyDeltaSeverity(
					baseline.averageNormalizedDelta,
					baseline.averageIssuesDelta,
					result.suite.severityThresholds,
				),
			})),
		},
	};
}

function applyBaseline(
	result: PireEvalCollectedScores,
	baselineInput: PireEvalBaselineInput,
	baseline: PireEvalCollectedScores,
): PireEvalCollectedScores {
	const baselineScores = new Map(baseline.scores.map((score) => [score.caseName, score]));
	const scores = result.scores.map((score) => {
		const baselineScore = baselineScores.get(score.caseName);
		return {
			...score,
			baselines: baselineScore
				? [
						...(score.baselines ?? []),
						{
							name: baselineInput.name,
							normalizedDelta: score.normalized - baselineScore.normalized,
							issuesDelta: score.issues.length - baselineScore.issues.length,
							baselineRunId: baselineScore.runId,
							severity: classifyDeltaSeverity(
								score.normalized - baselineScore.normalized,
								score.issues.length - baselineScore.issues.length,
								score.severityThresholds,
							),
						},
					]
				: score.baselines,
		};
	});

	return {
		scores,
		suite: {
			...result.suite,
			baselines: [
				...(result.suite.baselines ?? []),
				{
					name: baselineInput.name,
					averageNormalizedDelta: result.suite.averageNormalized - baseline.suite.averageNormalized,
					averageIssuesDelta: result.suite.averageIssues - baseline.suite.averageIssues,
					baselineCases: baseline.suite.cases,
					severity: classifyDeltaSeverity(
						result.suite.averageNormalized - baseline.suite.averageNormalized,
						result.suite.averageIssues - baseline.suite.averageIssues,
						result.suite.severityThresholds,
					),
				},
			],
		},
	};
}

async function loadBaseline(path: string): Promise<PireEvalCollectedScores> {
	return JSON.parse(await readFile(resolve(path), "utf-8")) as PireEvalCollectedScores;
}

async function collectCaseScores(
	args: Required<Pick<PireEvalCliArgs, "suitePath" | "casesDir">>,
): Promise<PireEvalCollectedScores> {
	const suitePath = resolve(args.suitePath);
	const casesDir = resolve(args.casesDir);
	const entries = await readdir(casesDir, { withFileTypes: true });
	const caseDirs = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	const scores: PireEvalCaseScore[] = [];
	const suiteDefinition = await loadSuiteDefinition(join(casesDir, "cases.json"));

	for (const caseName of caseDirs) {
		const cwd = join(casesDir, caseName);
		const definition = await loadCaseDefinition(join(cwd, "case.json"));
		const result = await scorePireEvalSessionFromFiles({
			cwd,
			suitePath,
			bindingsPath: join(cwd, "bindings.json"),
		});
		scores.push({
			caseName,
			runId: result.run.runId,
			earned: result.score.earned,
			max: result.score.max,
			normalized: result.score.normalized,
			scoredTasks: result.score.taskScores.length,
			missingTasks: result.score.missingTaskIds.length,
			issues: result.score.issues,
			expectation: definition?.expectation,
			severityThresholds: definition?.severityThresholds,
			regressions: [],
		});
	}

	const rankedScores = scores.sort((left, right) => {
		if (right.normalized !== left.normalized) {
			return right.normalized - left.normalized;
		}
		return left.caseName.localeCompare(right.caseName);
	});

	for (const [index, score] of rankedScores.entries()) {
		score.regressions = collectRegressions(score, index + 1);
	}

	const suite = collectSuiteRegressions(rankedScores, suiteDefinition?.expectation);
	return {
		scores: rankedScores,
		suite: {
			...suite,
			severityThresholds: suiteDefinition?.severityThresholds,
		},
	};
}

async function main(argv: string[]): Promise<void> {
	const args = parseArgs(argv);
	if (!args.suitePath || !args.casesDir) {
		printHelp();
		throw new Error("both --suite and --cases-dir are required");
	}

	const result = await collectCaseScores({
		suitePath: args.suitePath,
		casesDir: args.casesDir,
	});
	let withBaselines = result;
	for (const baselineInput of args.baselines) {
		withBaselines = applyBaseline(withBaselines, baselineInput, await loadBaseline(baselineInput.path));
	}
	withBaselines = reclassifyBaselineSeverities(withBaselines);
	withBaselines = {
		...withBaselines,
		scores: withBaselines.scores.map((score, index) => ({
			...score,
			regressions: collectRegressions(score, index + 1),
		})),
	};
	const recomputedSuite = collectSuiteRegressions(withBaselines.scores, withBaselines.suite.expectation);
	withBaselines = {
		...withBaselines,
		suite: applySuiteBaselineExpectations(
			{
				...recomputedSuite,
				baselines: withBaselines.suite.baselines,
			},
			recomputedSuite.expectation,
		),
	};

	if (args.json) {
		process.stdout.write(`${JSON.stringify(withBaselines, null, 2)}\n`);
	} else {
		process.stdout.write(formatLeaderboard(withBaselines));
	}

	if (args.reportPath) {
		await writeReport(args.reportPath, withBaselines);
	}

	if (args.enforce && withBaselines.suite.regressions.length > 0) {
		throw new Error(
			`regression expectations failed\n${withBaselines.suite.regressions.map((entry) => `- ${entry}`).join("\n")}`,
		);
	}
}

main(process.argv.slice(2)).catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`pire-evals: ${message}\n`);
	process.exitCode = 1;
});
