import { type ExecFileException, execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@mariozechner/pi-ai";

const execFileAsync = promisify(execFile);

export interface BashToolDetails {
	stdout: string;
	stderr: string;
	exitCode: number;
	truncated: boolean;
	timedOut: boolean;
}

const bashToolSchema = Type.Object({
	command: Type.String({ description: "Shell command to execute with bash -lc" }),
	timeout_ms: Type.Optional(Type.Number({ description: "Execution timeout in milliseconds" })),
});

type BashToolParams = Static<typeof bashToolSchema>;

function normalizeOutput(output: string, maxLength: number): { text: string; truncated: boolean } {
	if (output.length <= maxLength) {
		return { text: output, truncated: false };
	}

	return {
		text: output.slice(-maxLength),
		truncated: true,
	};
}

function isExecFileException(
	error: unknown,
): error is ExecFileException & { stdout?: string | Buffer; stderr?: string | Buffer } {
	return error instanceof Error;
}

function normalizeExecOutput(output: unknown): string {
	if (typeof output === "string") {
		return output;
	}

	if (Buffer.isBuffer(output)) {
		return output.toString("utf-8");
	}

	return "";
}

export function createBashTool(cwd: string): AgentTool<typeof bashToolSchema, BashToolDetails> {
	return {
		name: "bash",
		label: "Bash",
		description:
			"Execute a local bash command in the workspace for source inspection, file generation, and lightweight verification.",
		parameters: bashToolSchema,
		async execute(_toolCallId: string, params: BashToolParams) {
			try {
				const childResult = await execFileAsync("bash", ["-lc", params.command], {
					cwd,
					timeout: params.timeout_ms ?? 60000,
					maxBuffer: 5 * 1024 * 1024,
					env: process.env,
				});
				const stdout = normalizeOutput(childResult.stdout, 50_000);
				const stderr = normalizeOutput(childResult.stderr, 10_000);
				const truncated = stdout.truncated || stderr.truncated;

				const outputParts: string[] = [];
				if (stdout.text) {
					outputParts.push(stdout.text);
				}
				if (stderr.text) {
					outputParts.push(`stderr:\n${stderr.text}`);
				}
				if (outputParts.length === 0) {
					outputParts.push("(no output)");
				}

				return {
					content: [{ type: "text", text: outputParts.join("\n") }],
					details: {
						stdout: stdout.text,
						stderr: stderr.text,
						exitCode: 0,
						truncated,
						timedOut: false,
					},
				};
			} catch (error: unknown) {
				if (!isExecFileException(error)) {
					throw error;
				}

				const stdoutText = normalizeExecOutput(error.stdout);
				const stderrText = normalizeExecOutput(error.stderr);
				const stdout = normalizeOutput(stdoutText, 50_000);
				const stderr = normalizeOutput(stderrText, 10_000);
				const truncated = stdout.truncated || stderr.truncated;
				const timedOut = error.killed === true || error.message.includes("timed out");
				const exitCode = typeof error.code === "number" ? error.code : 1;

				const outputParts: string[] = [];
				if (stdout.text) {
					outputParts.push(stdout.text);
				}
				if (stderr.text) {
					outputParts.push(`stderr:\n${stderr.text}`);
				}
				if (outputParts.length === 0) {
					outputParts.push(error.message);
				}

				return {
					content: [{ type: "text", text: outputParts.join("\n") }],
					details: {
						stdout: stdout.text,
						stderr: stderr.text,
						exitCode,
						truncated,
						timedOut,
					},
				};
			}
		},
	};
}
