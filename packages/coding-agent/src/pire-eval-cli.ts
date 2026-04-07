#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { scorePireEvalSessionFromFiles } from "./core/pire/eval-runner.js";

interface PireEvalCliArgs {
	suitePath?: string;
	casesDir?: string;
	enforce?: boolean;
	json?: boolean;
}

interface PireEvalCaseExpectation {
	minNormalized?: number;
	maxIssues?: number;
	minRank?: number;
	maxRank?: number;
}

interface PireEvalCaseDefinition {
	title?: string;
	expectation?: PireEvalCaseExpectation;
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
	regressions: string[];
}

function printHelp(): void {
	process.stdout.write(`pire-evals - score binary RE eval session directories

Usage:
  pire-evals --suite <suite.json> --cases-dir <dir> [--enforce] [--json]

Options:
  --suite <path>      Path to a Pire eval task suite JSON file
  --cases-dir <path>  Directory containing case subdirectories with bindings.json and .pire state
  --enforce           Exit non-zero when a case misses its expectation metadata
  --json              Emit JSON instead of a text leaderboard
  --help              Show this help
`);
}

function parseArgs(argv: string[]): PireEvalCliArgs {
	const args: PireEvalCliArgs = {};

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--suite" && index + 1 < argv.length) {
			args.suitePath = argv[++index];
		} else if (arg === "--cases-dir" && index + 1 < argv.length) {
			args.casesDir = argv[++index];
		} else if (arg === "--enforce") {
			args.enforce = true;
		} else if (arg === "--json") {
			args.json = true;
		} else if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		} else {
			throw new Error(`unknown option: ${arg}`);
		}
	}

	return args;
}

function parseCaseDefinition(text: string): PireEvalCaseDefinition {
	return JSON.parse(text) as PireEvalCaseDefinition;
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
	return regressions;
}

function formatLeaderboard(scores: PireEvalCaseScore[]): string {
	const lines = ["Pire Eval Session Leaderboard", `- cases: ${scores.length}`];
	const regressions = scores.flatMap((score) => score.regressions.map((entry) => `${score.caseName}: ${entry}`));
	lines.push(`- regressions: ${regressions.length}`);

	for (const score of scores) {
		const issueSuffix = score.issues.length > 0 ? `, issues=${score.issues.length}` : "";
		const regressionSuffix = score.regressions.length > 0 ? `, regressions=${score.regressions.length}` : "";
		lines.push(
			`- ${score.caseName}: ${score.earned}/${score.max} (${Math.round(score.normalized * 100)}%), run=${score.runId}, tasks=${score.scoredTasks}, missing=${score.missingTasks}${issueSuffix}${regressionSuffix}`,
		);
	}

	if (regressions.length > 0) {
		lines.push("- regression details:");
		for (const regression of regressions) {
			lines.push(`  - ${regression}`);
		}
	}

	return `${lines.join("\n")}\n`;
}

async function collectCaseScores(
	args: Required<Pick<PireEvalCliArgs, "suitePath" | "casesDir">>,
): Promise<PireEvalCaseScore[]> {
	const suitePath = resolve(args.suitePath);
	const casesDir = resolve(args.casesDir);
	const entries = await readdir(casesDir, { withFileTypes: true });
	const caseDirs = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	const scores: PireEvalCaseScore[] = [];

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

	return rankedScores;
}

async function main(argv: string[]): Promise<void> {
	const args = parseArgs(argv);
	if (!args.suitePath || !args.casesDir) {
		printHelp();
		throw new Error("both --suite and --cases-dir are required");
	}

	const scores = await collectCaseScores({
		suitePath: args.suitePath,
		casesDir: args.casesDir,
	});
	const regressions = scores.flatMap((score) => score.regressions.map((entry) => `${score.caseName}: ${entry}`));

	if (args.json) {
		process.stdout.write(`${JSON.stringify({ scores, regressions }, null, 2)}\n`);
	} else {
		process.stdout.write(formatLeaderboard(scores));
	}

	if (args.enforce && regressions.length > 0) {
		throw new Error(`regression expectations failed\n${regressions.map((entry) => `- ${entry}`).join("\n")}`);
	}
}

main(process.argv.slice(2)).catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`pire-evals: ${message}\n`);
	process.exitCode = 1;
});
