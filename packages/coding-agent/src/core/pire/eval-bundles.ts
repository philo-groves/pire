import { createStarterBinaryReEvalCorpus, type PireBinaryEvalTask, validateBinaryReEvalCorpus } from "./eval-corpus.js";
import { type PireEvalScore, type PireEvalSubmission, type PireEvalTask, scorePireEvalSubmission } from "./evals.js";

export interface PireEvalTaskSuite {
	version: 1;
	suiteId: string;
	title: string;
	focus: "binary-re";
	tasks: PireBinaryEvalTask[];
	notes?: string[];
}

export interface PireEvalRunBundle {
	version: 1;
	suiteId: string;
	runId: string;
	model?: string;
	startedAt?: string;
	finishedAt?: string;
	submissions: PireEvalSubmission[];
	notes?: string[];
}

export interface PireEvalRunScore {
	suiteId: string;
	runId: string;
	taskScores: PireEvalScore[];
	missingTaskIds: string[];
	unexpectedTaskIds: string[];
	earned: number;
	max: number;
	normalized: number;
	issues: string[];
}

export function createStarterBinaryReEvalSuite(): PireEvalTaskSuite {
	return {
		version: 1,
		suiteId: "pire-binary-re-starter-v1",
		title: "Pire Binary RE Starter Suite",
		focus: "binary-re",
		tasks: createStarterBinaryReEvalCorpus(),
		notes: [
			"Starter reverse-engineering suite focused on binary analysis and memory-corruption reasoning.",
			"Intended for shell-first workflows using standard CLI tooling plus durable Pire evidence tracking.",
		],
	};
}

function taskIdSet(tasks: PireEvalTask[]): Set<string> {
	return new Set(tasks.map((task) => task.id));
}

export function validatePireEvalTaskSuite(suite: PireEvalTaskSuite): string[] {
	const issues: string[] = [];
	const seen = new Set<string>();

	if (suite.version !== 1) {
		issues.push(`unsupported task suite version: ${suite.version}`);
	}

	if (suite.tasks.length === 0) {
		issues.push("task suite is empty");
	}

	for (const task of suite.tasks) {
		if (seen.has(task.id)) {
			issues.push(`duplicate task id: ${task.id}`);
		}
		seen.add(task.id);
	}

	issues.push(...validateBinaryReEvalCorpus(suite.tasks));
	return issues;
}

export function stringifyPireEvalTaskSuite(suite: PireEvalTaskSuite): string {
	return `${JSON.stringify(suite, null, 2)}\n`;
}

export function parsePireEvalTaskSuite(text: string): PireEvalTaskSuite {
	return JSON.parse(text) as PireEvalTaskSuite;
}

export function validatePireEvalRunBundle(suite: PireEvalTaskSuite, run: PireEvalRunBundle): string[] {
	const issues: string[] = [];
	const knownTaskIds = taskIdSet(suite.tasks);
	const seen = new Set<string>();

	if (run.version !== 1) {
		issues.push(`unsupported run bundle version: ${run.version}`);
	}

	if (run.suiteId !== suite.suiteId) {
		issues.push(`run suiteId ${run.suiteId} does not match task suite ${suite.suiteId}`);
	}

	for (const submission of run.submissions) {
		if (!knownTaskIds.has(submission.taskId)) {
			issues.push(`unexpected submission task id: ${submission.taskId}`);
		}
		if (seen.has(submission.taskId)) {
			issues.push(`duplicate submission for task id: ${submission.taskId}`);
		}
		seen.add(submission.taskId);
	}

	return issues;
}

export function stringifyPireEvalRunBundle(run: PireEvalRunBundle): string {
	return `${JSON.stringify(run, null, 2)}\n`;
}

export function parsePireEvalRunBundle(text: string): PireEvalRunBundle {
	return JSON.parse(text) as PireEvalRunBundle;
}

export function scorePireEvalRunBundle(suite: PireEvalTaskSuite, run: PireEvalRunBundle): PireEvalRunScore {
	const taskMap = new Map(suite.tasks.map((task) => [task.id, task]));
	const taskScores: PireEvalScore[] = [];
	const unexpectedTaskIds: string[] = [];

	for (const submission of run.submissions) {
		const task = taskMap.get(submission.taskId);
		if (!task) {
			unexpectedTaskIds.push(submission.taskId);
			continue;
		}
		taskScores.push(scorePireEvalSubmission(task, submission));
	}

	const missingTaskIds = suite.tasks
		.map((task) => task.id)
		.filter((taskId) => !run.submissions.some((submission) => submission.taskId === taskId));

	const earned = taskScores.reduce((total, score) => total + score.earned, 0);
	const max = taskScores.reduce((total, score) => total + score.max, 0);
	const issues = [...validatePireEvalTaskSuite(suite), ...validatePireEvalRunBundle(suite, run)];
	if (missingTaskIds.length > 0) {
		issues.push(`missing submissions for ${missingTaskIds.length} task(s)`);
	}
	if (unexpectedTaskIds.length > 0) {
		issues.push(`unexpected submissions for ${unexpectedTaskIds.length} task(s)`);
	}

	return {
		suiteId: suite.suiteId,
		runId: run.runId,
		taskScores,
		missingTaskIds,
		unexpectedTaskIds,
		earned,
		max,
		normalized: max === 0 ? 0 : earned / max,
		issues,
	};
}

export function summarizePireEvalRunScore(score: PireEvalRunScore): string[] {
	const lines = [
		"Pire Eval Run Score",
		`- suite: ${score.suiteId}`,
		`- run: ${score.runId}`,
		`- score: ${score.earned}/${score.max} (${Math.round(score.normalized * 100)}%)`,
		`- scored tasks: ${score.taskScores.length}`,
	];

	if (score.missingTaskIds.length > 0) {
		lines.push(`- missing tasks: ${score.missingTaskIds.join(", ")}`);
	}

	if (score.unexpectedTaskIds.length > 0) {
		lines.push(`- unexpected tasks: ${score.unexpectedTaskIds.join(", ")}`);
	}

	if (score.issues.length > 0) {
		lines.push("- issues:");
		for (const issue of score.issues) {
			lines.push(`  - ${issue}`);
		}
	}

	return lines;
}
