import { createWriteStream, existsSync, mkdirSync, type WriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { stderr, stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import { runInteractiveTui } from "./interactive-tui.js";
import { clampThinkingLevel, parseThinkingLevel, resolveModel } from "./models.js";
import { SecurityAgentRuntime } from "./runtime.js";

interface CliArgs {
	provider?: string;
	modelId?: string;
	thinkingLevel?: ThinkingLevel;
	mode: "text" | "json";
	print: boolean;
	sessionDir?: string;
	workspaceRoot?: string;
	debugSpecPath?: string;
	validationSpecPath?: string;
	proofRepairAttempts?: number;
	prompts: string[];
	help: boolean;
}

function printHelp(): void {
	stdout.write(`pire - security research agent

Usage:
  pire [options] [prompt...]

Options:
  -p, --print              Run prompts once and exit
  --mode <text|json>       Output assistant text or JSON events
  --provider <name>        Provider name
  --model <id>             Model id
  --thinking <level>       Thinking level: off, minimal, low, medium, high, xhigh
  --session-dir <dir>      Directory for stored conversations and event logs
  --workspace-root <dir>   Bound workspace context and graph indexing to this root
  --debug-spec <path>      JSON spec describing an external debug command
  --validation-spec <path> JSON spec describing an external validation command
  --repair-attempts <n>    Automatic repair turns after failed validation (default: 2 when validation is configured)
  -e, --extension <path>   Accepted for compatibility and ignored
  --help, -h               Show this help
`);
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		mode: "text",
		print: false,
		prompts: [],
		help: false,
	};

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") {
			args.help = true;
		} else if (arg === "--provider" && index + 1 < argv.length) {
			args.provider = argv[++index];
		} else if (arg === "--model" && index + 1 < argv.length) {
			args.modelId = argv[++index];
		} else if (arg === "--thinking" && index + 1 < argv.length) {
			const thinkingLevel = parseThinkingLevel(argv[++index]);
			if (!thinkingLevel) {
				throw new Error("Invalid thinking level");
			}
			args.thinkingLevel = thinkingLevel;
		} else if (arg === "--mode" && index + 1 < argv.length) {
			const mode = argv[++index];
			if (mode !== "text" && mode !== "json") {
				throw new Error(`Invalid mode "${mode}"`);
			}
			args.mode = mode;
		} else if (arg === "--session-dir" && index + 1 < argv.length) {
			args.sessionDir = resolve(argv[++index]);
		} else if (arg === "--workspace-root" && index + 1 < argv.length) {
			args.workspaceRoot = resolve(argv[++index]);
		} else if (arg === "--debug-spec" && index + 1 < argv.length) {
			args.debugSpecPath = resolve(argv[++index]);
		} else if (arg === "--validation-spec" && index + 1 < argv.length) {
			args.validationSpecPath = resolve(argv[++index]);
		} else if (arg === "--repair-attempts" && index + 1 < argv.length) {
			const parsed = Number.parseInt(argv[++index], 10);
			if (!Number.isFinite(parsed) || parsed < 0) {
				throw new Error("Invalid repair attempt count");
			}
			args.proofRepairAttempts = parsed;
		} else if (arg === "-p" || arg === "--print") {
			args.print = true;
		} else if ((arg === "-e" || arg === "--extension") && index + 1 < argv.length) {
			index++;
		} else if (!arg.startsWith("-")) {
			args.prompts.push(arg);
		}
	}

	return args;
}

async function readStdinPrompt(): Promise<string | undefined> {
	if (stdin.isTTY) {
		return undefined;
	}

	const chunks: Buffer[] = [];
	for await (const chunk of stdin) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	const text = Buffer.concat(chunks).toString("utf-8").trim();
	return text.length > 0 ? text : undefined;
}

function attachEventLogSink(runtime: SecurityAgentRuntime): () => void {
	let activeLogPath: string | undefined;
	let eventStream: WriteStream | undefined;

	const ensureStream = (): void => {
		const sessionFile = runtime.sessionFile;
		const nextLogPath = sessionFile ? sessionFile.replace(/\.jsonl$/u, ".events.jsonl") : undefined;
		if (nextLogPath === activeLogPath) {
			return;
		}

		eventStream?.end();
		eventStream = undefined;
		activeLogPath = nextLogPath;

		if (!nextLogPath) {
			return;
		}

		const logDir = dirname(nextLogPath);
		if (!existsSync(logDir)) {
			mkdirSync(logDir, { recursive: true });
		}
		eventStream = createWriteStream(nextLogPath, { flags: "a" });
	};

	const unsubscribe = runtime.subscribe((event) => {
		ensureStream();
		eventStream?.write(`${JSON.stringify(event)}\n`);
	});

	return () => {
		unsubscribe();
		eventStream?.end();
	};
}

function attachStdoutSink(runtime: SecurityAgentRuntime, mode: "text" | "json"): () => void {
	let wroteAssistantText = false;

	const unsubscribe = runtime.subscribe((event) => {
		if (mode === "json") {
			stdout.write(`${JSON.stringify(event)}\n`);
			return;
		}

		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			wroteAssistantText = true;
			stdout.write(event.assistantMessageEvent.delta);
			return;
		}

		if (event.type === "agent_end" && wroteAssistantText) {
			stdout.write("\n");
			wroteAssistantText = false;
		}
	});

	return () => {
		unsubscribe();
	};
}

async function runPromptSequence(runtime: SecurityAgentRuntime, prompts: string[]): Promise<void> {
	for (const prompt of prompts) {
		await runtime.prompt(prompt);
	}
}

async function runReadlineInteractive(runtime: SecurityAgentRuntime): Promise<void> {
	const reader = createInterface({
		input: stdin,
		output: stdout,
	});

	try {
		while (true) {
			const line = await reader.question("pire> ");
			const prompt = line.trim();
			if (prompt.length === 0) {
				continue;
			}
			if (prompt === "exit" || prompt === "quit") {
				break;
			}
			await runtime.prompt(prompt);
		}
	} finally {
		reader.close();
	}
}

function resolveThinking(requested: ThinkingLevel | undefined, model: Model<Api>): ThinkingLevel {
	const desired = requested ?? (model.reasoning ? "medium" : "off");
	return clampThinkingLevel(model, desired);
}

export async function runCli(argv: string[]): Promise<number> {
	const args = parseArgs(argv);
	if (args.help) {
		printHelp();
		return 0;
	}

	const stdinPrompt = await readStdinPrompt();
	const prompts = stdinPrompt ? [...args.prompts, stdinPrompt] : args.prompts;
	const model = resolveModel({
		provider: args.provider,
		modelId: args.modelId,
	});
	const runtime = new SecurityAgentRuntime({
		cwd: process.cwd(),
		workspaceRoot: args.workspaceRoot,
		stateDir: args.sessionDir ?? process.cwd(),
		sessionDir: args.sessionDir,
		model,
		thinkingLevel: resolveThinking(args.thinkingLevel, model),
		debugSpecPath: args.debugSpecPath,
		validationSpecPath: args.validationSpecPath,
		proofRepairAttempts: args.proofRepairAttempts,
	});
	const detachEventLog = attachEventLogSink(runtime);

	try {
		if (prompts.length > 0) {
			const detachStdout = attachStdoutSink(runtime, args.mode);
			try {
				await runPromptSequence(runtime, prompts);
			} finally {
				detachStdout();
			}
			return 0;
		}

		if (args.print) {
			throw new Error("No prompt provided");
		}

		if (args.mode === "text" && stdin.isTTY && stdout.isTTY) {
			await runInteractiveTui(runtime);
		} else {
			const detachStdout = attachStdoutSink(runtime, args.mode);
			try {
				await runReadlineInteractive(runtime);
			} finally {
				detachStdout();
			}
		}
		return 0;
	} finally {
		detachEventLog();
	}
}

export async function runCliMain(argv: string[]): Promise<void> {
	try {
		const exitCode = await runCli(argv);
		process.exitCode = exitCode;
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		stderr.write(`pire: ${message}\n`);
		process.exitCode = 1;
	}
}
