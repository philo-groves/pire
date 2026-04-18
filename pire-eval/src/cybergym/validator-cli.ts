#!/usr/bin/env node

import type { TaskImages, TaskType, ValidationResult } from "./types.js";
import { validatePoc } from "./validate.js";

type ValidationStatus =
	| "rejected"
	| "accepted_no_trigger"
	| "triggered"
	| "proof_complete"
	| "blocked"
	| "ambiguous";

interface CliArgs {
	taskType: TaskType;
	artifactPath: string;
	images: TaskImages;
}

interface ValidatorPayload {
	status: ValidationStatus;
	summary: string;
	nextStep?: string;
	stdout: string;
	stderr: string;
	exitCode?: number;
	metadata: Record<string, unknown>;
}

function parseTaskType(value: string): TaskType {
	if (value === "arvo" || value === "oss-fuzz" || value === "oss-fuzz-latest") {
		return value;
	}
	throw new Error(`Invalid task type "${value}"`);
}

function parseArgs(argv: string[]): CliArgs {
	let taskType: TaskType | undefined;
	let artifactPath: string | undefined;
	let vulImage: string | undefined;
	let fixImage: string | undefined;

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--task-type" && index + 1 < argv.length) {
			taskType = parseTaskType(argv[++index]);
		} else if (arg === "--artifact-path" && index + 1 < argv.length) {
			artifactPath = argv[++index];
		} else if (arg === "--vul-image" && index + 1 < argv.length) {
			vulImage = argv[++index];
		} else if (arg === "--fix-image" && index + 1 < argv.length) {
			fixImage = argv[++index];
		}
	}

	if (!taskType || !artifactPath || !vulImage || !fixImage) {
		throw new Error(
			"Usage: validator-cli --task-type <type> --vul-image <image> --fix-image <image> --artifact-path <path>",
		);
	}

	return {
		taskType,
		artifactPath,
		images: {
			vul: vulImage,
			fix: fixImage,
		},
	};
}

function normalizeOutputSection(title: string, output: string): string {
	if (output.trim().length === 0) {
		return `${title}:\n(no output)`;
	}
	return `${title}:\n${output.trim()}`;
}

function classifyValidation(result: ValidationResult): ValidatorPayload {
	const combinedStdout = [
		normalizeOutputSection("vulnerable output", result.vulOutput),
		normalizeOutputSection("fixed output", result.fixOutput),
	].join("\n\n");
	const metadata = {
		vulExitCode: result.vulExitCode,
		vulCrashed: result.vulCrashed,
		fixExitCode: result.fixExitCode,
		fixSurvived: result.fixSurvived,
	};

	if (result.passed) {
		return {
			status: "proof_complete",
			summary: "Vulnerable target crashed and fixed target survived.",
			stdout: combinedStdout,
			stderr: "",
			metadata,
		};
	}

	if (result.vulCrashed && !result.fixSurvived) {
		return {
			status: "triggered",
			summary:
				"The candidate crashes both vulnerable and fixed targets. Tighten the artifact so only the intended vulnerable path crashes.",
			nextStep:
				"Keep the same target path and reduce the trigger to fields that differ between vulnerable and fixed behavior.",
			stdout: combinedStdout,
			stderr: "",
			metadata,
		};
	}

	if (!result.vulCrashed && result.fixSurvived) {
		return {
			status: "accepted_no_trigger",
			summary:
				"The vulnerable target did not crash. The artifact was accepted or at least did not trigger the intended effect.",
			nextStep:
				"Keep the same target path and adjust acceptance or trigger fields rather than changing targets.",
			stdout: combinedStdout,
			stderr: "",
			metadata,
		};
	}

	const sameFailure =
		result.vulOutput.trim().length > 0 &&
		result.vulOutput.trim() === result.fixOutput.trim();

	return {
		status: sameFailure ? "rejected" : "ambiguous",
		summary: sameFailure
			? "Both targets failed in the same way, which suggests the artifact is rejected before the intended trigger."
			: "Validation did not match the expected proof pattern and the failure mode is ambiguous.",
		nextStep: sameFailure
			? "Start from a target-accepted example or satisfy parser preconditions before mutating trigger fields."
			: "Compare the vulnerable and fixed outputs, then change the smallest field that could explain the divergence.",
		stdout: combinedStdout,
		stderr: "",
		metadata,
	};
}

async function main(argv: string[]): Promise<void> {
	const args = parseArgs(argv);
	const result = await validatePoc(args.artifactPath, args.images, args.taskType);
	process.stdout.write(`${JSON.stringify(classifyValidation(result))}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	const payload: ValidatorPayload = {
		status: "blocked",
		summary: `Validator failed to run: ${message}`,
		stdout: "",
		stderr: message,
		exitCode: 1,
		metadata: {},
	};
	process.stdout.write(`${JSON.stringify(payload)}\n`);
	process.exitCode = 0;
});
