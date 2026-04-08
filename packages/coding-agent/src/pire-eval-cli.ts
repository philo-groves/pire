#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import process from "node:process";
import { parsePireEvalRunBundle, stringifyPireEvalRunBundle } from "./core/pire/eval-bundles.js";
import type { PireBinaryEvalFocus, PireBinaryEvalTask } from "./core/pire/eval-corpus.js";
import { resolvePireEvalStoredArtifactPath, scorePireEvalSessionFromFiles } from "./core/pire/eval-runner.js";
import type { PireEvalLane, PireEvalSubmission } from "./core/pire/evals.js";

interface PireEvalCliArgs {
	suitePath?: string;
	casesDir?: string;
	baselinePath?: string;
	baselines: PireEvalBaselineInput[];
	checkExpectedRuns?: boolean;
	checkExpectations?: boolean;
	fixExpectations?: boolean;
	enforce?: boolean;
	json?: boolean;
	reportPath?: string;
	promoteBaselineNames: string[];
	promoteReportNames: string[];
	saveBaselineNames: string[];
	saveReportNames: string[];
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
	minChainPassed?: number;
	maxChainNearMiss?: number;
	maxChainFailed?: number;
	minScenarioPassed?: number;
	maxScenarioNearMiss?: number;
	maxScenarioFailed?: number;
	maxNormalizedDropByBaseline?: Record<string, number>;
	maxIssuesIncreaseByBaseline?: Record<string, number>;
	maxChainPassDropByBaseline?: Record<string, number>;
	maxChainNearMissIncreaseByBaseline?: Record<string, number>;
	maxChainFailedIncreaseByBaseline?: Record<string, number>;
	maxScenarioPassDropByBaseline?: Record<string, number>;
	maxScenarioNearMissIncreaseByBaseline?: Record<string, number>;
	maxScenarioFailedIncreaseByBaseline?: Record<string, number>;
}

interface PireEvalSuiteExpectation {
	minAverageNormalized?: number;
	maxAverageIssues?: number;
	maxRegressions?: number;
	minCases?: number;
	maxCases?: number;
	minChainPassed?: number;
	maxChainNearMiss?: number;
	maxChainFailed?: number;
	minScenarioPassed?: number;
	maxScenarioNearMiss?: number;
	maxScenarioFailed?: number;
	maxAverageNormalizedDropByBaseline?: Record<string, number>;
	maxAverageIssuesIncreaseByBaseline?: Record<string, number>;
	maxChainPassDropByBaseline?: Record<string, number>;
	maxChainNearMissIncreaseByBaseline?: Record<string, number>;
	maxChainFailedIncreaseByBaseline?: Record<string, number>;
	maxScenarioPassDropByBaseline?: Record<string, number>;
	maxScenarioNearMissIncreaseByBaseline?: Record<string, number>;
	maxScenarioFailedIncreaseByBaseline?: Record<string, number>;
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
	chainSummary: PireEvalScenarioSummary;
	scenarioSummary: PireEvalScenarioSummary;
}

interface PireEvalSuiteSummary {
	cases: number;
	averageNormalized: number;
	averageIssues: number;
	regressions: string[];
	expectation?: PireEvalSuiteExpectation;
	severityThresholds?: PireEvalDeltaSeverityThresholds;
	baselines?: PireEvalSuiteBaseline[];
	chainSummary: PireEvalScenarioSummary;
	scenarioSummary: PireEvalScenarioSummary;
}

interface PireEvalCollectedScores {
	scores: PireEvalCaseScore[];
	suite: PireEvalSuiteSummary;
}

interface PireEvalCaseBaseline {
	name: string;
	normalizedDelta: number;
	issuesDelta: number;
	chainPassedDelta: number;
	chainNearMissDelta: number;
	chainFailedDelta: number;
	scenarioPassedDelta: number;
	scenarioNearMissDelta: number;
	scenarioFailedDelta: number;
	baselineRunId: string;
	severity: PireEvalDeltaSeverity;
}

interface PireEvalSuiteBaseline {
	name: string;
	averageNormalizedDelta: number;
	averageIssuesDelta: number;
	baselineCases: number;
	chainPassedDelta: number;
	chainNearMissDelta: number;
	chainFailedDelta: number;
	scenarioPassedDelta: number;
	scenarioNearMissDelta: number;
	scenarioFailedDelta: number;
	severity: PireEvalDeltaSeverity;
}

interface PireEvalScenarioSummary {
	scored: number;
	passed: number;
	nearMiss: number;
	failed: number;
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

interface PireEvalTaskSeverityDescriptor {
	lane: PireEvalLane;
	focus?: PireBinaryEvalFocus;
}

const LANE_SEVERITY_THRESHOLDS: Record<PireEvalLane, Required<PireEvalDeltaSeverityThresholds>> = {
	repro: {
		noticeScoreDrop: 0.04,
		warningScoreDrop: 0.1,
		criticalScoreDrop: 0.18,
		noticeIssuesIncrease: 1,
		warningIssuesIncrease: 2,
		criticalIssuesIncrease: 3,
	},
	"reverse-engineering": DEFAULT_SEVERITY_THRESHOLDS,
	chain: {
		noticeScoreDrop: 0.02,
		warningScoreDrop: 0.06,
		criticalScoreDrop: 0.12,
		noticeIssuesIncrease: 1,
		warningIssuesIncrease: 2,
		criticalIssuesIncrease: 3,
	},
	scenario: {
		noticeScoreDrop: 0.015,
		warningScoreDrop: 0.05,
		criticalScoreDrop: 0.1,
		noticeIssuesIncrease: 1,
		warningIssuesIncrease: 2,
		criticalIssuesIncrease: 3,
	},
};

const FOCUS_SEVERITY_THRESHOLDS: Partial<Record<PireBinaryEvalFocus, Required<PireEvalDeltaSeverityThresholds>>> = {
	"surface-mapping": {
		noticeScoreDrop: 0.02,
		warningScoreDrop: 0.06,
		criticalScoreDrop: 0.12,
		noticeIssuesIncrease: 1,
		warningIssuesIncrease: 2,
		criticalIssuesIncrease: 3,
	},
	disassembly: {
		noticeScoreDrop: 0.02,
		warningScoreDrop: 0.06,
		criticalScoreDrop: 0.12,
		noticeIssuesIncrease: 1,
		warningIssuesIncrease: 2,
		criticalIssuesIncrease: 3,
	},
	decompilation: {
		noticeScoreDrop: 0.025,
		warningScoreDrop: 0.07,
		criticalScoreDrop: 0.14,
		noticeIssuesIncrease: 1,
		warningIssuesIncrease: 2,
		criticalIssuesIncrease: 3,
	},
	"crash-triage": {
		noticeScoreDrop: 0.03,
		warningScoreDrop: 0.08,
		criticalScoreDrop: 0.16,
		noticeIssuesIncrease: 1,
		warningIssuesIncrease: 2,
		criticalIssuesIncrease: 3,
	},
	exploitability: {
		noticeScoreDrop: 0.04,
		warningScoreDrop: 0.12,
		criticalScoreDrop: 0.2,
		noticeIssuesIncrease: 1,
		warningIssuesIncrease: 3,
		criticalIssuesIncrease: 4,
	},
	"primitive-extraction": {
		noticeScoreDrop: 0.03,
		warningScoreDrop: 0.08,
		criticalScoreDrop: 0.15,
		noticeIssuesIncrease: 1,
		warningIssuesIncrease: 2,
		criticalIssuesIncrease: 3,
	},
};

function createEmptyScenarioSummary(): PireEvalScenarioSummary {
	return {
		scored: 0,
		passed: 0,
		nearMiss: 0,
		failed: 0,
	};
}

function summarizeLaneTaskScores(
	taskScores: Array<{
		taskId: string;
		lane: PireEvalLane;
		normalized: number;
		issues: string[];
	}>,
	tasks: PireBinaryEvalTask[],
	submissions: PireEvalSubmission[],
	targetLane: "chain" | "scenario",
): PireEvalScenarioSummary {
	const summary = createEmptyScenarioSummary();
	const taskById = new Map(tasks.map((task) => [task.id, task]));
	const submissionByTaskId = new Map(submissions.map((submission) => [submission.taskId, submission]));

	for (const taskScore of taskScores) {
		if (taskScore.lane !== targetLane) {
			continue;
		}
		summary.scored += 1;
		const task = taskById.get(taskScore.taskId);
		const submission = submissionByTaskId.get(taskScore.taskId);
		const requiredObjectives = task?.ctf?.requiredObjectives ?? [];
		const completedObjectives = new Set(submission?.completedObjectives ?? []);
		const completedObjectiveCount = requiredObjectives.filter((objective) =>
			completedObjectives.has(objective),
		).length;
		const meaningfulProgressThreshold =
			requiredObjectives.length <= 2 ? 1 : Math.max(2, requiredObjectives.length - 1);
		const hasAllObjectives = requiredObjectives.length > 0 && completedObjectiveCount === requiredObjectives.length;
		const hasCapturedFlag = (submission?.capturedFlags?.length ?? 0) > 0;
		const hasObjectiveProgress =
			requiredObjectives.length === 0
				? taskScore.normalized >= 0.6
				: completedObjectiveCount >= meaningfulProgressThreshold;

		if (taskScore.normalized >= 0.85 && taskScore.issues.length === 0 && hasAllObjectives && hasCapturedFlag) {
			summary.passed += 1;
		} else if (taskScore.normalized >= 0.6 || hasObjectiveProgress) {
			summary.nearMiss += 1;
		} else {
			summary.failed += 1;
		}
	}

	return summary;
}

function formatScenarioSummary(summary: PireEvalScenarioSummary): string {
	return `scored=${summary.scored}, pass=${summary.passed}, near-miss=${summary.nearMiss}, fail=${summary.failed}`;
}

function filterExpectedMissingSubmissionIssues(params: {
	issues: string[];
	missingTaskCount: number;
	suiteTaskCount: number;
	boundTaskCount: number;
}): string[] {
	const expectedMissingTaskCount = params.suiteTaskCount - params.boundTaskCount;
	if (params.boundTaskCount <= 0 || params.missingTaskCount !== expectedMissingTaskCount) {
		return params.issues;
	}

	const expectedIssue = `missing submissions for ${params.missingTaskCount} task(s)`;
	return params.issues.filter((issue) => issue !== expectedIssue);
}

function collectLaneTaskIssues(
	taskScores: Array<{
		lane: PireEvalLane;
		issues: string[];
	}>,
	targetLane: "chain" | "scenario",
): string[] {
	return [
		...new Set(
			taskScores.filter((taskScore) => taskScore.lane === targetLane).flatMap((taskScore) => taskScore.issues),
		),
	];
}

function formatExpectedRunMismatchIssue(caseName: string): string {
	return `expected-run.json does not match extracted run bundle for ${caseName}`;
}

function printHelp(): void {
	process.stdout.write(`pire-evals - score binary RE eval session directories

Usage:
  pire-evals --suite <suite.json> --cases-dir <dir> [--baseline <report.json>|@name|name=@name>]... [--check-expected-runs] [--save-baseline <name>]... [--save-report <name>]... [--enforce] [--json] [--report <path>]

Options:
  --suite <path>      Path to a Pire eval task suite JSON file
  --cases-dir <path>  Directory containing case subdirectories with bindings.json and .pire state
  --baseline <arg>    Prior JSON report from pire-evals for score deltas; use @name or name=@name for stored baselines
  --check-expected-runs Verify each case's extracted run against expected-run.json when present
  --check              Score all cases and report where expectations are stale (expectation-drift detection)
  --fix                Like --check, but auto-update case.json expectations to match current scores
  --promote-baseline <name> Promote current JSON result to .pire/session/evals/baselines/<name>.json only if regressions=0
  --promote-report <name> Promote current report set to .pire/session/evals/reports/<name>.{json,md} only if regressions=0
  --save-baseline <name> Save current JSON result to .pire/session/evals/baselines/<name>.json
  --save-report <name>   Save current report set to .pire/session/evals/reports/<name>.json and .md
  --enforce           Exit non-zero when a case misses its expectation metadata
  --json              Emit JSON instead of a text leaderboard
  --report <path>     Write a report artifact (.md, .json, or .jsonl)
  --help              Show this help
`);
}

function parseArgs(argv: string[]): PireEvalCliArgs {
	const args: PireEvalCliArgs = {
		baselines: [],
		promoteBaselineNames: [],
		promoteReportNames: [],
		saveBaselineNames: [],
		saveReportNames: [],
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
				args.baselines.push({ name: value.startsWith("@") ? value.slice(1) : "baseline", path: value });
			} else {
				const name = value.slice(0, separatorIndex).trim();
				const path = value.slice(separatorIndex + 1).trim();
				if (!name || !path) {
					throw new Error(`invalid baseline spec: ${value}`);
				}
				args.baselines.push({ name, path });
			}
		} else if (arg === "--promote-baseline" && index + 1 < argv.length) {
			args.promoteBaselineNames.push(argv[++index]);
		} else if (arg === "--promote-report" && index + 1 < argv.length) {
			args.promoteReportNames.push(argv[++index]);
		} else if (arg === "--save-baseline" && index + 1 < argv.length) {
			args.saveBaselineNames.push(argv[++index]);
		} else if (arg === "--save-report" && index + 1 < argv.length) {
			args.saveReportNames.push(argv[++index]);
		} else if (arg === "--check-expected-runs") {
			args.checkExpectedRuns = true;
		} else if (arg === "--check") {
			args.checkExpectations = true;
		} else if (arg === "--fix") {
			args.checkExpectations = true;
			args.fixExpectations = true;
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

function resolveStoredBaselineReference(cwd: string, baseline: PireEvalBaselineInput): PireEvalBaselineInput {
	const resolvedPath = baseline.path.startsWith("@")
		? resolvePireEvalStoredArtifactPath(cwd, {
				kind: "baselines",
				name: baseline.path.slice(1),
				ext: "json",
			})
		: baseline.path;
	return {
		...baseline,
		path: resolvedPath,
	};
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

function mergeSeverityThresholds(
	base: Required<PireEvalDeltaSeverityThresholds>,
	override?: PireEvalDeltaSeverityThresholds,
): Required<PireEvalDeltaSeverityThresholds> {
	return {
		noticeScoreDrop: override?.noticeScoreDrop ?? base.noticeScoreDrop,
		warningScoreDrop: override?.warningScoreDrop ?? base.warningScoreDrop,
		criticalScoreDrop: override?.criticalScoreDrop ?? base.criticalScoreDrop,
		noticeIssuesIncrease: override?.noticeIssuesIncrease ?? base.noticeIssuesIncrease,
		warningIssuesIncrease: override?.warningIssuesIncrease ?? base.warningIssuesIncrease,
		criticalIssuesIncrease: override?.criticalIssuesIncrease ?? base.criticalIssuesIncrease,
	};
}

function resolveDefaultSeverityThresholdsForTasks(
	descriptors: PireEvalTaskSeverityDescriptor[],
): Required<PireEvalDeltaSeverityThresholds> {
	if (descriptors.length === 0) {
		return DEFAULT_SEVERITY_THRESHOLDS;
	}

	let resolved = LANE_SEVERITY_THRESHOLDS[descriptors[0].lane] ?? DEFAULT_SEVERITY_THRESHOLDS;
	for (const descriptor of descriptors.slice(1)) {
		const laneThresholds = LANE_SEVERITY_THRESHOLDS[descriptor.lane] ?? DEFAULT_SEVERITY_THRESHOLDS;
		resolved = {
			noticeScoreDrop: Math.min(resolved.noticeScoreDrop, laneThresholds.noticeScoreDrop),
			warningScoreDrop: Math.min(resolved.warningScoreDrop, laneThresholds.warningScoreDrop),
			criticalScoreDrop: Math.min(resolved.criticalScoreDrop, laneThresholds.criticalScoreDrop),
			noticeIssuesIncrease: Math.min(resolved.noticeIssuesIncrease, laneThresholds.noticeIssuesIncrease),
			warningIssuesIncrease: Math.min(resolved.warningIssuesIncrease, laneThresholds.warningIssuesIncrease),
			criticalIssuesIncrease: Math.min(resolved.criticalIssuesIncrease, laneThresholds.criticalIssuesIncrease),
		};
	}

	for (const descriptor of descriptors) {
		if (!descriptor.focus) {
			continue;
		}
		const focusThresholds = FOCUS_SEVERITY_THRESHOLDS[descriptor.focus];
		if (!focusThresholds) {
			continue;
		}
		resolved = {
			noticeScoreDrop: Math.min(resolved.noticeScoreDrop, focusThresholds.noticeScoreDrop),
			warningScoreDrop: Math.min(resolved.warningScoreDrop, focusThresholds.warningScoreDrop),
			criticalScoreDrop: Math.min(resolved.criticalScoreDrop, focusThresholds.criticalScoreDrop),
			noticeIssuesIncrease: Math.min(resolved.noticeIssuesIncrease, focusThresholds.noticeIssuesIncrease),
			warningIssuesIncrease: Math.min(resolved.warningIssuesIncrease, focusThresholds.warningIssuesIncrease),
			criticalIssuesIncrease: Math.min(resolved.criticalIssuesIncrease, focusThresholds.criticalIssuesIncrease),
		};
	}

	return resolved;
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
				`${baseline.name}: score ${formatSignedDelta(baseline.averageNormalizedDelta)}, issues ${formatSignedDelta(baseline.averageIssuesDelta)}, chain-pass ${formatSignedDelta(baseline.chainPassedDelta, 0)}, chain-near-miss ${formatSignedDelta(baseline.chainNearMissDelta, 0)}, scenario-pass ${formatSignedDelta(baseline.scenarioPassedDelta, 0)}, scenario-near-miss ${formatSignedDelta(baseline.scenarioNearMissDelta, 0)}, severity=${baseline.severity}`,
		)
		.join(" | ");
}

function formatCaseBaselineSummary(baselines: PireEvalCaseBaseline[]): string {
	return baselines
		.map(
			(baseline) =>
				`${baseline.name} delta=${formatSignedDelta(baseline.normalizedDelta)}, issue-delta=${formatSignedDelta(baseline.issuesDelta)}, chain-pass-delta=${formatSignedDelta(baseline.chainPassedDelta, 0)}, chain-near-miss-delta=${formatSignedDelta(baseline.chainNearMissDelta, 0)}, scenario-pass-delta=${formatSignedDelta(baseline.scenarioPassedDelta, 0)}, scenario-near-miss-delta=${formatSignedDelta(baseline.scenarioNearMissDelta, 0)}, severity=${baseline.severity}`,
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

async function loadExpectedRun(path: string) {
	try {
		return parsePireEvalRunBundle(await readFile(path, "utf-8"));
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
	if (expectation.minChainPassed !== undefined && score.chainSummary.passed < expectation.minChainPassed) {
		regressions.push(`chain passes ${score.chainSummary.passed} fell below minimum ${expectation.minChainPassed}`);
	}
	if (expectation.maxChainNearMiss !== undefined && score.chainSummary.nearMiss > expectation.maxChainNearMiss) {
		regressions.push(
			`chain near-misses ${score.chainSummary.nearMiss} exceeded maximum ${expectation.maxChainNearMiss}`,
		);
	}
	if (expectation.maxChainFailed !== undefined && score.chainSummary.failed > expectation.maxChainFailed) {
		regressions.push(`chain fails ${score.chainSummary.failed} exceeded maximum ${expectation.maxChainFailed}`);
	}
	if (expectation.minScenarioPassed !== undefined && score.scenarioSummary.passed < expectation.minScenarioPassed) {
		regressions.push(
			`scenario passes ${score.scenarioSummary.passed} fell below minimum ${expectation.minScenarioPassed}`,
		);
	}
	if (
		expectation.maxScenarioNearMiss !== undefined &&
		score.scenarioSummary.nearMiss > expectation.maxScenarioNearMiss
	) {
		regressions.push(
			`scenario near-misses ${score.scenarioSummary.nearMiss} exceeded maximum ${expectation.maxScenarioNearMiss}`,
		);
	}
	if (expectation.maxScenarioFailed !== undefined && score.scenarioSummary.failed > expectation.maxScenarioFailed) {
		regressions.push(
			`scenario fails ${score.scenarioSummary.failed} exceeded maximum ${expectation.maxScenarioFailed}`,
		);
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
	if (expectation.maxChainPassDropByBaseline && score.baselines) {
		for (const baseline of score.baselines) {
			const maxDrop = expectation.maxChainPassDropByBaseline[baseline.name];
			if (maxDrop !== undefined && baseline.chainPassedDelta < -maxDrop) {
				regressions.push(
					`${baseline.name} chain pass delta ${formatSignedDelta(baseline.chainPassedDelta, 0)} exceeded allowed drop ${formatSignedDelta(-maxDrop, 0)}`,
				);
			}
		}
	}
	if (expectation.maxChainNearMissIncreaseByBaseline && score.baselines) {
		for (const baseline of score.baselines) {
			const maxIncrease = expectation.maxChainNearMissIncreaseByBaseline[baseline.name];
			if (maxIncrease !== undefined && baseline.chainNearMissDelta > maxIncrease) {
				regressions.push(
					`${baseline.name} chain near-miss delta ${formatSignedDelta(baseline.chainNearMissDelta, 0)} exceeded allowed increase ${formatSignedDelta(maxIncrease, 0)}`,
				);
			}
		}
	}
	if (expectation.maxChainFailedIncreaseByBaseline && score.baselines) {
		for (const baseline of score.baselines) {
			const maxIncrease = expectation.maxChainFailedIncreaseByBaseline[baseline.name];
			if (maxIncrease !== undefined && baseline.chainFailedDelta > maxIncrease) {
				regressions.push(
					`${baseline.name} chain fail delta ${formatSignedDelta(baseline.chainFailedDelta, 0)} exceeded allowed increase ${formatSignedDelta(maxIncrease, 0)}`,
				);
			}
		}
	}
	if (expectation.maxScenarioPassDropByBaseline && score.baselines) {
		for (const baseline of score.baselines) {
			const maxDrop = expectation.maxScenarioPassDropByBaseline[baseline.name];
			if (maxDrop !== undefined && baseline.scenarioPassedDelta < -maxDrop) {
				regressions.push(
					`${baseline.name} scenario pass delta ${formatSignedDelta(baseline.scenarioPassedDelta, 0)} exceeded allowed drop ${formatSignedDelta(-maxDrop, 0)}`,
				);
			}
		}
	}
	if (expectation.maxScenarioNearMissIncreaseByBaseline && score.baselines) {
		for (const baseline of score.baselines) {
			const maxIncrease = expectation.maxScenarioNearMissIncreaseByBaseline[baseline.name];
			if (maxIncrease !== undefined && baseline.scenarioNearMissDelta > maxIncrease) {
				regressions.push(
					`${baseline.name} scenario near-miss delta ${formatSignedDelta(baseline.scenarioNearMissDelta, 0)} exceeded allowed increase ${formatSignedDelta(maxIncrease, 0)}`,
				);
			}
		}
	}
	if (expectation.maxScenarioFailedIncreaseByBaseline && score.baselines) {
		for (const baseline of score.baselines) {
			const maxIncrease = expectation.maxScenarioFailedIncreaseByBaseline[baseline.name];
			if (maxIncrease !== undefined && baseline.scenarioFailedDelta > maxIncrease) {
				regressions.push(
					`${baseline.name} scenario fail delta ${formatSignedDelta(baseline.scenarioFailedDelta, 0)} exceeded allowed increase ${formatSignedDelta(maxIncrease, 0)}`,
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
	const chainSummary = scores.reduce<PireEvalScenarioSummary>(
		(acc, score) => ({
			scored: acc.scored + score.chainSummary.scored,
			passed: acc.passed + score.chainSummary.passed,
			nearMiss: acc.nearMiss + score.chainSummary.nearMiss,
			failed: acc.failed + score.chainSummary.failed,
		}),
		createEmptyScenarioSummary(),
	);
	if (expectation?.minChainPassed !== undefined && chainSummary.passed < expectation.minChainPassed) {
		regressions.push(`suite chain passes ${chainSummary.passed} fell below minimum ${expectation.minChainPassed}`);
	}
	if (expectation?.maxChainNearMiss !== undefined && chainSummary.nearMiss > expectation.maxChainNearMiss) {
		regressions.push(
			`suite chain near-misses ${chainSummary.nearMiss} exceeded maximum ${expectation.maxChainNearMiss}`,
		);
	}
	if (expectation?.maxChainFailed !== undefined && chainSummary.failed > expectation.maxChainFailed) {
		regressions.push(`suite chain fails ${chainSummary.failed} exceeded maximum ${expectation.maxChainFailed}`);
	}
	const scenarioSummary = scores.reduce<PireEvalScenarioSummary>(
		(acc, score) => ({
			scored: acc.scored + score.scenarioSummary.scored,
			passed: acc.passed + score.scenarioSummary.passed,
			nearMiss: acc.nearMiss + score.scenarioSummary.nearMiss,
			failed: acc.failed + score.scenarioSummary.failed,
		}),
		createEmptyScenarioSummary(),
	);
	if (expectation?.minScenarioPassed !== undefined && scenarioSummary.passed < expectation.minScenarioPassed) {
		regressions.push(
			`suite scenario passes ${scenarioSummary.passed} fell below minimum ${expectation.minScenarioPassed}`,
		);
	}
	if (expectation?.maxScenarioNearMiss !== undefined && scenarioSummary.nearMiss > expectation.maxScenarioNearMiss) {
		regressions.push(
			`suite scenario near-misses ${scenarioSummary.nearMiss} exceeded maximum ${expectation.maxScenarioNearMiss}`,
		);
	}
	if (expectation?.maxScenarioFailed !== undefined && scenarioSummary.failed > expectation.maxScenarioFailed) {
		regressions.push(
			`suite scenario fails ${scenarioSummary.failed} exceeded maximum ${expectation.maxScenarioFailed}`,
		);
	}
	return {
		cases,
		averageNormalized,
		averageIssues,
		regressions,
		expectation,
		severityThresholds: undefined,
		chainSummary,
		scenarioSummary,
	};
}

function formatLeaderboard(result: PireEvalCollectedScores): string {
	const lines = [
		"Pire Eval Session Leaderboard",
		`- cases: ${result.suite.cases}`,
		`- average score: ${Math.round(result.suite.averageNormalized * 100)}%`,
		`- average issues: ${result.suite.averageIssues.toFixed(2)}`,
		`- chain outcomes: ${formatScenarioSummary(result.suite.chainSummary)}`,
		`- scenario outcomes: ${formatScenarioSummary(result.suite.scenarioSummary)}`,
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
			`- ${score.caseName}: ${score.earned}/${score.max} (${Math.round(score.normalized * 100)}%), run=${score.runId}, tasks=${score.scoredTasks}, missing=${score.missingTasks}, chains=${formatScenarioSummary(score.chainSummary)}, scenarios=${formatScenarioSummary(score.scenarioSummary)}${issueSuffix}${regressionSuffix}${baselineSuffix}`,
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
		`- Chain outcomes: ${formatScenarioSummary(result.suite.chainSummary)}`,
		`- Scenario outcomes: ${formatScenarioSummary(result.suite.scenarioSummary)}`,
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
			`- ${score.caseName}: ${score.earned}/${score.max} (${Math.round(score.normalized * 100)}%), run=${score.runId}, tasks=${score.scoredTasks}, missing=${score.missingTasks}, chains=${formatScenarioSummary(score.chainSummary)}, scenarios=${formatScenarioSummary(score.scenarioSummary)}, issues=${score.issues.length}, regressions=${score.regressions.length}${baselineSuffix}`,
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
			chainSummary: result.suite.chainSummary,
			scenarioSummary: result.suite.scenarioSummary,
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
				chainSummary: score.chainSummary,
				scenarioSummary: score.scenarioSummary,
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

async function writeStoredBaseline(cwd: string, name: string, result: PireEvalCollectedScores): Promise<string> {
	const path = resolvePireEvalStoredArtifactPath(cwd, { kind: "baselines", name, ext: "json" });
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, "utf-8");
	return path;
}

async function writeStoredReportSet(cwd: string, name: string, result: PireEvalCollectedScores): Promise<string[]> {
	const jsonPath = resolvePireEvalStoredArtifactPath(cwd, { kind: "reports", name, ext: "json" });
	const markdownPath = resolvePireEvalStoredArtifactPath(cwd, { kind: "reports", name, ext: "md" });
	await mkdir(dirname(jsonPath), { recursive: true });
	await Promise.all([
		writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8"),
		writeFile(markdownPath, formatMarkdownReport(result), "utf-8"),
	]);
	return [jsonPath, markdownPath];
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
		const maxChainPassDrop = expectation.maxChainPassDropByBaseline?.[baseline.name];
		if (maxChainPassDrop !== undefined && baseline.chainPassedDelta < -maxChainPassDrop) {
			regressions.push(
				`${baseline.name} chain pass delta ${formatSignedDelta(baseline.chainPassedDelta, 0)} exceeded allowed drop ${formatSignedDelta(-maxChainPassDrop, 0)}`,
			);
		}
		const maxChainNearMissIncrease = expectation.maxChainNearMissIncreaseByBaseline?.[baseline.name];
		if (maxChainNearMissIncrease !== undefined && baseline.chainNearMissDelta > maxChainNearMissIncrease) {
			regressions.push(
				`${baseline.name} chain near-miss delta ${formatSignedDelta(baseline.chainNearMissDelta, 0)} exceeded allowed increase ${formatSignedDelta(maxChainNearMissIncrease, 0)}`,
			);
		}
		const maxChainFailedIncrease = expectation.maxChainFailedIncreaseByBaseline?.[baseline.name];
		if (maxChainFailedIncrease !== undefined && baseline.chainFailedDelta > maxChainFailedIncrease) {
			regressions.push(
				`${baseline.name} chain fail delta ${formatSignedDelta(baseline.chainFailedDelta, 0)} exceeded allowed increase ${formatSignedDelta(maxChainFailedIncrease, 0)}`,
			);
		}
		const maxScenarioPassDrop = expectation.maxScenarioPassDropByBaseline?.[baseline.name];
		if (maxScenarioPassDrop !== undefined && baseline.scenarioPassedDelta < -maxScenarioPassDrop) {
			regressions.push(
				`${baseline.name} scenario pass delta ${formatSignedDelta(baseline.scenarioPassedDelta, 0)} exceeded allowed drop ${formatSignedDelta(-maxScenarioPassDrop, 0)}`,
			);
		}
		const maxScenarioNearMissIncrease = expectation.maxScenarioNearMissIncreaseByBaseline?.[baseline.name];
		if (maxScenarioNearMissIncrease !== undefined && baseline.scenarioNearMissDelta > maxScenarioNearMissIncrease) {
			regressions.push(
				`${baseline.name} scenario near-miss delta ${formatSignedDelta(baseline.scenarioNearMissDelta, 0)} exceeded allowed increase ${formatSignedDelta(maxScenarioNearMissIncrease, 0)}`,
			);
		}
		const maxScenarioFailedIncrease = expectation.maxScenarioFailedIncreaseByBaseline?.[baseline.name];
		if (maxScenarioFailedIncrease !== undefined && baseline.scenarioFailedDelta > maxScenarioFailedIncrease) {
			regressions.push(
				`${baseline.name} scenario fail delta ${formatSignedDelta(baseline.scenarioFailedDelta, 0)} exceeded allowed increase ${formatSignedDelta(maxScenarioFailedIncrease, 0)}`,
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
			chainSummary: score.chainSummary,
			scenarioSummary: score.scenarioSummary,
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
			chainSummary: result.suite.chainSummary,
			scenarioSummary: result.suite.scenarioSummary,
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
							chainPassedDelta: score.chainSummary.passed - baselineScore.chainSummary.passed,
							chainNearMissDelta: score.chainSummary.nearMiss - baselineScore.chainSummary.nearMiss,
							chainFailedDelta: score.chainSummary.failed - baselineScore.chainSummary.failed,
							scenarioPassedDelta: score.scenarioSummary.passed - baselineScore.scenarioSummary.passed,
							scenarioNearMissDelta: score.scenarioSummary.nearMiss - baselineScore.scenarioSummary.nearMiss,
							scenarioFailedDelta: score.scenarioSummary.failed - baselineScore.scenarioSummary.failed,
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
					chainPassedDelta: result.suite.chainSummary.passed - baseline.suite.chainSummary.passed,
					chainNearMissDelta: result.suite.chainSummary.nearMiss - baseline.suite.chainSummary.nearMiss,
					chainFailedDelta: result.suite.chainSummary.failed - baseline.suite.chainSummary.failed,
					scenarioPassedDelta: result.suite.scenarioSummary.passed - baseline.suite.scenarioSummary.passed,
					scenarioNearMissDelta: result.suite.scenarioSummary.nearMiss - baseline.suite.scenarioSummary.nearMiss,
					scenarioFailedDelta: result.suite.scenarioSummary.failed - baseline.suite.scenarioSummary.failed,
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
	args: Required<Pick<PireEvalCliArgs, "suitePath" | "casesDir">> & Pick<PireEvalCliArgs, "checkExpectedRuns">,
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
	const suiteTaskDescriptors: PireEvalTaskSeverityDescriptor[] = [];

	for (const caseName of caseDirs) {
		const cwd = join(casesDir, caseName);
		const definition = await loadCaseDefinition(join(cwd, "case.json"));
		const result = await scorePireEvalSessionFromFiles({
			cwd,
			suitePath,
			bindingsPath: join(cwd, "bindings.json"),
		});
		const caseTaskDescriptors = result.bindingFile.bindings
			.map((binding) => result.suite.tasks.find((task) => task.id === binding.taskId))
			.filter((task): task is (typeof result.suite.tasks)[number] => task !== undefined)
			.map((task) => ({
				lane: task.lane,
				focus: "focus" in task ? task.focus : undefined,
			}));
		suiteTaskDescriptors.push(...caseTaskDescriptors);
		const filteredIssues = filterExpectedMissingSubmissionIssues({
			issues: result.score.issues,
			missingTaskCount: result.score.missingTaskIds.length,
			suiteTaskCount: result.suite.tasks.length,
			boundTaskCount: result.bindingFile.bindings.length,
		});
		const laneTaskIssues = [
			...collectLaneTaskIssues(result.score.taskScores, "chain"),
			...collectLaneTaskIssues(result.score.taskScores, "scenario"),
		];
		const expectedRunIssues: string[] = [];
		if (args.checkExpectedRuns) {
			const expectedRunPath = join(cwd, "expected-run.json");
			const expectedRun = await loadExpectedRun(expectedRunPath);
			if (!expectedRun) {
				expectedRunIssues.push(`expected-run.json is missing for ${caseName}`);
			} else if (stringifyPireEvalRunBundle(expectedRun) !== stringifyPireEvalRunBundle(result.run)) {
				expectedRunIssues.push(formatExpectedRunMismatchIssue(caseName));
			}
		}
		scores.push({
			caseName,
			runId: result.run.runId,
			earned: result.score.earned,
			max: result.score.max,
			normalized: result.score.normalized,
			scoredTasks: result.score.taskScores.length,
			missingTasks: result.score.missingTaskIds.length,
			issues: [...filteredIssues, ...laneTaskIssues, ...expectedRunIssues],
			expectation: definition?.expectation,
			severityThresholds: mergeSeverityThresholds(
				resolveDefaultSeverityThresholdsForTasks(caseTaskDescriptors),
				definition?.severityThresholds,
			),
			regressions: [],
			chainSummary: summarizeLaneTaskScores(
				result.score.taskScores,
				result.suite.tasks,
				result.run.submissions,
				"chain",
			),
			scenarioSummary: summarizeLaneTaskScores(
				result.score.taskScores,
				result.suite.tasks,
				result.run.submissions,
				"scenario",
			),
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
			severityThresholds: mergeSeverityThresholds(
				resolveDefaultSeverityThresholdsForTasks(suiteTaskDescriptors),
				suiteDefinition?.severityThresholds,
			),
		},
	};
}

interface ExpectationDrift {
	caseName: string;
	field: string;
	expected: number;
	actual: number;
}

function detectExpectationDrift(scores: PireEvalCaseScore[]): ExpectationDrift[] {
	const drifts: ExpectationDrift[] = [];
	for (const score of scores) {
		const expectation = score.expectation;
		if (!expectation) {
			continue;
		}
		if (expectation.minNormalized !== undefined && score.normalized < expectation.minNormalized) {
			drifts.push({
				caseName: score.caseName,
				field: "minNormalized",
				expected: expectation.minNormalized,
				actual: score.normalized,
			});
		}
		if (expectation.maxIssues !== undefined && score.issues.length > expectation.maxIssues) {
			drifts.push({
				caseName: score.caseName,
				field: "maxIssues",
				expected: expectation.maxIssues,
				actual: score.issues.length,
			});
		}
		if (expectation.maxChainFailed !== undefined && score.chainSummary.failed > expectation.maxChainFailed) {
			drifts.push({
				caseName: score.caseName,
				field: "maxChainFailed",
				expected: expectation.maxChainFailed,
				actual: score.chainSummary.failed,
			});
		}
		if (expectation.maxScenarioFailed !== undefined && score.scenarioSummary.failed > expectation.maxScenarioFailed) {
			drifts.push({
				caseName: score.caseName,
				field: "maxScenarioFailed",
				expected: expectation.maxScenarioFailed,
				actual: score.scenarioSummary.failed,
			});
		}
		if (expectation.minChainPassed !== undefined && score.chainSummary.passed < expectation.minChainPassed) {
			drifts.push({
				caseName: score.caseName,
				field: "minChainPassed",
				expected: expectation.minChainPassed,
				actual: score.chainSummary.passed,
			});
		}
		if (expectation.minScenarioPassed !== undefined && score.scenarioSummary.passed < expectation.minScenarioPassed) {
			drifts.push({
				caseName: score.caseName,
				field: "minScenarioPassed",
				expected: expectation.minScenarioPassed,
				actual: score.scenarioSummary.passed,
			});
		}
		if (expectation.maxChainNearMiss !== undefined && score.chainSummary.nearMiss > expectation.maxChainNearMiss) {
			drifts.push({
				caseName: score.caseName,
				field: "maxChainNearMiss",
				expected: expectation.maxChainNearMiss,
				actual: score.chainSummary.nearMiss,
			});
		}
		if (
			expectation.maxScenarioNearMiss !== undefined &&
			score.scenarioSummary.nearMiss > expectation.maxScenarioNearMiss
		) {
			drifts.push({
				caseName: score.caseName,
				field: "maxScenarioNearMiss",
				expected: expectation.maxScenarioNearMiss,
				actual: score.scenarioSummary.nearMiss,
			});
		}
	}
	return drifts;
}

async function fixExpectationDrift(casesDir: string, drifts: ExpectationDrift[]): Promise<number> {
	const grouped = new Map<string, ExpectationDrift[]>();
	for (const drift of drifts) {
		const existing = grouped.get(drift.caseName) ?? [];
		existing.push(drift);
		grouped.set(drift.caseName, existing);
	}
	let fixed = 0;
	for (const [caseName, caseDrifts] of grouped) {
		const caseJsonPath = join(casesDir, caseName, "case.json");
		const definition = await loadCaseDefinition(caseJsonPath);
		if (!definition?.expectation) {
			continue;
		}
		for (const drift of caseDrifts) {
			const field = drift.field as keyof PireEvalCaseExpectation;
			if (field.startsWith("min")) {
				const floored = Math.floor(drift.actual * 100) / 100;
				(definition.expectation as Record<string, number>)[field] = floored;
			} else {
				(definition.expectation as Record<string, number>)[field] = drift.actual;
			}
		}
		await writeFile(caseJsonPath, `${JSON.stringify(definition, null, 2)}\n`);
		fixed++;
	}
	return fixed;
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
		checkExpectedRuns: args.checkExpectedRuns,
	});
	let withBaselines = result;
	for (const baselineInput of args.baselines) {
		const resolvedBaseline = resolveStoredBaselineReference(process.cwd(), baselineInput);
		withBaselines = applyBaseline(withBaselines, resolvedBaseline, await loadBaseline(resolvedBaseline.path));
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

	if (args.checkExpectations) {
		const drifts = detectExpectationDrift(withBaselines.scores);
		if (drifts.length === 0) {
			process.stdout.write("check: all case expectations match current scores\n");
		} else {
			for (const drift of drifts) {
				const direction = drift.field.startsWith("min") ? "below" : "exceeds";
				process.stdout.write(
					`drift: ${drift.caseName}: ${drift.field} ${direction} expectation (expected=${drift.expected}, actual=${drift.actual})\n`,
				);
			}
			if (args.fixExpectations) {
				const casesDir = resolve(args.casesDir!);
				const fixed = await fixExpectationDrift(casesDir, drifts);
				process.stdout.write(`fix: updated ${fixed} case.json files\n`);
			} else {
				process.stdout.write(`\n${drifts.length} stale expectations found. Use --fix to auto-update.\n`);
			}
		}
		return;
	}

	if (args.json) {
		process.stdout.write(`${JSON.stringify(withBaselines, null, 2)}\n`);
	} else {
		process.stdout.write(formatLeaderboard(withBaselines));
	}

	if (args.reportPath) {
		await writeReport(args.reportPath, withBaselines);
	}
	for (const name of args.saveReportNames) {
		await writeStoredReportSet(process.cwd(), name, withBaselines);
	}
	if (
		(args.promoteBaselineNames.length > 0 || args.promoteReportNames.length > 0) &&
		withBaselines.suite.regressions.length > 0
	) {
		throw new Error(
			`cannot promote eval artifacts while regressions are present\n${withBaselines.suite.regressions.map((entry) => `- ${entry}`).join("\n")}`,
		);
	}
	for (const name of args.promoteReportNames) {
		await writeStoredReportSet(process.cwd(), name, withBaselines);
	}
	for (const name of args.promoteBaselineNames) {
		await writeStoredBaseline(process.cwd(), name, withBaselines);
	}
	for (const name of args.saveBaselineNames) {
		await writeStoredBaseline(process.cwd(), name, withBaselines);
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
