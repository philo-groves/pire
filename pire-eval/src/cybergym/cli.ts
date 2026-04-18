#!/usr/bin/env npx tsx
/**
 * pire-eval — CyberGym benchmark runner for PiRE
 *
 * Runs CyberGym vulnerability analysis benchmarks against the PiRE agent.
 * Lazily fetches data per task to stay within disk budget.
 *
 * Usage:
 *   npx tsx src/cybergym/cli.ts [options]
 *   npx tsx src/cybergym/cli.ts --task arvo:1065 --difficulty level2
 *   npx tsx src/cybergym/cli.ts --task-type arvo --project file --limit 5
 */

import { basename, join, resolve } from "node:path";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { appendRunHistory, getRepoSnapshot } from "./history.js";
import { loadTasks, filterTasks } from "./tasks.js";
import { runCyberGymTask, type CyberGymRunnerOptions } from "./runner.js";
import type { CyberGymReport, CyberGymResult, DifficultyLevel, RepoSnapshot, TaskType } from "./types.js";

interface CliArgs {
	taskType?: TaskType;
	difficulty: DifficultyLevel;
	project?: string;
	taskIds?: string[];
	limit?: number;
	shuffle: boolean;
	seed?: number;
	agentCmd: string;
	extensionPath: string;
	timeoutSeconds: number;
	sessionDir: string;
	workDir: string;
	cacheDir: string;
	json: boolean;
	saveTo?: string;
	historyFile: string;
	keepData: boolean;
	resume: boolean;
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		difficulty: "level1",
		shuffle: true,
		agentCmd: resolve(process.cwd(), "bin", "pire"),
		extensionPath: join(process.cwd(), ".pi", "extensions", "pire", "index.ts"),
		timeoutSeconds: 600,
		sessionDir: join(process.cwd(), ".cybergym-sessions"),
		workDir: join(process.cwd(), ".cybergym-data"),
		cacheDir: join(process.cwd(), ".cybergym-cache"),
		json: false,
		historyFile: join(process.cwd(), "docs", "CYBERGYM_RUNS.md"),
		keepData: false,
		resume: false,
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--task-type" && i + 1 < argv.length) {
			args.taskType = argv[++i] as TaskType;
		} else if (arg === "--difficulty" && i + 1 < argv.length) {
			args.difficulty = argv[++i] as DifficultyLevel;
		} else if (arg === "--project" && i + 1 < argv.length) {
			args.project = argv[++i];
		} else if (arg === "--task" && i + 1 < argv.length) {
			args.taskIds = (args.taskIds ?? []).concat(argv[++i]);
		} else if (arg === "--limit" && i + 1 < argv.length) {
			args.limit = parseInt(argv[++i], 10);
		} else if (arg === "--seed" && i + 1 < argv.length) {
			args.seed = parseInt(argv[++i], 10);
		} else if (arg === "--shuffle") {
			args.shuffle = true;
		} else if (arg === "--no-shuffle") {
			args.shuffle = false;
		} else if (arg === "--agent-cmd" && i + 1 < argv.length) {
			args.agentCmd = resolve(argv[++i]);
		} else if (arg === "--extension" && i + 1 < argv.length) {
			args.extensionPath = resolve(argv[++i]);
		} else if (arg === "--timeout" && i + 1 < argv.length) {
			args.timeoutSeconds = parseInt(argv[++i], 10);
		} else if (arg === "--session-dir" && i + 1 < argv.length) {
			args.sessionDir = resolve(argv[++i]);
		} else if (arg === "--work-dir" && i + 1 < argv.length) {
			args.workDir = resolve(argv[++i]);
		} else if (arg === "--json") {
			args.json = true;
		} else if (arg === "--save" && i + 1 < argv.length) {
			args.saveTo = resolve(argv[++i]);
		} else if (arg === "--history-file" && i + 1 < argv.length) {
			args.historyFile = resolve(argv[++i]);
		} else if (arg === "--keep-data") {
			args.keepData = true;
		} else if (arg === "--resume") {
			args.resume = true;
		} else if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		}
	}

	return args;
}

function printHelp(): void {
	process.stdout.write(`pire-eval — CyberGym benchmark runner for PiRE

Usage:
  npx tsx src/cybergym/cli.ts [options]

Task Selection:
  --task <id>            Run specific task(s) by ID (e.g., arvo:1065). Repeatable.
  --task-type <type>     Filter by type: arvo, oss-fuzz, oss-fuzz-latest
  --project <name>       Filter by project name (e.g., file, curl)
  --difficulty <level>   Difficulty: level0, level1, level2, level3 (default: level1)
  --limit <n>            Max tasks to run
  --shuffle              Shuffle filtered tasks before applying --limit (default)
  --no-shuffle           Keep filtered tasks in source order
  --seed <n>             Shuffle seed for reproducible task selection

Agent Configuration:
  --agent-cmd <cmd>      Agent command (default: pi)
  --extension <path>     Path to PiRE extension
  --timeout <seconds>    Per-task timeout (default: 600)

Storage:
  --session-dir <dir>    Agent session files
  --work-dir <dir>       Workspace for task data (cleaned per task)
  --keep-data            Don't delete workspace data after each task

Output:
  --json                 Output results as JSON
  --save <path>          Save results JSON to file
  --history-file <path>  Append a markdown run log (default: docs/CYBERGYM_RUNS.md)
  --resume               Skip tasks that already have results in --save file

  --help, -h             Show this help
`);
}

function aggregateResults(
	results: CyberGymResult[],
	difficulty: DifficultyLevel,
	selection: { shuffled: boolean; shuffleSeed?: number },
	repo?: RepoSnapshot,
): CyberGymReport {
	const byTaskType: Record<string, { total: number; passed: number; rate: number }> = {};
	const byProject: Record<string, { total: number; passed: number; rate: number }> = {};

	for (const r of results) {
		// By task type
		if (!byTaskType[r.taskType]) byTaskType[r.taskType] = { total: 0, passed: 0, rate: 0 };
		byTaskType[r.taskType].total++;
		if (r.passed) byTaskType[r.taskType].passed++;

		// By project
		if (!byProject[r.projectName]) byProject[r.projectName] = { total: 0, passed: 0, rate: 0 };
		byProject[r.projectName].total++;
		if (r.passed) byProject[r.projectName].passed++;
	}

	for (const v of Object.values(byTaskType)) v.rate = v.total > 0 ? v.passed / v.total : 0;
	for (const v of Object.values(byProject)) v.rate = v.total > 0 ? v.passed / v.total : 0;

	const passed = results.filter((r) => r.passed).length;
	return {
		timestamp: new Date().toISOString(),
		difficulty,
		shuffled: selection.shuffled,
		shuffleSeed: selection.shuffleSeed,
		total: results.length,
		passed,
		failed: results.length - passed,
		passRate: results.length > 0 ? passed / results.length : 0,
		byTaskType,
		byProject,
		results,
		repo,
	};
}

function deriveHistoryLabel(args: CliArgs, report: CyberGymReport): string {
	if (args.saveTo) {
		return basename(args.saveTo, ".json");
	}
	if (args.taskIds?.length === 1) {
		return args.taskIds[0];
	}
	if (args.project) {
		return `${args.project}-${args.difficulty}`;
	}
	if (args.taskType) {
		return `${args.taskType}-${args.difficulty}`;
	}
	if (report.results.length === 1) {
		return report.results[0].taskId;
	}
	return `cybergym-${args.difficulty}-${report.total}-tasks`;
}

function formatReport(report: CyberGymReport): string {
	const lines: string[] = [
		`CyberGym Eval Results (${report.timestamp})`,
		`Difficulty: ${report.difficulty}`,
		`Task selection: ${report.shuffled ? `shuffled (seed ${report.shuffleSeed})` : "in source order"}`,
		``,
		`Overall: ${report.passed}/${report.total} (${(report.passRate * 100).toFixed(1)}%)`,
	];

	lines.push(``, `By Task Type:`);
	for (const [type, stats] of Object.entries(report.byTaskType).sort()) {
		lines.push(`  ${type}: ${stats.passed}/${stats.total} (${(stats.rate * 100).toFixed(1)}%)`);
	}

	lines.push(``, `By Project (sorted by pass rate):`);
	const projEntries = Object.entries(report.byProject).sort((a, b) => a[1].rate - b[1].rate);
	for (const [proj, stats] of projEntries) {
		lines.push(`  ${proj}: ${stats.passed}/${stats.total} (${(stats.rate * 100).toFixed(1)}%)`);
	}

	const failures = report.results.filter((r) => !r.passed);
	if (failures.length > 0 && failures.length <= 30) {
		lines.push(``, `Failed tasks:`);
		for (const f of failures) {
			const reason = f.timedOut
				? "timeout"
				: f.error
					? f.error.slice(0, 60)
					: !f.pocFound
						? "no PoC"
						: !f.vulCrashed
							? "vul didn't crash"
							: "fix also crashed";
			lines.push(`  ${f.taskId} (${f.projectName}): ${reason}`);
		}
	}

	return lines.join("\n") + "\n";
}

async function main(argv: string[]): Promise<void> {
	const args = parseArgs(argv);
	const repoSnapshot = getRepoSnapshot(process.cwd());

	// Load task index
	const allTasks = await loadTasks(args.cacheDir);
	process.stderr.write(`Loaded ${allTasks.length} tasks from index\n`);

	// Load previous results for resume
	let previousResults: CyberGymResult[] = [];
	const completedIds = new Set<string>();
	if (args.resume && args.saveTo && existsSync(args.saveTo)) {
		const prev = JSON.parse(readFileSync(args.saveTo, "utf-8")) as CyberGymReport;
		previousResults = prev.results;
		for (const r of prev.results) completedIds.add(r.taskId);
		process.stderr.write(`Resuming: ${completedIds.size} tasks already completed\n`);
	}

	// Filter tasks
	const shuffleSeed = args.shuffle && !args.taskIds?.length ? (args.seed ?? Date.now()) : undefined;
	const didShuffle = shuffleSeed !== undefined;
	const tasks = filterTasks(allTasks, {
		taskType: args.taskType,
		project: args.project,
		taskIds: args.taskIds,
		limit: args.limit,
		shuffle: args.shuffle,
		seed: shuffleSeed,
		skip: completedIds.size > 0 ? completedIds : undefined,
	});

	if (tasks.length === 0) {
		process.stderr.write("No tasks matched the filter criteria\n");
		if (previousResults.length > 0) {
			const report = aggregateResults(previousResults, args.difficulty, {
				shuffled: didShuffle,
				shuffleSeed,
			}, repoSnapshot);
			process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : formatReport(report));
		}
		process.exit(tasks.length === 0 && previousResults.length === 0 ? 1 : 0);
	}

	// Create directories
	for (const dir of [args.sessionDir, args.workDir]) {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	}

	process.stderr.write(
		`Running ${tasks.length} task(s) at ${args.difficulty}...\n\n`,
	);
	if (shuffleSeed !== undefined) {
		process.stderr.write(`Task selection shuffled with seed ${shuffleSeed}\n\n`);
	}

	const runnerOptions: CyberGymRunnerOptions = {
		agentCmd: args.agentCmd,
		extensionPath: args.extensionPath,
		timeoutSeconds: args.timeoutSeconds,
		sessionDir: args.sessionDir,
		difficulty: args.difficulty,
		workDir: args.workDir,
		extraArgs: [],
		keepData: args.keepData,
		validationRepairAttempts: 2,
	};

	const results: CyberGymResult[] = [...previousResults];

	for (let i = 0; i < tasks.length; i++) {
		const task = tasks[i];
		process.stderr.write(
			`[${i + 1}/${tasks.length}] ${task.taskId} (${task.projectName}) ...\n`,
		);

		const result = await runCyberGymTask(task, runnerOptions);
		results.push(result);

		const status = result.passed
			? "PASS"
			: result.timedOut
				? "TIMEOUT"
				: "FAIL";
		const detail = result.passed
			? ""
			: !result.pocFound
				? " (no PoC)"
				: !result.vulCrashed
					? " (vul didn't crash)"
					: " (fix also crashed)";
		process.stderr.write(
			`  → ${status}${detail} (${result.timeSeconds.toFixed(1)}s)\n\n`,
		);

		// Incremental save
		if (args.saveTo) {
			const report = aggregateResults(results, args.difficulty, {
				shuffled: didShuffle,
				shuffleSeed,
			}, repoSnapshot);
			writeFileSync(args.saveTo, JSON.stringify(report, null, 2) + "\n", "utf-8");
		}
	}

	// Final report
	const report = aggregateResults(results, args.difficulty, {
		shuffled: didShuffle,
		shuffleSeed,
	}, repoSnapshot);

	if (args.json) {
		process.stdout.write(JSON.stringify(report, null, 2) + "\n");
	} else {
		process.stdout.write(formatReport(report));
	}

	if (args.saveTo) {
		writeFileSync(args.saveTo, JSON.stringify(report, null, 2) + "\n", "utf-8");
		process.stderr.write(`Results saved to ${args.saveTo}\n`);
	}

	appendRunHistory(args.historyFile, report, {
		label: deriveHistoryLabel(args, report),
		sourcePath: args.saveTo,
		repo: repoSnapshot,
	});
	process.stderr.write(`Run history updated at ${args.historyFile}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`pire-eval: ${message}\n`);
	process.exitCode = 1;
});
