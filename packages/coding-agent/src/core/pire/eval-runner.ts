import { readFile } from "node:fs/promises";
import {
	type PireEvalRunBundle,
	type PireEvalRunScore,
	type PireEvalTaskSuite,
	parsePireEvalRunBundle,
	parsePireEvalTaskSuite,
	scorePireEvalRunBundle,
	summarizePireEvalRunScore,
} from "./eval-bundles.js";

export async function loadPireEvalTaskSuite(path: string): Promise<PireEvalTaskSuite> {
	return parsePireEvalTaskSuite(await readFile(path, "utf-8"));
}

export async function loadPireEvalRunBundle(path: string): Promise<PireEvalRunBundle> {
	return parsePireEvalRunBundle(await readFile(path, "utf-8"));
}

export async function scorePireEvalRunFromFiles(paths: { suitePath: string; runPath: string }): Promise<{
	suite: PireEvalTaskSuite;
	run: PireEvalRunBundle;
	score: PireEvalRunScore;
}> {
	const [suite, run] = await Promise.all([
		loadPireEvalTaskSuite(paths.suitePath),
		loadPireEvalRunBundle(paths.runPath),
	]);
	return {
		suite,
		run,
		score: scorePireEvalRunBundle(suite, run),
	};
}

export function formatPireEvalRunScoreReport(score: PireEvalRunScore): string {
	const lines = summarizePireEvalRunScore(score);

	if (score.taskScores.length > 0) {
		lines.push("- task scores:");
		for (const taskScore of [...score.taskScores].sort((left, right) => left.taskId.localeCompare(right.taskId))) {
			lines.push(
				`  - ${taskScore.taskId}: ${taskScore.earned}/${taskScore.max} (${Math.round(taskScore.normalized * 100)}%)`,
			);
		}
	}

	return `${lines.join("\n")}\n`;
}
