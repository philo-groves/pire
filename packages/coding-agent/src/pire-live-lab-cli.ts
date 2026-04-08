#!/usr/bin/env node

import process from "node:process";
import {
	evaluatePireLiveLabAgentRun,
	inspectPireLiveLabAgentRun,
	type PireLiveLabAgentRunResult,
	resolvePireLiveLabPaths,
} from "./core/pire/live-labs.js";

interface PireLiveLabCliArgs {
	lab?: string;
	prompt?: string;
	sessionDir?: string;
	logPath?: string;
	disclosureMarkers: string[];
	forbiddenPaths: string[];
	timeoutSeconds?: number;
	json?: boolean;
	inspectOnly?: boolean;
	packageRoot: string;
}

function printHelp(): void {
	process.stdout.write(`pire-live-labs - run or inspect audited live lab sessions

Usage:
  pire-live-labs --lab <name> --session-dir <dir> --log-path <path> [--prompt <text>] [--forbid <path>]... [--disclosure-marker <text>]... [--timeout-seconds <n>] [--inspect-only] [--json] [--package-root <path>]

Options:
  --lab <name>                 Live lab directory name under labs/
  --prompt <text>              Prompt to run through pire (required unless --inspect-only)
  --session-dir <path>         Directory containing or receiving pire session JSONL files
  --log-path <path>            Lab-relative path to the runtime log to inspect
  --forbid <path>              Lab-relative forbidden path to audit in sessions; repeatable
  --disclosure-marker <text>   Required disclosure marker to validate in logs; repeatable
  --timeout-seconds <n>        Agent-run timeout in seconds (default: 300)
  --inspect-only               Inspect an existing session/log/runtime state without launching pire
  --json                       Emit JSON instead of a text summary
  --package-root <path>        packages/coding-agent root (default: current working directory)
  --help                       Show this help
`);
}

function parseArgs(argv: string[]): PireLiveLabCliArgs {
	const args: PireLiveLabCliArgs = {
		disclosureMarkers: [],
		forbiddenPaths: [],
		packageRoot: process.cwd(),
	};

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--lab" && index + 1 < argv.length) {
			args.lab = argv[++index];
		} else if (arg === "--prompt" && index + 1 < argv.length) {
			args.prompt = argv[++index];
		} else if (arg === "--session-dir" && index + 1 < argv.length) {
			args.sessionDir = argv[++index];
		} else if (arg === "--log-path" && index + 1 < argv.length) {
			args.logPath = argv[++index];
		} else if (arg === "--forbid" && index + 1 < argv.length) {
			args.forbiddenPaths.push(argv[++index] ?? "");
		} else if (arg === "--disclosure-marker" && index + 1 < argv.length) {
			args.disclosureMarkers.push(argv[++index] ?? "");
		} else if (arg === "--timeout-seconds" && index + 1 < argv.length) {
			const value = Number.parseInt(argv[++index] ?? "", 10);
			if (!Number.isFinite(value) || value <= 0) {
				throw new Error(`invalid --timeout-seconds value: ${argv[index]}`);
			}
			args.timeoutSeconds = value;
		} else if (arg === "--inspect-only") {
			args.inspectOnly = true;
		} else if (arg === "--json") {
			args.json = true;
		} else if (arg === "--package-root" && index + 1 < argv.length) {
			args.packageRoot = argv[++index] ?? process.cwd();
		} else if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		} else {
			throw new Error(`unknown option: ${arg}`);
		}
	}

	return args;
}

function validateArgs(args: PireLiveLabCliArgs): asserts args is PireLiveLabCliArgs & {
	lab: string;
	sessionDir: string;
	logPath: string;
} {
	if (!args.lab) {
		throw new Error("--lab is required");
	}
	if (!args.sessionDir) {
		throw new Error("--session-dir is required");
	}
	if (!args.logPath) {
		throw new Error("--log-path is required");
	}
	if (!args.inspectOnly && !args.prompt) {
		throw new Error("--prompt is required unless --inspect-only is set");
	}
}

function formatResult(result: PireLiveLabAgentRunResult, lab: string): string {
	const lines = [
		"Pire Live Lab Result",
		`- lab: ${lab}`,
		`- label: ${result.assessment.label}`,
		`- session: ${result.sessionPath ?? "(none)"}`,
		`- proof artifacts: ${result.assessment.proofArtifacts.length}`,
		`- shortcut findings: ${result.shortcutFindings.length}`,
	];

	if (result.assessment.issues.length > 0) {
		lines.push("- issues:");
		for (const issue of result.assessment.issues) {
			lines.push(`  - ${issue}`);
		}
	}

	if (result.assessment.proofArtifacts.length > 0) {
		lines.push("- proof artifact paths:");
		for (const artifact of result.assessment.proofArtifacts) {
			lines.push(`  - ${artifact}`);
		}
	}

	return `${lines.join("\n")}\n`;
}

async function main(argv: string[]): Promise<void> {
	const args = parseArgs(argv);
	validateArgs(args);

	const paths = resolvePireLiveLabPaths(args.packageRoot);
	const result = args.inspectOnly
		? await inspectPireLiveLabAgentRun(paths, {
				lab: args.lab,
				sessionDir: args.sessionDir,
				logPath: args.logPath,
				disclosureMarkers: args.disclosureMarkers,
				forbiddenPaths: args.forbiddenPaths,
			})
		: await evaluatePireLiveLabAgentRun(paths, {
				lab: args.lab,
				prompt: args.prompt!,
				sessionDir: args.sessionDir,
				logPath: args.logPath,
				disclosureMarkers: args.disclosureMarkers,
				forbiddenPaths: args.forbiddenPaths,
				timeoutSeconds: args.timeoutSeconds,
			});

	if (args.json) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}

	process.stdout.write(formatResult(result, args.lab));
}

main(process.argv.slice(2)).catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`pire-live-labs: ${message}\n`);
	process.exitCode = 1;
});
