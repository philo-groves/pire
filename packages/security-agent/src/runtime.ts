import { dirname, join, resolve } from "node:path";
import { Agent, type AgentEvent, type AgentMessage, type ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Api, ImageContent, Model, TextContent } from "@mariozechner/pi-ai";
import { getConfiguredApiKey } from "./auth.js";
import {
	containsWorkspaceContextReference,
	loadWorkspaceContextFiles,
	resolveWorkspaceRoot,
	type WorkspaceContextFile,
} from "./context.js";
import { assembleResearchContextWindow } from "./context-window.js";
import { type DebugSpec, loadDebugSpec } from "./debug-spec.js";
import { type ResearchGraphHtmlResult, writeResearchGraphHtml } from "./graph-export.js";
import { type LogicMapData, LogicMapStore, type LogicRecord } from "./logic-map/store.js";
import { clampThinkingLevel, resolveModel } from "./models.js";
import { type NotebookData, NotebookStore } from "./notebook/store.js";
import { SECURITY_SYSTEM_PROMPT } from "./prompt.js";
import {
	listSessions,
	type PersistedCompactionSummary,
	readSessionInfo,
	type SessionContext,
	type SessionInfo,
	SessionManager,
} from "./session-manager.js";
import { seedSurfaceMapFromWorkspaceGraph } from "./surface-map/seed.js";
import { type SurfaceMapData, SurfaceMapStore, type SurfaceRecord } from "./surface-map/store.js";
import { createSecurityTools } from "./tools/index.js";
import { formatPlan, type PlanState, reconcileResearchPlan } from "./tools/plan.js";
import {
	loadValidationSpec,
	type ValidationSessionState,
	type ValidationSpec,
	type ValidationToolDetails,
} from "./validation.js";
import { buildLiveTargetPriorSeed } from "./workspace-graph/live-priors.js";
import { buildWorkspaceGraphSeed } from "./workspace-graph/seed.js";
import { type WorkspaceGraphData, type WorkspaceGraphNode, WorkspaceGraphStore } from "./workspace-graph/store.js";

const STALE_RECOMMENDATION_HINTS = [
	"already closed out",
	"already closed-loop",
	"already closed loop",
	"closed out",
	"closed-loop",
	"closed loop",
	"lowered as non-impactful",
	"lowered as non impactful",
	"lowered as",
	"lowered this adjacent surface",
	"non-impactful",
	"non impactful",
	"ready for write-up",
	"ready for writeup",
	"ready for report",
	"reportable issue",
	"does not need deeper",
	"doesn't need deeper",
	"no deeper work",
	"best next move is option",
	"control path",
	"validated proof",
	"validated and promoted",
	"validated exploit",
	"validated bug",
	"validated issue",
	"promoted durable finding",
	"durable finding exists",
	"durable finding already exists",
	"real path proof exists",
	"real-path proof exists",
	"remains the validated",
	"leave deprioritized",
	"deprioritized unless new evidence reopens it",
	"target-backed, promoted",
	"target backed, promoted",
	"promoted sample bug",
	"already a target-backed",
	"already a target backed",
];

interface ConfirmedFindingCoverage {
	surfaceIds: Set<string>;
	findingTexts: string[];
}

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

function compactActionText(text: string, maxChars = 120): string {
	const compact = text.replace(/\s+/g, " ").trim();
	if (compact.length <= maxChars) {
		return compact;
	}
	return `${compact.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function ensureSentence(text: string): string {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return trimmed;
	}
	return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function formatList(values: string[]): string {
	if (values.length === 0) {
		return "";
	}
	if (values.length === 1) {
		return values[0]!;
	}
	if (values.length === 2) {
		return `${values[0]!} and ${values[1]!}`;
	}
	return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function formatOptionLabel(index: number): string {
	let value = index;
	let label = "";

	do {
		label = String.fromCharCode(65 + (value % 26)) + label;
		value = Math.floor(value / 26) - 1;
	} while (value >= 0);

	return label;
}

function surfaceRecommendationPriority(surface: SurfaceRecord): number {
	switch (surface.status) {
		case "active":
			return 6;
		case "hot":
			return 5;
		case "blocked":
			return 4;
		case "candidate":
			return 3;
		case "covered":
		case "confirmed":
		case "rejected":
			return 0;
	}
}

function logicRecommendationPriority(rule: LogicRecord): number {
	switch (rule.status) {
		case "violated":
			return 5;
		case "candidate":
			return 4;
		case "aligned":
			return 3;
		case "confirmed":
		case "rejected":
			return 0;
	}
}

function compareUpdatedAtDesc(left: { updatedAt: string }, right: { updatedAt: string }): number {
	return right.updatedAt.localeCompare(left.updatedAt);
}

function normalizeRecommendationText(value: string): string {
	return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function shouldUseFindingCoverageKey(value: string): boolean {
	const normalized = normalizeRecommendationText(value);
	return normalized.length >= 12 || /[:/._-]/.test(value);
}

function hasStaleRecommendationSignal(values: Iterable<string>): boolean {
	const text = normalizeRecommendationText([...values].join(" "));
	if (text.length === 0) {
		return false;
	}

	return STALE_RECOMMENDATION_HINTS.some((hint) => text.includes(hint));
}

function getSurfaceReason(surface: SurfaceRecord): string | undefined {
	if (surface.why?.trim()) {
		return compactActionText(surface.why);
	}
	const firstEvidence = surface.evidence.find((entry) => entry.trim().length > 0);
	return firstEvidence ? compactActionText(firstEvidence) : undefined;
}

function isStaleRecommendationSurface(surface: SurfaceRecord): boolean {
	return hasStaleRecommendationSignal([surface.why ?? "", ...surface.evidence]);
}

function isIgnoredRecommendationSurface(surface: SurfaceRecord): boolean {
	return [surface.id, surface.label, surface.why ?? "", ...surface.evidence].some((value) =>
		containsWorkspaceContextReference(value),
	);
}

function isStaleRecommendationRule(rule: LogicRecord): boolean {
	return hasStaleRecommendationSignal([rule.label, rule.intended, rule.implemented, rule.gap, ...rule.evidence]);
}

function isIgnoredRecommendationRule(rule: LogicRecord): boolean {
	if (
		[rule.id, rule.label, rule.intended, rule.implemented, rule.gap, ...rule.evidence].some((value) =>
			containsWorkspaceContextReference(value),
		)
	) {
		return true;
	}

	return rule.surfaces.length > 0 && rule.surfaces.every((surface) => containsWorkspaceContextReference(surface));
}

function isIgnoredRecommendationNode(node: WorkspaceGraphNode): boolean {
	return [node.id, node.label, node.summary ?? "", node.text, node.path ?? "", ...node.tags].some((value) =>
		containsWorkspaceContextReference(value),
	);
}

function isStaleRecommendationNode(node: WorkspaceGraphNode): boolean {
	return hasStaleRecommendationSignal([node.label, node.summary ?? "", node.text, ...node.tags]);
}

function collectConfirmedFindingCoverage(workspaceGraph: WorkspaceGraphData): ConfirmedFindingCoverage {
	const findingNodes = Object.values(workspaceGraph.nodes).filter(
		(node) => node.kind === "finding" && node.status === "confirmed",
	);
	if (findingNodes.length === 0) {
		return { surfaceIds: new Set<string>(), findingTexts: [] };
	}

	const findingIds = new Set(findingNodes.map((node) => node.id));
	const surfaceIds = new Set<string>();
	const findingTexts = new Set<string>();

	for (const finding of findingNodes) {
		for (const value of [finding.id, finding.label, finding.summary ?? "", finding.text, ...finding.tags]) {
			const normalized = normalizeRecommendationText(value);
			if (normalized.length > 0) {
				findingTexts.add(normalized);
			}
		}

		for (const tag of finding.tags) {
			if (tag.includes(":")) {
				surfaceIds.add(tag.toLowerCase());
			}
		}
	}

	for (const edge of workspaceGraph.edges) {
		if (edge.relation !== "touches") {
			continue;
		}
		if (findingIds.has(edge.from)) {
			surfaceIds.add(edge.to.toLowerCase());
		}
		if (findingIds.has(edge.to)) {
			surfaceIds.add(edge.from.toLowerCase());
		}
	}

	return {
		surfaceIds,
		findingTexts: [...findingTexts],
	};
}

function findingCoverageContainsAny(values: Iterable<string>, coverage: ConfirmedFindingCoverage): boolean {
	for (const value of values) {
		if (!shouldUseFindingCoverageKey(value)) {
			continue;
		}
		const normalized = normalizeRecommendationText(value);
		if (normalized.length === 0) {
			continue;
		}
		if (coverage.surfaceIds.has(normalized)) {
			return true;
		}
		if (coverage.findingTexts.some((text) => text.includes(normalized))) {
			return true;
		}
	}
	return false;
}

function isCoveredRecommendationSurface(surface: SurfaceRecord, coverage: ConfirmedFindingCoverage): boolean {
	return findingCoverageContainsAny([surface.id, surface.label], coverage);
}

function isCoveredRecommendationRule(rule: LogicRecord, coverage: ConfirmedFindingCoverage): boolean {
	return findingCoverageContainsAny([rule.id, rule.label, ...rule.surfaces], coverage);
}

function isCoveredRecommendationNode(node: WorkspaceGraphNode, coverage: ConfirmedFindingCoverage): boolean {
	return findingCoverageContainsAny([node.id, node.label, node.path ?? "", ...node.tags], coverage);
}

function collectTrackedRecommendationKeys(logicMap: LogicMapData, surfaceMap: SurfaceMapData): Set<string> {
	const tracked = new Set<string>();
	for (const surface of Object.values(surfaceMap.surfaces)) {
		tracked.add(surface.id.toLowerCase());
		tracked.add(surface.label.toLowerCase());
		for (const adjacentId of surface.adjacent) {
			tracked.add(adjacentId.toLowerCase());
		}
	}

	for (const rule of Object.values(logicMap.rules)) {
		tracked.add(rule.id.toLowerCase());
		for (const surfaceId of rule.surfaces) {
			tracked.add(surfaceId.toLowerCase());
		}
	}

	return tracked;
}

function workspaceExplorationPriority(node: WorkspaceGraphNode): number {
	let priority = node.score * 10;
	if (node.status === "hot") {
		priority += 6;
	}
	if (node.id.startsWith("module:")) {
		priority += 5;
	}

	switch (node.kind) {
		case "auth_flow":
		case "endpoint":
		case "entrypoint":
			return priority + 6;
		case "boundary":
		case "parser":
		case "crypto":
			return priority + 4;
		default:
			return priority + 2;
	}
}

function buildFreshExplorationAction(node: WorkspaceGraphNode): string {
	const subject = `${node.label} (${node.id})`;
	const reason = node.summary?.trim() ? compactActionText(node.summary) : undefined;

	if (node.id.startsWith("module:")) {
		return ensureSentence(
			reason
				? `Open a fresh branch on ${subject}. Start from ${reason}`
				: `Open a fresh branch on ${subject}. Map its ingress, trust boundaries, and auth assumptions before revisiting lowered paths`,
		);
	}

	return ensureSentence(
		reason
			? `Explore ${subject} as a fresh branch. Start from ${reason}`
			: `Explore ${subject} as a fresh branch and decide whether it exposes a stronger ingress or trust-boundary mistake than the already-lowered paths`,
	);
}

function buildFreshExplorationActions(
	logicMap: LogicMapData,
	surfaceMap: SurfaceMapData,
	workspaceGraph: WorkspaceGraphData,
	coverage: ConfirmedFindingCoverage,
	maxActions: number,
): string[] {
	if (maxActions <= 0) {
		return [];
	}

	const trackedKeys = collectTrackedRecommendationKeys(logicMap, surfaceMap);
	const candidates = Object.values(workspaceGraph.nodes)
		.filter((node) => node.source === "workspace_seed" && node.kind !== "finding")
		.filter((node) => node.status === "candidate" || node.status === "hot" || node.status === "active")
		.filter((node) => node.score >= 3)
		.filter(
			(node) =>
				!isIgnoredRecommendationNode(node) &&
				!isStaleRecommendationNode(node) &&
				!isCoveredRecommendationNode(node, coverage),
		)
		.filter((node) => {
			const keys = [node.id, node.label, node.path ?? ""].map((value) => value.toLowerCase()).filter(Boolean);
			if (keys.some((key) => trackedKeys.has(key))) {
				return false;
			}

			if (node.path) {
				const moduleKey = `module:${dirname(node.path).toLowerCase()}`;
				if (trackedKeys.has(moduleKey)) {
					return false;
				}
			}

			return true;
		})
		.sort((left, right) => {
			const priorityDelta = workspaceExplorationPriority(right) - workspaceExplorationPriority(left);
			if (priorityDelta !== 0) {
				return priorityDelta;
			}
			return compareUpdatedAtDesc(left, right);
		});

	return candidates.slice(0, maxActions).map((node) => buildFreshExplorationAction(node));
}

function buildSurfaceAction(surface: SurfaceRecord): string {
	const subject = `${surface.label} (${surface.id})`;
	const reason = getSurfaceReason(surface);

	switch (surface.status) {
		case "active":
		case "hot":
			return ensureSentence(
				reason
					? `Drive ${subject} next. Validate ${reason}`
					: `Drive ${subject} next. Reproduce the path and decide whether it is ready for exploitation work`,
			);
		case "blocked":
			return ensureSentence(
				reason ? `Unblock ${subject}. Resolve ${reason}` : `Unblock ${subject} before broadening the search`,
			);
		case "candidate":
			return ensureSentence(
				reason
					? `Triage ${subject}. Start from ${reason}`
					: `Triage ${subject} and either promote it, claim it, or reject it quickly`,
			);
		case "covered":
		case "confirmed":
			return ensureSentence(`Use ${subject} as a control while you verify adjacent paths`);
		case "rejected":
			return ensureSentence(`Leave ${subject} deprioritized unless new evidence reopens it`);
	}
}

function buildLogicAction(rule: LogicRecord): string {
	const subject = `${rule.label} (${rule.id})`;
	const surfaceScope =
		rule.surfaces.length > 0 ? ` on ${formatList(rule.surfaces.slice(0, 3).map((surface) => `"${surface}"`))}` : "";
	const gap = rule.gap.trim() || `${rule.intended.trim()} vs ${rule.implemented.trim()}`;
	return ensureSentence(
		`Re-test ${subject}${surfaceScope}. Turn this recorded gap into a concrete trigger hypothesis: ${compactActionText(gap)}`,
	);
}

function getSavedPlanStep(notebook: NotebookData): string | undefined {
	const savedPlan = notebook._plan;
	if (!savedPlan) {
		return undefined;
	}

	for (const line of savedPlan.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("- ")) {
			return compactActionText(trimmed.slice(2), 120);
		}
	}

	return undefined;
}

export function buildRecommendedActions(
	notebook: NotebookData,
	logicMap: LogicMapData,
	surfaceMap: SurfaceMapData,
	workspaceGraph: WorkspaceGraphData,
	maxActions = 4,
): string | undefined {
	const confirmedFindingCoverage = collectConfirmedFindingCoverage(workspaceGraph);
	const notebookKeys = Object.keys(notebook).filter((key) => notebook[key]?.trim().length > 0);
	const savedPlanStep = getSavedPlanStep(notebook);
	const noteKeys = notebookKeys.filter((key) => key !== "_plan");
	const rankedSurfaces = Object.values(surfaceMap.surfaces)
		.filter(
			(surface) =>
				surfaceRecommendationPriority(surface) > 0 &&
				!isIgnoredRecommendationSurface(surface) &&
				!isStaleRecommendationSurface(surface) &&
				!isCoveredRecommendationSurface(surface, confirmedFindingCoverage),
		)
		.sort((left, right) => {
			const priorityDelta = surfaceRecommendationPriority(right) - surfaceRecommendationPriority(left);
			if (priorityDelta !== 0) {
				return priorityDelta;
			}
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			return compareUpdatedAtDesc(left, right);
		});
	const rankedRules = Object.values(logicMap.rules)
		.filter(
			(rule) =>
				logicRecommendationPriority(rule) > 1 &&
				!isIgnoredRecommendationRule(rule) &&
				!isStaleRecommendationRule(rule) &&
				!isCoveredRecommendationRule(rule, confirmedFindingCoverage),
		)
		.sort((left, right) => {
			const priorityDelta = logicRecommendationPriority(right) - logicRecommendationPriority(left);
			if (priorityDelta !== 0) {
				return priorityDelta;
			}
			return compareUpdatedAtDesc(left, right);
		});

	const actions: string[] = [];
	for (const surface of rankedSurfaces.slice(0, 2)) {
		if (actions.length >= maxActions) {
			break;
		}
		actions.push(buildSurfaceAction(surface));
	}
	for (const rule of rankedRules.slice(0, 2)) {
		if (actions.length >= maxActions) {
			break;
		}
		actions.push(buildLogicAction(rule));
	}
	for (const action of buildFreshExplorationActions(
		logicMap,
		surfaceMap,
		workspaceGraph,
		confirmedFindingCoverage,
		maxActions - actions.length,
	)) {
		if (actions.length >= maxActions) {
			break;
		}
		actions.push(action);
	}
	if (savedPlanStep && actions.length < maxActions) {
		actions.push(ensureSentence(`Resume the saved plan with ${savedPlanStep}`));
	}
	if (noteKeys.length > 0 && actions.length < maxActions) {
		actions.push(
			ensureSentence(
				`Refresh notebook context from ${formatList(noteKeys.slice(0, 3).map((key) => `"${key}"`))} before the next mutation`,
			),
		);
	}
	if (actions.length === 0) {
		return undefined;
	}

	return actions.map((action, index) => `${formatOptionLabel(index)}. ${action}`).join("\n");
}

export interface SecurityAgentRuntimeOptions {
	cwd: string;
	workspaceRoot?: string;
	stateDir?: string;
	sessionDir?: string;
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
	private sessionManager: SessionManager;
	private readonly proofRepairAttempts: number;
	private lastEstimatedContextTokens: number | undefined;
	private workspacePrepared = false;
	private persistedCompactionSummary?: PersistedCompactionSummary;

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
		this.sessionManager = SessionManager.create(this.cwd, options.sessionDir);

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

		this.agent.subscribe(async (event) => {
			this.persistSessionEvent(event);
			if (event.type === "turn_end") {
				await this.reconcilePlanFromTurn(event);
				this.refreshContextEstimate();
			}
		});

		const existingSession = this.sessionManager.buildSessionContext();
		if (existingSession.messages.length > 0) {
			this.applySessionContext(existingSession);
			if (!this.sessionManager.hasEntryType("thinking_level_change")) {
				this.sessionManager.appendThinkingLevelChange(this.agent.state.thinkingLevel);
			}
			if (!this.sessionManager.hasEntryType("model_change")) {
				this.sessionManager.appendModelChange(this.agent.state.model.provider, this.agent.state.model.id);
			}
		} else {
			this.persistCurrentSessionSettings();
		}

		this.refreshContextEstimate();
	}

	private buildResearchContextWindow(messages: AgentMessage[]) {
		const recommendedActionsText = this.getStartupRecommendedActions();
		const persistedCompactionSummary = this.persistedCompactionSummary ?? this.sessionManager.getLatestCompaction();
		return assembleResearchContextWindow({
			cwd: this.cwd,
			contextFiles: this.contextFiles,
			recommendedActionsText,
			persistedCompactionSummary: persistedCompactionSummary
				? `Compacted from ${persistedCompactionSummary.tokensBefore.toLocaleString()} estimated tokens earlier in this branch.\n${persistedCompactionSummary.summary}`
				: undefined,
			notebook: this.notebook.read(),
			surfaceMap: this.surfaceMap.read(),
			logicMap: this.logicMap.read(),
			workspaceGraph: this.workspaceGraph.read(),
			plan: this.planState.current,
			messages,
			model: this.agent.state.model,
			thinkingLevel: this.agent.state.thinkingLevel,
		});
	}

	private refreshContextEstimate(messages: AgentMessage[] = this.agent.state.messages): void {
		this.lastEstimatedContextTokens = this.buildResearchContextWindow(messages).estimatedTokens;
	}

	private async injectContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
		await this.ensureWorkspacePrepared(messages);
		const assembledContext = this.buildResearchContextWindow(messages);
		this.lastEstimatedContextTokens = assembledContext.estimatedTokens;

		if (
			assembledContext.usedCompaction &&
			assembledContext.compactedTranscriptText &&
			assembledContext.firstKeptReplayMessageIndex !== undefined
		) {
			this.persistCompactionCheckpoint(
				assembledContext.compactedTranscriptText,
				assembledContext.firstKeptReplayMessageIndex,
				assembledContext.estimatedTokens,
			);
		}
		return assembledContext.messages;
	}

	private persistCompactionCheckpoint(
		compactedTranscriptText: string,
		firstKeptReplayMessageIndex: number,
		tokensBefore: number,
	): void {
		const sessionContext = this.sessionManager.buildSessionContext();
		const firstKeptEntryId = sessionContext.messageEntryIds[firstKeptReplayMessageIndex];
		if (!firstKeptEntryId) {
			return;
		}

		const latestCompaction = this.sessionManager.getLatestCompaction();
		if (
			latestCompaction &&
			latestCompaction.firstKeptEntryId === firstKeptEntryId &&
			latestCompaction.summary === compactedTranscriptText
		) {
			this.persistedCompactionSummary = latestCompaction;
			return;
		}

		this.sessionManager.appendCompaction(compactedTranscriptText, firstKeptEntryId, tokensBefore);
		const updatedSessionContext = this.sessionManager.buildSessionContext();
		this.agent.state.messages = updatedSessionContext.messages;
		this.persistedCompactionSummary = updatedSessionContext.compaction;
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

	get estimatedContextTokens(): number | undefined {
		return this.lastEstimatedContextTokens;
	}

	get state() {
		return this.agent.state;
	}

	get sessionId(): string {
		return this.sessionManager.getSessionId();
	}

	get sessionFile(): string | undefined {
		return this.sessionManager.getSessionFile();
	}

	get conversationMessages(): readonly AgentMessage[] {
		return this.agent.state.messages;
	}

	get sessionInfo(): SessionInfo | undefined {
		const sessionFile = this.sessionFile;
		return sessionFile ? readSessionInfo(sessionFile) : undefined;
	}

	getStartupRecommendedActions(maxActions = 4): string | undefined {
		return buildRecommendedActions(
			this.notebook.read(),
			this.logicMap.read(),
			this.surfaceMap.read(),
			this.workspaceGraph.read(),
			maxActions,
		);
	}

	async exportResearchGraphHtml(): Promise<ResearchGraphHtmlResult> {
		return writeResearchGraphHtml({
			workspaceRoot: this.workspaceRoot,
			workspaceGraph: this.workspaceGraph.read(),
			surfaceMap: this.surfaceMap.read(),
			logicMap: this.logicMap.read(),
			notebook: this.notebook.read(),
		});
	}

	setModel(model: Model<Api>): ThinkingLevel {
		const previousModel = this.agent.state.model;
		const modelChanged = previousModel.provider !== model.provider || previousModel.id !== model.id;
		let persistedSettingsChanged = false;
		this.agent.state.model = model;
		if (modelChanged) {
			this.sessionManager.appendModelChange(model.provider, model.id);
			persistedSettingsChanged = true;
		}
		const clampedThinkingLevel = clampThinkingLevel(model, this.agent.state.thinkingLevel);
		if (clampedThinkingLevel !== this.agent.state.thinkingLevel) {
			this.sessionManager.appendThinkingLevelChange(clampedThinkingLevel);
			persistedSettingsChanged = true;
		}
		this.agent.state.thinkingLevel = clampedThinkingLevel;
		if (persistedSettingsChanged) {
			this.sessionManager.flush();
		}
		this.refreshContextEstimate();
		return clampedThinkingLevel;
	}

	setThinkingLevel(thinkingLevel: ThinkingLevel): ThinkingLevel {
		const clampedThinkingLevel = clampThinkingLevel(this.agent.state.model, thinkingLevel);
		if (clampedThinkingLevel !== this.agent.state.thinkingLevel) {
			this.sessionManager.appendThinkingLevelChange(clampedThinkingLevel);
			this.sessionManager.flush();
		}
		this.agent.state.thinkingLevel = clampedThinkingLevel;
		this.refreshContextEstimate();
		return clampedThinkingLevel;
	}

	reset(): void {
		this.agent.reset();
		this.persistedCompactionSummary = undefined;
		this.planState.current = undefined;
		if (this.validationState) {
			this.validationState.attempts = 0;
			this.validationState.lastResult = undefined;
			this.validationState.history = [];
		}
		this.refreshContextEstimate();
	}

	startNewConversation(): string | undefined {
		const parentSession = this.sessionManager.getSessionFile();
		this.sessionManager.newSession({ parentSession });
		this.reset();
		this.persistCurrentSessionSettings();
		return this.sessionManager.getSessionFile();
	}

	listStoredConversations(): SessionInfo[] {
		return listSessions(this.cwd, this.sessionManager.getSessionDir());
	}

	resolveStoredConversation(sessionArg: string): SessionInfo | undefined {
		const trimmed = sessionArg.trim();
		if (trimmed.length === 0) {
			return undefined;
		}

		if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.endsWith(".jsonl")) {
			const resolvedPath = resolve(trimmed);
			return readSessionInfo(resolvedPath);
		}

		return this.listStoredConversations().find((session) => session.id.startsWith(trimmed));
	}

	resumeStoredConversation(sessionPath: string): SessionInfo {
		const nextSessionManager = SessionManager.open(sessionPath, this.sessionManager.getSessionDir());
		if (nextSessionManager.getCwd() !== this.cwd) {
			throw new Error(
				`Session cwd ${nextSessionManager.getCwd()} does not match the current workspace cwd ${this.cwd}.`,
			);
		}

		this.sessionManager = nextSessionManager;
		this.applySessionContext(this.sessionManager.buildSessionContext());
		if (!this.sessionManager.hasEntryType("thinking_level_change")) {
			this.sessionManager.appendThinkingLevelChange(this.agent.state.thinkingLevel);
		}
		if (!this.sessionManager.hasEntryType("model_change")) {
			this.sessionManager.appendModelChange(this.agent.state.model.provider, this.agent.state.model.id);
		}

		const sessionInfo = readSessionInfo(sessionPath);
		if (!sessionInfo) {
			throw new Error(`Failed to read session metadata from ${sessionPath}.`);
		}
		return sessionInfo;
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

	private persistCurrentSessionSettings(): void {
		this.sessionManager.appendModelChange(this.agent.state.model.provider, this.agent.state.model.id);
		this.sessionManager.appendThinkingLevelChange(this.agent.state.thinkingLevel);
	}

	private applySessionContext(sessionContext: SessionContext): void {
		this.reset();
		if (sessionContext.model) {
			try {
				this.agent.state.model = resolveModel(sessionContext.model);
			} catch {
				// Keep the active model when a stored model is no longer available.
			}
		}
		this.agent.state.thinkingLevel = clampThinkingLevel(this.agent.state.model, sessionContext.thinkingLevel);
		this.agent.state.messages = sessionContext.messages;
		this.persistedCompactionSummary = sessionContext.compaction;
		this.refreshContextEstimate();
	}

	private persistSessionEvent(event: AgentEvent): void {
		if (event.type !== "message_end") {
			return;
		}

		if (event.message.role === "user" || event.message.role === "assistant" || event.message.role === "toolResult") {
			this.sessionManager.appendMessage(event.message);
		}
	}

	private async reconcilePlanFromTurn(event: Extract<AgentEvent, { type: "turn_end" }>): Promise<void> {
		if (!this.planState.current) {
			return;
		}

		const messageText = extractMessageText(event.message).trim();
		if (messageText.length === 0) {
			return;
		}

		const evidenceText = [messageText, ...event.toolResults.map((result) => extractMessageText(result))]
			.map((text) => text.trim())
			.filter((text) => text.length > 0)
			.join("\n\n");
		if (evidenceText.length === 0) {
			return;
		}

		const reconciled = reconcileResearchPlan(this.planState.current, evidenceText);
		if (!reconciled.changed) {
			return;
		}

		this.planState.current = reconciled.plan;
		if (!reconciled.plan || reconciled.cleared) {
			await this.notebook.delete("_plan");
			return;
		}

		await this.notebook.set("_plan", formatPlan(reconciled.plan));
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
