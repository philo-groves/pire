#!/usr/bin/env node

import { isAbsolute, join } from "node:path";
import {
	createGeneratedScenarioPresetScaffold,
	loadPireEvalTaskSuite,
	type PireGeneratedScenarioPreset,
	writeGeneratedScenarioFixtureCase,
} from "./index.js";

interface PireEvalScaffoldArgs {
	suitePath: string;
	casesDir: string;
	taskId: string;
	preset: PireGeneratedScenarioPreset;
	caseName: string;
	model?: string;
}

function parseArgs(argv: string[]): PireEvalScaffoldArgs {
	let suitePath = "";
	let casesDir = ".";
	let taskId = "";
	let preset = "" as PireGeneratedScenarioPreset;
	let caseName = "";
	let model: string | undefined;

	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--suite") {
			suitePath = argv[index + 1] ?? "";
			index += 1;
			continue;
		}
		if (value === "--cases-dir") {
			casesDir = argv[index + 1] ?? "";
			index += 1;
			continue;
		}
		if (value === "--task-id") {
			taskId = argv[index + 1] ?? "";
			index += 1;
			continue;
		}
		if (value === "--preset") {
			preset = (argv[index + 1] ?? "") as PireGeneratedScenarioPreset;
			index += 1;
			continue;
		}
		if (value === "--case-name") {
			caseName = argv[index + 1] ?? "";
			index += 1;
			continue;
		}
		if (value === "--model") {
			model = argv[index + 1] ?? "";
			index += 1;
			continue;
		}
		throw new Error(`unknown argument: ${value}`);
	}

	if (!suitePath) {
		throw new Error("missing required --suite");
	}
	if (!taskId) {
		throw new Error("missing required --task-id");
	}
	if (preset !== "pass" && preset !== "proof-gap" && preset !== "chain-gap") {
		throw new Error("missing or invalid --preset (expected pass, proof-gap, or chain-gap)");
	}
	if (!caseName) {
		throw new Error("missing required --case-name");
	}

	return { suitePath, casesDir, taskId, preset, caseName, model };
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const suite = await loadPireEvalTaskSuite(args.suitePath);
	const task = suite.tasks.find((entry) => entry.id === args.taskId);
	if (!task) {
		throw new Error(`task ${args.taskId} not found in suite ${suite.suiteId}`);
	}

	const fixture = createGeneratedScenarioPresetScaffold({
		task,
		caseName: args.caseName,
		preset: args.preset,
		model: args.model,
	});

	const rootDir = isAbsolute(args.casesDir) ? args.casesDir : join(process.cwd(), args.casesDir);
	const caseDir = await writeGeneratedScenarioFixtureCase(rootDir, fixture);
	process.stdout.write(`${caseDir}\n`);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
});
