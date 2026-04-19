import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Api, AssistantMessage, Model, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
import type { WorkspaceContextFile } from "./context.js";
import type { LogicMapData, LogicRecord } from "./logic-map/store.js";
import type { NotebookData } from "./notebook/store.js";
import type { SurfaceMapData, SurfaceRecord } from "./surface-map/store.js";
import type { ResearchPlan } from "./tools/plan.js";
import type { WorkspaceGraphData, WorkspaceGraphNode } from "./workspace-graph/store.js";

const DEFAULT_CONTEXT_WINDOW = 272_000;
const OPENAI_SOFT_CONTEXT_ALLOWANCE = 100_000;
const OPENAI_SOFT_CONTEXT_CAP = 1_000_000;
const MIN_WORKING_BUDGET = 16_000;
const MIN_DURABLE_BUDGET = 1_500;
const MIN_TRANSCRIPT_BUDGET = 1_500;
const MIN_SUMMARY_BUDGET = 1_000;
const SUMMARY_MARKER = "[Compacted Transcript]";
const OPENAI_SOFT_CONTEXT_PROVIDERS = new Set<Api>([
	"openai",
	"openai-codex",
	"openai-responses",
	"azure-openai-responses",
]);
const STOP_WORDS = new Set([
	"the",
	"and",
	"for",
	"with",
	"from",
	"that",
	"this",
	"into",
	"over",
	"then",
	"than",
	"only",
	"path",
	"file",
	"code",
	"data",
	"text",
	"task",
	"user",
	"work",
	"root",
	"line",
	"lines",
	"using",
	"used",
	"use",
	"when",
	"where",
	"what",
	"which",
	"have",
	"has",
	"had",
	"was",
	"were",
	"are",
	"but",
	"not",
	"too",
	"via",
	"per",
	"its",
	"their",
	"will",
	"should",
	"would",
	"could",
]);

interface ConversationGroup {
	kind: "user" | "assistant_cycle";
	precedingUserGroupIndex: number | null;
	rawMessages: AgentMessage[];
	replayMessages: AgentMessage[];
	rawTokens: number;
	replayTokens: number;
}

interface RawTailSelection {
	keptGroups: ConversationGroup[];
	omittedGroups: ConversationGroup[];
	messages: AgentMessage[];
	tokens: number;
	firstKeptMessageIndex: number | undefined;
}

interface SectionDefinition {
	budget: number;
	text: string | undefined;
}

export interface AssembleResearchContextOptions {
	cwd: string;
	contextFiles: WorkspaceContextFile[];
	recommendedActionsText?: string;
	persistedCompactionSummary?: string;
	notebook: NotebookData;
	surfaceMap: SurfaceMapData;
	logicMap: LogicMapData;
	workspaceGraph: WorkspaceGraphData;
	plan?: ResearchPlan;
	messages: AgentMessage[];
	model: Model<Api>;
	thinkingLevel: ThinkingLevel;
}

export interface AssembleResearchContextResult {
	messages: AgentMessage[];
	estimatedTokens: number;
	projectedNextTurnTokens: number;
	usedCompaction: boolean;
	omittedGroupCount: number;
	compactedTranscriptText?: string;
	firstKeptReplayMessageIndex?: number;
}

function isUserMessage(message: AgentMessage): message is UserMessage {
	return message.role === "user";
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return message.role === "assistant";
}

function isToolResultMessage(message: AgentMessage): message is ToolResultMessage {
	return message.role === "toolResult";
}

function compactSnippet(text: string, maxChars = 160): string {
	const compact = text.replace(/\s+/g, " ").trim();
	if (compact.length <= maxChars) {
		return compact;
	}
	return `${compact.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function tokenize(text: string): string[] {
	const matches = text.toLowerCase().match(/[a-z0-9_:/.-]{2,}/g) ?? [];
	const seen = new Set<string>();
	const tokens: string[] = [];
	for (const match of matches) {
		if (STOP_WORDS.has(match) || seen.has(match)) {
			continue;
		}
		seen.add(match);
		tokens.push(match);
	}
	return tokens;
}

function textOverlapScore(text: string, terms: readonly string[]): number {
	if (text.trim().length === 0 || terms.length === 0) {
		return 0;
	}

	const haystack = text.toLowerCase();
	let score = 0;
	for (const term of terms) {
		if (haystack.includes(term)) {
			score++;
		}
	}
	return score;
}

function extractTextContent(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") {
		return content;
	}

	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

function extractMessageText(message: AgentMessage): string {
	if (isUserMessage(message) || isToolResultMessage(message)) {
		return extractTextContent(message.content);
	}

	if (isAssistantMessage(message)) {
		return message.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n");
	}

	return "";
}

function summarizeAssistantToolCalls(message: AssistantMessage): string {
	const toolNames = message.content
		.filter(
			(part): part is Extract<AssistantMessage["content"][number], { type: "toolCall" }> => part.type === "toolCall",
		)
		.map((part) => part.name);
	if (toolNames.length === 0) {
		return "";
	}
	return `called ${toolNames.join(", ")}`;
}

function sanitizeAssistantMessage(message: AssistantMessage): AssistantMessage {
	const content = message.content.filter((part) => part.type !== "thinking");
	if (content.length === message.content.length) {
		return message;
	}
	return {
		...message,
		content,
	};
}

function estimateMessageTokens(message: AgentMessage, includeThinking = true): number {
	if (isUserMessage(message) || isToolResultMessage(message)) {
		return Math.ceil(extractMessageText(message).length / 4);
	}

	if (isAssistantMessage(message)) {
		let chars = 0;
		for (const part of message.content) {
			if (part.type === "text") {
				chars += part.text.length;
				continue;
			}
			if (part.type === "thinking") {
				if (includeThinking) {
					chars += part.thinking.length;
				}
				continue;
			}
			if (part.type === "toolCall") {
				chars += part.name.length + JSON.stringify(part.arguments).length;
			}
		}
		return Math.ceil(chars / 4);
	}

	return 0;
}

function estimateTextTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function truncateTextToBudget(text: string, budgetTokens: number): string | undefined {
	if (budgetTokens <= 0) {
		return undefined;
	}

	const maxChars = Math.max(0, budgetTokens * 4);
	if (maxChars === 0) {
		return undefined;
	}

	if (text.length <= maxChars) {
		return text;
	}

	const suffix = "\n... truncated";
	if (maxChars <= suffix.length + 8) {
		return undefined;
	}

	return `${text.slice(0, maxChars - suffix.length).trimEnd()}${suffix}`;
}

function appendSection(sections: string[], remainingBudget: { value: number }, section: SectionDefinition): void {
	if (!section.text || section.text.trim().length === 0 || remainingBudget.value <= 0) {
		return;
	}

	const fitted = truncateTextToBudget(section.text, Math.min(section.budget, remainingBudget.value));
	if (!fitted) {
		return;
	}

	sections.push(fitted);
	remainingBudget.value = Math.max(0, remainingBudget.value - estimateTextTokens(fitted));
}

function extractLatestUserText(messages: AgentMessage[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (isUserMessage(message)) {
			return compactSnippet(extractMessageText(message), 240);
		}
	}
	return "";
}

function buildPlanText(plan: ResearchPlan | undefined): string {
	if (!plan) {
		return "";
	}

	const openPhases = plan.phases.filter(
		(phase) => phase.status !== "completed" || phase.steps.some((step) => step.status !== "completed"),
	);
	if (openPhases.length === 0) {
		return "";
	}

	const lines = ["[Active Plan]"];
	for (const phase of openPhases.slice(0, 3)) {
		const suffix = phase.parallelSteps ? " [parallel]" : "";
		lines.push(`- ${phase.name} [${phase.status}]${suffix}`);
		for (const step of phase.steps.filter((item) => item.status !== "completed").slice(0, 4)) {
			lines.push(`  - ${step.text} [${step.status}]`);
		}
	}

	return lines.join("\n");
}

function surfaceStatusPriority(status: SurfaceRecord["status"]): number {
	switch (status) {
		case "active":
			return 10;
		case "hot":
			return 8;
		case "blocked":
			return 7;
		case "candidate":
			return 5;
		case "covered":
		case "confirmed":
			return 3;
		case "rejected":
			return 0;
	}
}

function logicStatusPriority(status: LogicRecord["status"]): number {
	switch (status) {
		case "violated":
			return 9;
		case "candidate":
			return 7;
		case "aligned":
			return 5;
		case "confirmed":
			return 3;
		case "rejected":
			return 0;
	}
}

function graphStatusPriority(status: string): number {
	switch (status) {
		case "active":
			return 8;
		case "hot":
			return 7;
		case "candidate":
			return 5;
		case "confirmed":
			return 4;
		case "blocked":
			return 3;
		default:
			return 1;
	}
}

function selectRelevantSurfaces(
	surfaceMap: SurfaceMapData,
	relevanceTerms: readonly string[],
	limit = 6,
): SurfaceRecord[] {
	return Object.values(surfaceMap.surfaces)
		.map((surface) => ({
			surface,
			score:
				surfaceStatusPriority(surface.status) * 10 +
				surface.score * 4 +
				(surface.owner ? 18 : 0) +
				textOverlapScore(
					[surface.id, surface.label, surface.why ?? "", ...surface.evidence, ...surface.adjacent].join("\n"),
					relevanceTerms,
				) *
					6,
		}))
		.filter((entry) => entry.score > 0)
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			return right.surface.updatedAt.localeCompare(left.surface.updatedAt);
		})
		.slice(0, limit)
		.map((entry) => entry.surface);
}

function selectRelevantRules(
	logicMap: LogicMapData,
	relevanceTerms: readonly string[],
	selectedSurfaces: readonly SurfaceRecord[],
	limit = 5,
): LogicRecord[] {
	const selectedSurfaceIds = new Set(selectedSurfaces.map((surface) => surface.id));

	return Object.values(logicMap.rules)
		.map((rule) => ({
			rule,
			score:
				logicStatusPriority(rule.status) * 10 +
				rule.surfaces.filter((surfaceId) => selectedSurfaceIds.has(surfaceId)).length * 12 +
				textOverlapScore(
					[
						rule.id,
						rule.label,
						rule.intended,
						rule.implemented,
						rule.gap,
						...rule.surfaces,
						...rule.evidence,
					].join("\n"),
					relevanceTerms,
				) *
					6,
		}))
		.filter((entry) => entry.score > 0)
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			return right.rule.updatedAt.localeCompare(left.rule.updatedAt);
		})
		.slice(0, limit)
		.map((entry) => entry.rule);
}

function notebookKeyPriority(key: string): number {
	switch (key) {
		case "proof_notes":
			return 9;
		case "findings":
		case "hypotheses":
			return 8;
		case "repro_steps":
		case "next_steps":
			return 7;
		default:
			return key.startsWith("_") ? 1 : 4;
	}
}

function selectNotebookEntries(
	notebook: NotebookData,
	relevanceTerms: readonly string[],
	selectedSurfaces: readonly SurfaceRecord[],
	limit = 4,
): Array<[string, string]> {
	const selectedSurfaceTerms = selectedSurfaces.flatMap((surface) => tokenize(`${surface.id} ${surface.label}`));

	return Object.entries(notebook)
		.filter(([key, value]) => key !== "_plan" && value.trim().length > 0)
		.map(([key, value]) => ({
			key,
			value,
			score:
				notebookKeyPriority(key) * 10 +
				textOverlapScore(`${key}\n${value}`, relevanceTerms) * 8 +
				textOverlapScore(value, selectedSurfaceTerms) * 5,
		}))
		.filter((entry) => entry.score > 0)
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			return left.key.localeCompare(right.key);
		})
		.slice(0, limit)
		.map((entry) => [entry.key, entry.value]);
}

function collectGraphNeighborIds(
	workspaceGraph: WorkspaceGraphData,
	nodeIds: ReadonlySet<string>,
	limit = 4,
): string[] {
	const neighbors: string[] = [];
	for (const edge of workspaceGraph.edges) {
		const fromTracked = nodeIds.has(edge.from);
		const toTracked = nodeIds.has(edge.to);
		if (fromTracked === toTracked) {
			continue;
		}

		const neighborId = fromTracked ? edge.to : edge.from;
		if (nodeIds.has(neighborId) || neighbors.includes(neighborId)) {
			continue;
		}

		neighbors.push(neighborId);
		if (neighbors.length >= limit) {
			break;
		}
	}
	return neighbors;
}

function lookupNode(workspaceGraph: WorkspaceGraphData, nodeId: string): WorkspaceGraphNode | undefined {
	return workspaceGraph.nodes[nodeId];
}

function selectRelevantGraphNodes(
	workspaceGraph: WorkspaceGraphData,
	relevanceTerms: readonly string[],
	selectedSurfaces: readonly SurfaceRecord[],
	selectedRules: readonly LogicRecord[],
	limit = 6,
): WorkspaceGraphNode[] {
	const directIds = new Set<string>();
	for (const surface of selectedSurfaces) {
		directIds.add(surface.id);
	}
	for (const rule of selectedRules) {
		for (const surfaceId of rule.surfaces) {
			directIds.add(surfaceId);
		}
	}

	const query = [relevanceTerms.join(" "), ...[...directIds]].filter((part) => part.trim().length > 0).join("\n");
	const searchResult =
		query.trim().length > 0
			? new WorkspaceGraphQuery(workspaceGraph).search(query, 5, 5)
			: { exact: [], related: [] };
	const candidateIds = new Set<string>([
		...searchResult.exact.map((hit) => hit.node.id),
		...searchResult.related.map((hit) => hit.node.id),
		...[...directIds].filter((id) => Boolean(lookupNode(workspaceGraph, id))),
	]);

	for (const neighborId of collectGraphNeighborIds(workspaceGraph, candidateIds)) {
		candidateIds.add(neighborId);
	}

	return [...candidateIds]
		.map((id) => lookupNode(workspaceGraph, id))
		.filter((node): node is WorkspaceGraphNode => node !== undefined)
		.sort((left, right) => {
			const leftScore =
				graphStatusPriority(left.status) * 10 +
				left.score * 5 +
				textOverlapScore(
					[left.id, left.label, left.summary ?? "", left.text, ...left.tags].join("\n"),
					relevanceTerms,
				) *
					6;
			const rightScore =
				graphStatusPriority(right.status) * 10 +
				right.score * 5 +
				textOverlapScore(
					[right.id, right.label, right.summary ?? "", right.text, ...right.tags].join("\n"),
					relevanceTerms,
				) *
					6;
			if (rightScore !== leftScore) {
				return rightScore - leftScore;
			}
			return right.updatedAt.localeCompare(left.updatedAt);
		})
		.slice(0, limit);
}

function formatContextFiles(contextFiles: readonly WorkspaceContextFile[]): string | undefined {
	if (contextFiles.length === 0) {
		return undefined;
	}

	const lines = ["[Workspace Instructions]"];
	for (const file of contextFiles) {
		lines.push(`## ${file.path}`);
		lines.push(file.content.trim());
	}
	return lines.join("\n\n");
}

function shouldIncludeRecommendedActions(
	messages: readonly AgentMessage[],
	recommendedActionsText: string | undefined,
): boolean {
	if (!recommendedActionsText?.trim()) {
		return false;
	}

	let assistantCount = 0;
	let latestUserText = "";
	for (const message of messages) {
		if (isAssistantMessage(message)) {
			assistantCount++;
		}
		if (isUserMessage(message)) {
			latestUserText = extractMessageText(message);
		}
	}

	return assistantCount === 0 || /\boption\s+(?:[a-z]+|\d+)\b/i.test(latestUserText);
}

function formatRecommendedActions(recommendedActionsText: string | undefined): string | undefined {
	if (!recommendedActionsText?.trim()) {
		return undefined;
	}

	return [
		"[Recommended Actions]",
		"Use these labels if the user refers to a startup recommendation by letter or number. Numeric aliases follow list order: 1=A, 2=B, 3=C, and so on.",
		"",
		recommendedActionsText.trim(),
	].join("\n");
}

function formatPersistedCompactionSummary(summary: string | undefined): string | undefined {
	if (!summary?.trim()) {
		return undefined;
	}

	return ["[Persisted Compaction Checkpoint]", summary.trim()].join("\n");
}

function formatSurfaces(surfaces: readonly SurfaceRecord[]): string | undefined {
	if (surfaces.length === 0) {
		return undefined;
	}

	const lines = ["[Surface Map]"];
	for (const surface of surfaces) {
		lines.push(`- ${surface.id} [${surface.kind}] score=${surface.score} status=${surface.status}`);
		lines.push(`  label: ${compactSnippet(surface.label, 140)}`);
		if (surface.owner) {
			lines.push(`  owner: ${surface.owner}`);
		}
		if (surface.why?.trim()) {
			lines.push(`  why: ${compactSnippet(surface.why, 180)}`);
		}
		if (surface.evidence.length > 0) {
			lines.push(`  evidence: ${compactSnippet(surface.evidence.join(" | "), 180)}`);
		}
		if (surface.adjacent.length > 0) {
			lines.push(`  adjacent: ${compactSnippet(surface.adjacent.join(", "), 160)}`);
		}
	}
	return lines.join("\n");
}

function formatLogicRules(rules: readonly LogicRecord[]): string | undefined {
	if (rules.length === 0) {
		return undefined;
	}

	const lines = ["[Logic Map]"];
	for (const rule of rules) {
		lines.push(`- ${rule.id} status=${rule.status} label=${compactSnippet(rule.label, 140)}`);
		lines.push(`  gap: ${compactSnippet(rule.gap, 180)}`);
		if (rule.surfaces.length > 0) {
			lines.push(`  surfaces: ${compactSnippet(rule.surfaces.join(", "), 160)}`);
		}
		if (rule.evidence.length > 0) {
			lines.push(`  evidence: ${compactSnippet(rule.evidence.join(" | "), 180)}`);
		}
	}
	return lines.join("\n");
}

function formatNotebookEntries(entries: ReadonlyArray<[string, string]>): string | undefined {
	if (entries.length === 0) {
		return undefined;
	}

	const lines = ["[Research Notebook]"];
	for (const [key, value] of entries) {
		lines.push(`- ${key}: ${compactSnippet(value, 220)}`);
	}
	return lines.join("\n");
}

function formatGraphNodes(nodes: readonly WorkspaceGraphNode[]): string | undefined {
	if (nodes.length === 0) {
		return undefined;
	}

	const lines = ["[Workspace Graph]"];
	for (const node of nodes) {
		lines.push(`- ${node.id} [${node.kind}] score=${node.score} status=${node.status}`);
		lines.push(`  label: ${compactSnippet(node.label, 150)}`);
		if (node.summary?.trim()) {
			lines.push(`  summary: ${compactSnippet(node.summary, 190)}`);
		}
		if (node.tags.length > 0) {
			lines.push(`  tags: ${compactSnippet(node.tags.join(", "), 160)}`);
		}
	}
	return lines.join("\n");
}

function formatDurableContextHeader(cwd: string, latestUserText: string): string {
	const lines = [
		"[Workspace Context]",
		`Current working directory: ${cwd}`,
		"Treat notebook, surface-map, logic-map, and workspace-graph entries below as canonical durable research memory. Older transcript can be compacted before the raw tail.",
	];
	if (latestUserText.trim().length > 0) {
		lines.push(`Current objective: ${latestUserText}`);
	}
	return lines.join("\n");
}

function buildDurableContextText(options: AssembleResearchContextOptions, budgetTokens: number): string {
	const latestUserText = extractLatestUserText(options.messages);
	const planText = buildPlanText(options.plan);
	const seedTerms = tokenize([latestUserText, planText].filter((part) => part.trim().length > 0).join("\n"));
	const selectedSurfaces = selectRelevantSurfaces(options.surfaceMap, seedTerms);
	const selectedRules = selectRelevantRules(options.logicMap, seedTerms, selectedSurfaces);
	const selectedNotebookEntries = selectNotebookEntries(options.notebook, seedTerms, selectedSurfaces);
	const graphTerms = tokenize(
		[
			latestUserText,
			planText,
			...selectedSurfaces.map((surface) => `${surface.id} ${surface.label}`),
			...selectedRules.map((rule) => `${rule.id} ${rule.label}`),
		].join("\n"),
	);
	const selectedNodes = selectRelevantGraphNodes(options.workspaceGraph, graphTerms, selectedSurfaces, selectedRules);

	const sections: string[] = [formatDurableContextHeader(options.cwd, latestUserText)];
	const remainingBudget = { value: Math.max(0, budgetTokens - estimateTextTokens(sections[0]!)) };

	appendSection(sections, remainingBudget, {
		budget: Math.max(1200, Math.floor(budgetTokens * 0.22)),
		text: formatContextFiles(options.contextFiles),
	});
	appendSection(sections, remainingBudget, {
		budget: Math.max(900, Math.floor(budgetTokens * 0.1)),
		text: shouldIncludeRecommendedActions(options.messages, options.recommendedActionsText)
			? formatRecommendedActions(options.recommendedActionsText)
			: undefined,
	});
	appendSection(sections, remainingBudget, {
		budget: Math.max(1100, Math.floor(budgetTokens * 0.12)),
		text: formatPersistedCompactionSummary(options.persistedCompactionSummary),
	});
	appendSection(sections, remainingBudget, {
		budget: Math.max(900, Math.floor(budgetTokens * 0.1)),
		text: planText || undefined,
	});
	appendSection(sections, remainingBudget, {
		budget: Math.max(1400, Math.floor(budgetTokens * 0.18)),
		text: formatSurfaces(selectedSurfaces),
	});
	appendSection(sections, remainingBudget, {
		budget: Math.max(1000, Math.floor(budgetTokens * 0.12)),
		text: formatLogicRules(selectedRules),
	});
	appendSection(sections, remainingBudget, {
		budget: Math.max(1100, Math.floor(budgetTokens * 0.14)),
		text: formatNotebookEntries(selectedNotebookEntries),
	});
	appendSection(sections, remainingBudget, {
		budget: Math.max(1100, Math.floor(budgetTokens * 0.14)),
		text: formatGraphNodes(selectedNodes),
	});

	return sections.join("\n\n");
}

function buildConversationGroups(messages: readonly AgentMessage[]): ConversationGroup[] {
	const groups: ConversationGroup[] = [];
	let lastUserGroupIndex: number | null = null;
	let activeAssistantGroupIndex: number | null = null;

	for (const message of messages) {
		if (isUserMessage(message)) {
			const replayMessage = message;
			groups.push({
				kind: "user",
				precedingUserGroupIndex: lastUserGroupIndex,
				rawMessages: [message],
				replayMessages: [replayMessage],
				rawTokens: estimateMessageTokens(message),
				replayTokens: estimateMessageTokens(replayMessage),
			});
			lastUserGroupIndex = groups.length - 1;
			activeAssistantGroupIndex = null;
			continue;
		}

		if (isAssistantMessage(message)) {
			const replayMessage = sanitizeAssistantMessage(message);
			groups.push({
				kind: "assistant_cycle",
				precedingUserGroupIndex: lastUserGroupIndex,
				rawMessages: [message],
				replayMessages: [replayMessage],
				rawTokens: estimateMessageTokens(message, true),
				replayTokens: estimateMessageTokens(replayMessage, false),
			});
			activeAssistantGroupIndex = groups.length - 1;
			continue;
		}

		if (!isToolResultMessage(message)) {
			continue;
		}

		if (activeAssistantGroupIndex === null) {
			groups.push({
				kind: "assistant_cycle",
				precedingUserGroupIndex: lastUserGroupIndex,
				rawMessages: [message],
				replayMessages: [message],
				rawTokens: estimateMessageTokens(message),
				replayTokens: estimateMessageTokens(message),
			});
			activeAssistantGroupIndex = groups.length - 1;
			continue;
		}

		const group = groups[activeAssistantGroupIndex];
		if (!group) {
			continue;
		}

		group.rawMessages.push(message);
		group.replayMessages.push(message);
		group.rawTokens += estimateMessageTokens(message);
		group.replayTokens += estimateMessageTokens(message);
	}

	return groups;
}

function selectRawTailGroups(groups: readonly ConversationGroup[], budgetTokens: number): RawTailSelection {
	const keptIndices = new Set<number>();
	let totalTokens = 0;

	for (let index = groups.length - 1; index >= 0; index--) {
		if (keptIndices.has(index)) {
			continue;
		}

		const group = groups[index];
		if (!group) {
			continue;
		}

		const candidateIndices: number[] = [];
		let candidateTokens = 0;

		if (
			group.kind === "assistant_cycle" &&
			group.precedingUserGroupIndex !== null &&
			!keptIndices.has(group.precedingUserGroupIndex)
		) {
			candidateIndices.push(group.precedingUserGroupIndex);
			candidateTokens += groups[group.precedingUserGroupIndex]?.replayTokens ?? 0;
		}

		candidateIndices.push(index);
		candidateTokens += group.replayTokens;

		if (keptIndices.size === 0 || totalTokens + candidateTokens <= budgetTokens) {
			for (const candidateIndex of candidateIndices) {
				if (keptIndices.has(candidateIndex)) {
					continue;
				}
				const candidateGroup = groups[candidateIndex];
				if (!candidateGroup) {
					continue;
				}
				keptIndices.add(candidateIndex);
				totalTokens += candidateGroup.replayTokens;
			}
		}
	}

	if (keptIndices.size === 0 && groups.length > 0) {
		const lastIndex = groups.length - 1;
		const lastGroup = groups[lastIndex]!;
		keptIndices.add(lastIndex);
		totalTokens += lastGroup.replayTokens;

		if (lastGroup.kind === "assistant_cycle" && lastGroup.precedingUserGroupIndex !== null) {
			const userGroup = groups[lastGroup.precedingUserGroupIndex];
			if (userGroup) {
				keptIndices.add(lastGroup.precedingUserGroupIndex);
				totalTokens += userGroup.replayTokens;
			}
		}
	}

	const keptGroups = [...keptIndices].sort((left, right) => left - right).map((index) => groups[index]!);
	const omittedGroups = groups.filter((_, index) => !keptIndices.has(index));
	const firstKeptMessageIndex =
		keptGroups.length > 0
			? groupsToMessageIndex(groups, [...keptIndices].sort((left, right) => left - right)[0]!)
			: undefined;

	return {
		keptGroups,
		omittedGroups,
		messages: keptGroups.flatMap((group) => group.replayMessages),
		tokens: totalTokens,
		firstKeptMessageIndex,
	};
}

function groupsToMessageIndex(groups: readonly ConversationGroup[], groupIndex: number): number | undefined {
	if (groupIndex < 0 || groupIndex >= groups.length) {
		return undefined;
	}

	let messageIndex = 0;
	for (let index = 0; index < groupIndex; index++) {
		messageIndex += groups[index]?.replayMessages.length ?? 0;
	}
	return messageIndex;
}

function summarizeGroupTools(messages: readonly AgentMessage[]): string {
	const toolSummaries = messages
		.filter(isToolResultMessage)
		.slice(-2)
		.map((message) => {
			const text = extractMessageText(message);
			const snippet = text.trim().length > 0 ? compactSnippet(text, 100) : "completed";
			return `${message.toolName}: ${snippet}`;
		});
	return toolSummaries.join(" ; ");
}

function summarizeConversationGroup(group: ConversationGroup): string[] {
	if (group.kind === "user") {
		const userMessage = group.rawMessages.find(isUserMessage);
		if (!userMessage) {
			return [];
		}
		return [`- user: ${compactSnippet(extractMessageText(userMessage), 180)}`];
	}

	const lines: string[] = [];
	const assistantMessage = group.rawMessages.find(isAssistantMessage);
	if (assistantMessage) {
		const assistantText = extractMessageText(assistantMessage);
		const assistantSummary =
			assistantText.trim().length > 0 ? assistantText : summarizeAssistantToolCalls(assistantMessage);
		if (assistantSummary.trim().length > 0) {
			lines.push(`- assistant: ${compactSnippet(assistantSummary, 180)}`);
		}
	}

	const toolSummary = summarizeGroupTools(group.rawMessages);
	if (toolSummary.trim().length > 0) {
		lines.push(`- tools: ${compactSnippet(toolSummary, 180)}`);
	}

	return lines;
}

function buildCompactedTranscriptText(
	omittedGroups: readonly ConversationGroup[],
	budgetTokens: number,
): string | undefined {
	if (omittedGroups.length === 0 || budgetTokens <= 0) {
		return undefined;
	}

	const header = [
		SUMMARY_MARKER,
		`Older transcript groups compacted before the raw tail: ${omittedGroups.length}. Preserve these points unless new evidence contradicts them.`,
	];
	const lines = omittedGroups.flatMap((group) => summarizeConversationGroup(group));
	if (lines.length === 0) {
		return truncateTextToBudget(header.join("\n"), budgetTokens);
	}

	const candidateText = [...header, ...lines.slice(-10)].join("\n");
	return truncateTextToBudget(candidateText, budgetTokens);
}

function thinkingReserve(thinkingLevel: ThinkingLevel): number {
	switch (thinkingLevel) {
		case "off":
			return 2_048;
		case "minimal":
			return 4_096;
		case "low":
			return 6_144;
		case "medium":
			return 12_288;
		case "high":
			return 20_480;
		case "xhigh":
			return 28_672;
	}
}

function calculateProjectedNextTurnTokens(
	messages: readonly AgentMessage[],
	model: Model<Api>,
	thinkingLevel: ThinkingLevel,
): number {
	const groups = buildConversationGroups(messages);
	const cycleTokens = groups.filter((group) => group.kind === "assistant_cycle").map((group) => group.rawTokens);
	const completionReserve = Math.min(Math.max(model.maxTokens || 8_192, 4_096), 32_768);
	const baseReserve = completionReserve + thinkingReserve(thinkingLevel);
	if (cycleTokens.length === 0) {
		return baseReserve;
	}

	const recentCycles = cycleTokens.slice(-3);
	const averageCycle = recentCycles.reduce((sum, value) => sum + value, 0) / recentCycles.length;
	const projectedFromHistory = Math.min(
		Math.floor(declaredModelContextWindow(model) * 0.4),
		Math.ceil(Math.max(recentCycles[recentCycles.length - 1] ?? 0, averageCycle * 1.25)),
	);
	return Math.max(baseReserve, projectedFromHistory);
}

function createContextMessage(text: string): UserMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

export function assembleResearchContextWindow(options: AssembleResearchContextOptions): AssembleResearchContextResult {
	const contextWindow = modelContextWindow(options.model);
	const projectedNextTurnTokens = calculateProjectedNextTurnTokens(
		options.messages,
		options.model,
		options.thinkingLevel,
	);
	const safetyBuffer = Math.min(
		Math.max(2_048, Math.floor(contextWindow * 0.03)),
		Math.max(1_024, Math.floor(contextWindow * 0.2)),
	);
	const maxWorkingBudget = Math.max(4_096, contextWindow - safetyBuffer);
	const minWorkingBudget = Math.min(MIN_WORKING_BUDGET, maxWorkingBudget);
	const workingBudget = Math.min(
		maxWorkingBudget,
		Math.max(minWorkingBudget, contextWindow - projectedNextTurnTokens - safetyBuffer),
	);

	const durableBudget = Math.max(
		Math.min(MIN_DURABLE_BUDGET, Math.max(1_000, Math.floor(workingBudget * 0.25))),
		Math.min(Math.max(1_000, workingBudget - 2_000), Math.floor(workingBudget * 0.42)),
	);
	const durableContextText = buildDurableContextText(options, durableBudget);
	const durableContextMessage = createContextMessage(durableContextText);
	const durableContextTokens = estimateTextTokens(durableContextText);

	const transcriptBudget = Math.max(
		Math.min(MIN_TRANSCRIPT_BUDGET, Math.max(1_000, workingBudget - durableContextTokens)),
		workingBudget - durableContextTokens,
	);
	const groups = buildConversationGroups(options.messages);
	let rawTail = selectRawTailGroups(groups, transcriptBudget);
	let compactedTranscriptText: string | undefined;

	if (rawTail.omittedGroups.length > 0) {
		const summaryBudget = Math.min(
			Math.max(
				Math.min(MIN_SUMMARY_BUDGET, Math.max(600, Math.floor(workingBudget * 0.1))),
				Math.floor(workingBudget * 0.15),
			),
			Math.max(
				Math.min(MIN_SUMMARY_BUDGET, Math.max(600, Math.floor(transcriptBudget * 0.25))),
				Math.floor(transcriptBudget * 0.33),
			),
		);
		const reducedTailBudget = Math.max(
			Math.min(MIN_TRANSCRIPT_BUDGET, Math.max(1_000, transcriptBudget - summaryBudget)),
			transcriptBudget - summaryBudget,
		);
		rawTail = selectRawTailGroups(groups, reducedTailBudget);
		compactedTranscriptText = buildCompactedTranscriptText(rawTail.omittedGroups, summaryBudget);
	}

	const compactedTranscriptMessage = compactedTranscriptText
		? createContextMessage(compactedTranscriptText)
		: undefined;
	const estimatedTokens =
		durableContextTokens +
		rawTail.tokens +
		(compactedTranscriptText ? estimateTextTokens(compactedTranscriptText) : 0);

	return {
		messages: [
			durableContextMessage,
			...(compactedTranscriptMessage ? [compactedTranscriptMessage] : []),
			...rawTail.messages,
		],
		estimatedTokens,
		projectedNextTurnTokens,
		usedCompaction: rawTail.omittedGroups.length > 0,
		omittedGroupCount: rawTail.omittedGroups.length,
		compactedTranscriptText,
		firstKeptReplayMessageIndex: rawTail.firstKeptMessageIndex,
	};
}

function declaredModelContextWindow(model: Model<Api>): number {
	return model.contextWindow > 0 ? model.contextWindow : DEFAULT_CONTEXT_WINDOW;
}

function shouldApplyOpenAISoftContextAllowance(model: Model<Api>, declaredContextWindow: number): boolean {
	return (
		declaredContextWindow >= DEFAULT_CONTEXT_WINDOW &&
		declaredContextWindow < OPENAI_SOFT_CONTEXT_CAP &&
		OPENAI_SOFT_CONTEXT_PROVIDERS.has(model.api) &&
		/^gpt-5(?:[.-]|$)/.test(model.id)
	);
}

function modelContextWindow(model: Model<Api>): number {
	const declaredContextWindow = declaredModelContextWindow(model);
	if (!shouldApplyOpenAISoftContextAllowance(model, declaredContextWindow)) {
		return declaredContextWindow;
	}

	return Math.min(OPENAI_SOFT_CONTEXT_CAP, declaredContextWindow + OPENAI_SOFT_CONTEXT_ALLOWANCE);
}

class WorkspaceGraphQuery {
	constructor(private readonly workspaceGraph: WorkspaceGraphData) {}

	search(
		query: string,
		maxExact = 8,
		maxRelated = 6,
	): {
		exact: Array<{ node: WorkspaceGraphNode; score: number }>;
		related: Array<{ node: WorkspaceGraphNode; score: number }>;
	} {
		const nodes = Object.values(this.workspaceGraph.nodes);
		const trimmedQuery = query.trim();
		if (trimmedQuery.length === 0) {
			return { exact: [], related: [] };
		}

		const exact = nodes
			.map((node) => ({ node, score: exactMatchScore(node, trimmedQuery) }))
			.filter((hit) => hit.score > 0)
			.sort((left, right) => {
				if (right.score !== left.score) {
					return right.score - left.score;
				}
				if (right.node.score !== left.node.score) {
					return right.node.score - left.node.score;
				}
				return right.node.updatedAt.localeCompare(left.node.updatedAt);
			})
			.slice(0, maxExact);

		const exactIds = new Set(exact.map((hit) => hit.node.id));
		const queryTerms = buildTerms({ label: trimmedQuery, text: trimmedQuery });
		const related = nodes
			.filter((node) => !exactIds.has(node.id))
			.map((node) => ({ node, score: Number(cosineSimilarity(queryTerms, node.terms).toFixed(4)) }))
			.filter((hit) => hit.score >= 0.12)
			.sort((left, right) => {
				if (right.score !== left.score) {
					return right.score - left.score;
				}
				if (right.node.score !== left.node.score) {
					return right.node.score - left.node.score;
				}
				return right.node.updatedAt.localeCompare(left.node.updatedAt);
			})
			.slice(0, maxRelated);

		return { exact, related };
	}
}

function buildTerms(node: {
	label: string;
	summary?: string;
	text?: string;
	tags?: string[];
	path?: string;
}): Record<string, number> {
	const counts = new Map<string, number>();
	const segments = [node.label, node.summary ?? "", node.text ?? "", node.path ?? "", ...(node.tags ?? [])];
	for (const segment of segments) {
		for (const token of tokenize(segment)) {
			counts.set(token, (counts.get(token) ?? 0) + 1);
		}
	}

	const entries = [...counts.entries()].sort((left, right) => {
		if (right[1] !== left[1]) {
			return right[1] - left[1];
		}
		return left[0].localeCompare(right[0]);
	});

	const limitedEntries = entries.slice(0, 64);
	const magnitude = Math.sqrt(limitedEntries.reduce((sum, [, count]) => sum + count * count, 0)) || 1;
	const terms: Record<string, number> = {};
	for (const [token, count] of limitedEntries) {
		terms[token] = Number((count / magnitude).toFixed(4));
	}
	return terms;
}

function cosineSimilarity(left: Record<string, number>, right: Record<string, number>): number {
	const leftKeys = Object.keys(left);
	if (leftKeys.length === 0 || Object.keys(right).length === 0) {
		return 0;
	}

	let sum = 0;
	for (const key of leftKeys) {
		if (right[key] !== undefined) {
			sum += left[key] * right[key];
		}
	}
	return sum;
}

function exactMatchScore(node: WorkspaceGraphNode, query: string): number {
	const terms = tokenize(query);
	if (terms.length === 0) {
		return 0;
	}

	const haystacks = [node.id, node.label, node.summary ?? "", node.text, node.path ?? "", ...node.tags].map((value) =>
		value.toLowerCase(),
	);
	let score = 0;
	for (const term of terms) {
		for (const haystack of haystacks) {
			if (haystack.includes(term)) {
				score++;
				break;
			}
		}
	}
	return score;
}
