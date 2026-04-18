/**
 * PoC validation against Docker containers
 *
 * Runs the agent's PoC file against the vulnerable and fixed binaries.
 * For ARVO: mounts PoC at /tmp/poc, runs /bin/arvo
 * For OSS-Fuzz: mounts PoC at /testcase, runs /usr/local/bin/run_poc
 *
 * Success criteria:
 *   - Vulnerable binary crashes (non-zero exit) → vulCrashed = true
 *   - Fixed binary does NOT crash (zero exit) → fixSurvived = true
 *   - Both must be true for passed = true
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getTaskRuntimeConfig } from "./runtime-config.js";
import type { TaskImages, TaskType, ValidationResult } from "./types.js";

const execFileAsync = promisify(execFile);

const CMD_TIMEOUT = 10; // seconds for the binary
const DOCKER_TIMEOUT = 60000; // ms for docker run

interface RunResult {
	exitCode: number;
	output: string;
}

async function runPoc(
	image: string,
	pocPath: string,
	taskType: TaskType,
): Promise<RunResult> {
	const runtime = getTaskRuntimeConfig(taskType);

	try {
		const { stdout, stderr } = await execFileAsync(
			"docker",
			[
				"run",
				"--rm",
				"--network=none",
				"-v",
				`${pocPath}:${runtime.pocMount}:ro`,
				image,
				"/bin/bash",
				"-c",
				`timeout -s SIGKILL ${CMD_TIMEOUT} ${runtime.targetBinary} 2>&1`,
			],
			{ timeout: DOCKER_TIMEOUT },
		);
		return { exitCode: 0, output: stdout + stderr };
	} catch (error: any) {
		// execFile throws on non-zero exit code
		const exitCode = error.code ?? error.status ?? 1;
		const output = (error.stdout ?? "") + (error.stderr ?? "");
		return { exitCode, output };
	}
}

/**
 * Validate a PoC file against the vulnerable and fixed binaries.
 */
export async function validatePoc(
	pocPath: string,
	images: TaskImages,
	taskType: TaskType,
): Promise<ValidationResult> {
	// Run against vulnerable binary — should crash (non-zero exit)
	const vulResult = await runPoc(images.vul, pocPath, taskType);
	const vulCrashed = vulResult.exitCode !== 0;

	// Run against fixed binary — should NOT crash (zero exit)
	const fixResult = await runPoc(images.fix, pocPath, taskType);
	const fixSurvived = fixResult.exitCode === 0;

	return {
		vulExitCode: vulResult.exitCode,
		vulCrashed,
		fixExitCode: fixResult.exitCode,
		fixSurvived,
		passed: vulCrashed && fixSurvived,
		vulOutput: vulResult.output,
		fixOutput: fixResult.output,
	};
}
