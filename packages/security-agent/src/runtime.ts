import { join } from "node:path";
import { Agent, type AgentEvent, type AgentMessage, type ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Api, ImageContent, Model, TextContent } from "@mariozechner/pi-ai";
import { getConfiguredApiKey } from "./auth.js";
import {
	formatInjectedContext,
	loadWorkspaceContextFiles,
	resolveWorkspaceRoot,
	type WorkspaceContextFile,
} from "./context.js";
import { type DebugSpec, loadDebugSpec } from "./debug-spec.js";
import { LogicMapStore } from "./logic-map/store.js";
import { clampThinkingLevel } from "./models.js";
import { NotebookStore } from "./notebook/store.js";
import { SECURITY_SYSTEM_PROMPT } from "./prompt.js";
import { seedSurfaceMapFromWorkspaceGraph } from "./surface-map/seed.js";
import { SurfaceMapStore } from "./surface-map/store.js";
import { createSecurityTools } from "./tools/index.js";
import type { PlanState } from "./tools/plan.js";
import {
	loadValidationSpec,
	type ValidationSessionState,
	type ValidationSpec,
	type ValidationToolDetails,
} from "./validation.js";
import { buildLiveTargetPriorSeed } from "./workspace-graph/live-priors.js";
import { buildWorkspaceGraphSeed } from "./workspace-graph/seed.js";
import { WorkspaceGraphStore } from "./workspace-graph/store.js";

function extractMessageText(message: AgentMessage): string {
	if (!("content" in message)) {
		return "";
	}

	if (typeof message.content === "string") {
		return message.content;
	}

	return (message.content as Array<TextContent | ImageContent>)
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

export interface SecurityAgentRuntimeOptions {
	cwd: string;
	workspaceRoot?: string;
	stateDir?: string;
	model: Model<Api>;
	thinkingLevel: ThinkingLevel;
	debugSpecPath?: string;
	validationSpecPath?: string;
	proofRepairAttempts?: number;
}

export class SecurityAgentRuntime {
	readonly cwd: string;
	readonly stateDir: string;
	readonly workspaceRoot: string;
	readonly logicMap: LogicMapStore;
	readonly notebook: NotebookStore;
	readonly surfaceMap: SurfaceMapStore;
	readonly workspaceGraph: WorkspaceGraphStore;
	readonly contextFiles: WorkspaceContextFile[];
	readonly planState: PlanState;
	readonly debugSpec?: DebugSpec;
	readonly validationSpec?: ValidationSpec;
	readonly validationState?: ValidationSessionState;
	readonly agent: Agent;
	private readonly proofRepairAttempts: number;
	private workspacePrepared = false;

	constructor(options: SecurityAgentRuntimeOptions) {
		this.cwd = options.cwd;
		this.stateDir = options.stateDir ?? options.cwd;
		this.logicMap = new LogicMapStore(this.stateDir);
		this.notebook = new NotebookStore(this.stateDir);
		this.surfaceMap = new SurfaceMapStore(this.stateDir);
		this.contextFiles = loadWorkspaceContextFiles(options.cwd, options.workspaceRoot);
		this.workspaceRoot = resolveWorkspaceRoot(options.cwd, this.contextFiles, options.workspaceRoot);
		this.workspaceGraph = new WorkspaceGraphStore(this.workspaceRoot);
		this.planState = {};
		this.debugSpec = options.debugSpecPath ? loadDebugSpec(options.debugSpecPath) : undefined;
		this.validationSpec = options.validationSpecPath ? loadValidationSpec(options.validationSpecPath) : undefined;
		this.validationState = this.validationSpec ? { attempts: 0, history: [] } : undefined;
		this.proofRepairAttempts = options.proofRepairAttempts ?? (this.validationSpec ? 2 : 0);

		this.agent = new Agent({
			initialState: {
				systemPrompt: SECURITY_SYSTEM_PROMPT,
				model: options.model,
				thinkingLevel: options.thinkingLevel,
				tools: createSecurityTools({
					cwd: this.cwd,
					artifactsDir: join(this.stateDir, ".pire", "artifacts"),
					logicMap: this.logicMap,
					notebook: this.notebook,
					surfaceMap: this.surfaceMap,
					workspaceGraph: this.workspaceGraph,
					planState: this.planState,
					debugSpec: this.debugSpec,
					validationSpec: this.validationSpec,
					validationState: this.validationState,
				}),
				messages: [],
			},
			toolExecution: "parallel",
			getApiKey: (provider) => getConfiguredApiKey(provider),
			transformContext: async (messages) => this.injectContext(messages),
		});
	}

	private async injectContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
		await this.ensureWorkspacePrepared(messages);
		const injectedContext = formatInjectedContext({
			cwd: this.cwd,
			contextFiles: this.contextFiles,
			notebookText: this.notebook.formatForPrompt(),
			surfaceMapText: this.surfaceMap.formatForPrompt(),
			logicMapText: this.logicMap.formatForPrompt(),
			workspaceGraphText: this.workspaceGraph.formatForPrompt(),
		});

		const contextMessage: AgentMessage = {
			role: "user",
			content: [{ type: "text", text: injectedContext }],
			timestamp: Date.now(),
		};

		return [contextMessage, ...messages];
	}

	private async ensureWorkspacePrepared(messages: AgentMessage[]): Promise<void> {
		if (this.workspaceGraph.isEmpty()) {
			const seed = buildWorkspaceGraphSeed(this.workspaceRoot);
			await this.workspaceGraph.seedIfEmpty(seed);
		}

		await this.refreshLiveTargetPriors(messages);

		if (this.workspacePrepared) {
			return;
		}
		await seedSurfaceMapFromWorkspaceGraph(this.surfaceMap, this.workspaceGraph);
		this.workspacePrepared = true;
	}

	private async refreshLiveTargetPriors(messages: AgentMessage[]): Promise<void> {
		const textSources = [
			...this.contextFiles.map((file) => ({ text: file.content, source: file.path })),
			...messages
				.filter((message) => message.role === "user")
				.map((message, index) => ({
					text: extractMessageText(message),
					source: `message:${index + 1}`,
				}))
				.filter((source) => source.text.trim().length > 0),
		];
		if (textSources.length === 0) {
			return;
		}

		const seed = buildLiveTargetPriorSeed(textSources);
		if (seed.nodes.length > 0 || (seed.edges?.length ?? 0) > 0) {
			await this.workspaceGraph.mergeSeed(seed);
		}
	}

	subscribe(listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void): () => void {
		return this.agent.subscribe(listener);
	}

	get model(): Model<Api> {
		return this.agent.state.model;
	}

	get thinkingLevel(): ThinkingLevel {
		return this.agent.state.thinkingLevel;
	}

	get state() {
		return this.agent.state;
	}

	setModel(model: Model<Api>): ThinkingLevel {
		this.agent.state.model = model;
		const clampedThinkingLevel = clampThinkingLevel(model, this.agent.state.thinkingLevel);
		this.agent.state.thinkingLevel = clampedThinkingLevel;
		return clampedThinkingLevel;
	}

	setThinkingLevel(thinkingLevel: ThinkingLevel): ThinkingLevel {
		const clampedThinkingLevel = clampThinkingLevel(this.agent.state.model, thinkingLevel);
		this.agent.state.thinkingLevel = clampedThinkingLevel;
		return clampedThinkingLevel;
	}

	reset(): void {
		this.agent.reset();
		this.planState.current = undefined;
		if (this.validationState) {
			this.validationState.attempts = 0;
			this.validationState.lastResult = undefined;
			this.validationState.history = [];
		}
	}

	async prompt(prompt: string): Promise<void> {
		const startingAttempts = this.validationState?.attempts ?? 0;
		await this.agent.prompt(prompt);
		await this.runProofRepairLoop(startingAttempts);
	}

	async continue(): Promise<void> {
		const startingAttempts = this.validationState?.attempts ?? 0;
		await this.agent.continue();
		await this.runProofRepairLoop(startingAttempts);
	}

	abort(): void {
		this.agent.abort();
	}

	waitForIdle(): Promise<void> {
		return this.agent.waitForIdle();
	}

	private async runProofRepairLoop(startingAttempts: number): Promise<void> {
		if (!this.validationState || !this.validationSpec || this.proofRepairAttempts <= 0) {
			return;
		}

		let observedAttempts = this.validationState.attempts;
		if (observedAttempts <= startingAttempts) {
			return;
		}

		for (let repairAttempt = 1; repairAttempt <= this.proofRepairAttempts; repairAttempt++) {
			const lastResult = this.validationState.lastResult;
			if (!lastResult) {
				return;
			}
			if (lastResult.status === "proof_complete" || lastResult.status === "blocked") {
				return;
			}

			await this.agent.prompt(this.buildProofRepairPrompt(lastResult, repairAttempt));

			if (this.validationState.attempts <= observedAttempts) {
				return;
			}
			observedAttempts = this.validationState.attempts;
		}
	}

	private buildProofRepairPrompt(result: ValidationToolDetails, repairAttempt: number): string {
		const previousResult = this.getPreviousValidationResult(result);
		const repeatedStatus = previousResult?.status === result.status;
		const lines = [
			`Validation feedback for the current candidate artifact:`,
			`- validator: ${result.validator}`,
			`- attempt: ${result.attempt}`,
			`- status: ${result.status}`,
			`- summary: ${result.summary}`,
		];

		if (result.nextStep) {
			lines.push(`- suggested next step: ${result.nextStep}`);
		}

		lines.push(
			``,
			`Keep the target path fixed. Repair the smallest acceptance or trigger gap that this feedback identifies, then validate again.`,
			`If the artifact cannot be repaired with a concrete next mutation, state the blocker explicitly instead of broadening the search.`,
			`If the remaining blocker depends on runtime state, allocator layout, copied buffers, or timing, use the debug tool to inspect the live target instead of guessing new artifacts.`,
		);
		if (repeatedStatus && result.status !== "proof_complete") {
			lines.push(
				``,
				`Calibration step: before inventing more variants, create or locate the smallest benign control artifact or action that should stay on the same target path without triggering the bug, then validate it.`,
				`If that control fails with the same validator status, treat the validator or runtime as uncalibrated and report the blocker instead of continuing blind mutation.`,
			);
		}

		if (result.stdout) {
			lines.push(``, `Validator stdout:`, result.stdout);
		}
		if (result.stderr) {
			lines.push(``, `Validator stderr:`, result.stderr);
		}

		if (repairAttempt >= this.proofRepairAttempts) {
			lines.push(
				``,
				`This is the final automatic repair attempt. Either produce a validated artifact or report the concrete blocker.`,
			);
		}

		return lines.join("\n");
	}

	private getPreviousValidationResult(result: ValidationToolDetails): ValidationToolDetails | undefined {
		const history = this.validationState?.history;
		if (!history || history.length < 2) {
			return undefined;
		}

		const lastIndex = history.at(-1) === result ? history.length - 2 : history.length - 1;
		return lastIndex >= 0 ? history[lastIndex] : undefined;
	}
}
