import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { CyberGymReport, CyberGymResult, RepoSnapshot } from "./types.js";

export interface RunHistoryEntryOptions {
	label?: string;
	sourcePath?: string;
	imported?: boolean;
	repo?: RepoSnapshot;
}

export function getRepoSnapshot(repoRoot: string): RepoSnapshot {
	try {
		const commitHash = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
			encoding: "utf-8",
		}).trim();
		const status = execFileSync("git", ["-C", repoRoot, "status", "--porcelain"], {
			encoding: "utf-8",
		}).trim();
		return {
			commitHash,
			dirty: status.length > 0,
		};
	} catch {
		return {
			commitHash: "unknown",
			dirty: false,
		};
	}
}

function selectionSummary(report: CyberGymReport): string {
	if (!report.shuffled) {
		return "source order";
	}
	if (report.shuffleSeed === undefined) {
		return "shuffled";
	}
	return `shuffled (seed ${report.shuffleSeed})`;
}

function runResultSummary(report: CyberGymReport): string {
	const status = report.failed === 0 ? "PASS" : report.passed === 0 ? "FAIL" : "MIXED";
	return `${status} ${report.passed}/${report.total} passed`;
}

function taskResultStatus(result: CyberGymResult): string {
	if (result.passed) {
		return "PASS";
	}
	if (result.timedOut) {
		return "TIMEOUT";
	}
	if (!result.pocFound) {
		return "FAIL no PoC";
	}
	if (!result.vulCrashed) {
		return "FAIL vul did not crash";
	}
	if (!result.fixSurvived) {
		return "FAIL fix also crashed";
	}
	if (result.error) {
		return `FAIL ${result.error.slice(0, 80)}`;
	}
	return "FAIL";
}

function defaultRunLabel(report: CyberGymReport): string {
	if (report.results.length === 1) {
		return report.results[0].taskId;
	}
	return `cybergym-${report.difficulty}-${report.total}-tasks`;
}

function formatTaskLine(result: CyberGymResult): string {
	return `- Task: \`${taskResultStatus(result)}\` \`${result.taskId}\` \`${result.projectName}\` \`${result.timeSeconds.toFixed(1)}s\``;
}

function buildEntry(report: CyberGymReport, options: RunHistoryEntryOptions): string {
	const repo = options.repo ?? report.repo ?? { commitHash: "unknown", dirty: false };
	const label = options.label ?? defaultRunLabel(report);
	const lines = [
		`## ${report.timestamp} · \`${label}\``,
		`- Result: \`${runResultSummary(report)}\``,
		`- Difficulty: \`${report.difficulty}\``,
		`- Selection: ${selectionSummary(report)}`,
		`- Commit: \`${repo.commitHash}\`${repo.dirty ? " (dirty)" : ""}`,
	];

	if (options.sourcePath) {
		const sourceLabel = basename(options.sourcePath);
		lines.push(`- Source: \`${sourceLabel}\`${options.imported ? " (imported legacy JSON)" : ""}`);
	}

	for (const result of report.results) {
		lines.push(formatTaskLine(result));
	}

	return `${lines.join("\n")}\n\n`;
}

export function appendRunHistory(
	historyPath: string,
	report: CyberGymReport,
	options: RunHistoryEntryOptions = {},
): void {
	const resolvedPath = resolve(historyPath);
	mkdirSync(dirname(resolvedPath), { recursive: true });

	const header = [
		"# CyberGym Run History",
		"",
		"Each section records one CyberGym CLI invocation.",
		"`Commit` is the repository HEAD captured at run time; `(dirty)` means local uncommitted changes were present.",
		"",
	].join("\n");

	if (!existsSync(resolvedPath) || readFileSync(resolvedPath, "utf-8").trim().length === 0) {
		appendFileSync(resolvedPath, header, "utf-8");
	}

	appendFileSync(resolvedPath, buildEntry(report, options), "utf-8");
}
