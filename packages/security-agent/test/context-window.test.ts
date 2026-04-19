import assert from "node:assert";
import { describe, it } from "node:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Api, AssistantMessage, Model, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
import { assembleResearchContextWindow } from "../src/context-window.js";
import type { LogicMapData } from "../src/logic-map/store.js";
import type { NotebookData } from "../src/notebook/store.js";
import type { SurfaceMapData } from "../src/surface-map/store.js";
import type { ResearchPlan } from "../src/tools/plan.js";
import type { WorkspaceGraphData } from "../src/workspace-graph/store.js";

const TEST_MODEL = {
	id: "test-researcher",
	name: "Test Researcher",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 6_000,
	maxTokens: 2_000,
} as Model<Api>;

const TIGHT_MODEL = {
	...TEST_MODEL,
	contextWindow: 2_500,
	maxTokens: 1_000,
} as Model<Api>;

const OPENAI_GPT5_MODEL = {
	...TEST_MODEL,
	id: "gpt-5.4",
	name: "GPT-5.4",
	api: "openai",
	provider: "openai",
	contextWindow: 272_000,
	maxTokens: 128_000,
} as Model<Api>;

function createUserMessage(text: string, timestamp: number): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp,
	};
}

function createToolAssistantMessage(
	toolCallId: string,
	toolName: string,
	text: string,
	timestamp: number,
): AgentMessage {
	return {
		role: "assistant",
		api: "openai-responses",
		provider: "openai",
		model: "test-researcher",
		stopReason: "toolUse",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		content: [
			{ type: "thinking", thinking: "chain of thought that should be dropped during replay compaction" },
			{ type: "text", text },
			{ type: "toolCall", id: toolCallId, name: toolName, arguments: { query: text.slice(0, 32) } },
		],
		timestamp,
	};
}

function createToolResultMessage(toolCallId: string, toolName: string, text: string, timestamp: number): AgentMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text }],
		isError: false,
		timestamp,
	};
}

function createAssistantMessage(text: string, timestamp: number): AgentMessage {
	return {
		role: "assistant",
		api: "openai",
		provider: "openai",
		model: "gpt-5.4",
		stopReason: "stop",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		content: [{ type: "text", text }],
		timestamp,
	};
}

describe("assembleResearchContextWindow", () => {
	it("compacts earlier assistant cycles inside a long single-user research run while keeping durable state", () => {
		const repeated = (label: string) => `${label} ${"evidence ".repeat(420)}`.trim();
		const messages: AgentMessage[] = [
			createUserMessage("Investigate host header normalization in the proxy path and validate option A.", 1),
			createToolAssistantMessage("tc-1", "workspace_graph", repeated("Cycle one conclusion"), 2),
			createToolResultMessage("tc-1", "workspace_graph", repeated("Cycle one graph result"), 3),
			createToolAssistantMessage("tc-2", "surface_map", repeated("Cycle two conclusion"), 4),
			createToolResultMessage("tc-2", "surface_map", repeated("Cycle two surface mutation"), 5),
			createToolAssistantMessage("tc-3", "bash", repeated("Latest cycle conclusion"), 6),
			createToolResultMessage("tc-3", "bash", repeated("Latest bash proof result"), 7),
		];

		const notebook: NotebookData = {
			proof_notes: "Host normalization appears to differ between blacklist enforcement and downstream forwarding.",
			findings: "Potential durable issue around forwarded Host canonicalization.",
		};
		const surfaceMap: SurfaceMapData = {
			surfaces: {
				"module:proxyprotocol-stripuntrusted": {
					id: "module:proxyprotocol-stripuntrusted",
					kind: "module",
					label: "StripUntrustedProxyHeadersHandler",
					score: 5,
					status: "active",
					why: "Raw Host handling may bypass blacklist canonicalization.",
					evidence: ["Validated adjacent gap around Host-port normalization."],
					adjacent: ["module:request-authority-reconstruction"],
					owner: "researcher",
					updatedAt: "2026-04-19T11:00:00.000Z",
				},
			},
		};
		const logicMap: LogicMapData = {
			rules: {
				"proxy:blacklist-host-port-normalization": {
					id: "proxy:blacklist-host-port-normalization",
					label: "Blacklist should normalize Host authority before trust checks",
					intended: "Reject or canonicalize Host before forwarding decisions.",
					implemented: "Raw Host comparison happens before downstream forwarding.",
					gap: "Host with explicit port can bypass blacklist canonicalization.",
					surfaces: ["module:proxyprotocol-stripuntrusted"],
					evidence: ["Control Host is stripped, candidate Host:443 survives."],
					status: "violated",
					updatedAt: "2026-04-19T11:01:00.000Z",
				},
			},
		};
		const workspaceGraph: WorkspaceGraphData = {
			version: 1,
			nodes: {
				"module:proxyprotocol-stripuntrusted": {
					id: "module:proxyprotocol-stripuntrusted",
					kind: "module",
					label: "StripUntrustedProxyHeadersHandler",
					score: 5,
					status: "active",
					summary: "Trust-boundary logic around forwarded headers and blacklist enforcement.",
					text: "Handles untrusted proxy headers before forwarding to downstream services.",
					tags: ["proxy", "host"],
					source: "workspace_seed",
					terms: {},
					updatedAt: "2026-04-19T11:00:00.000Z",
				},
				"module:request-authority-reconstruction": {
					id: "module:request-authority-reconstruction",
					kind: "module",
					label: "HttpRequestMessageImpl original authority reconstruction",
					score: 4,
					status: "candidate",
					summary: "Consumes forwarded authority metadata after blacklist handling.",
					text: "Downstream authority reconstruction relies on forwarded host values.",
					tags: ["host", "authority"],
					source: "workspace_seed",
					terms: {},
					updatedAt: "2026-04-19T11:00:30.000Z",
				},
			},
			edges: [
				{
					from: "module:proxyprotocol-stripuntrusted",
					to: "module:request-authority-reconstruction",
					relation: "adjacent",
					weight: 1,
					updatedAt: "2026-04-19T11:00:30.000Z",
				},
			],
		};
		const plan: ResearchPlan = {
			createdAt: "2026-04-19T11:02:00.000Z",
			updatedAt: "2026-04-19T11:03:00.000Z",
			phases: [
				{
					name: "Validate strongest candidate",
					parallelSteps: false,
					status: "in_progress",
					steps: [{ text: "Build proof for Host canonicalization gap", status: "in_progress" }],
				},
			],
		};

		const result = assembleResearchContextWindow({
			cwd: "/repo",
			contextFiles: [{ path: "/repo/AGENTS.md", content: "Research only the active workspace scope." }],
			recommendedActionsText: "A. Validate Host normalization in proxy blacklist handling.",
			notebook,
			surfaceMap,
			logicMap,
			workspaceGraph,
			plan,
			messages,
			model: TIGHT_MODEL,
			thinkingLevel: "medium",
		});

		assert.strictEqual(result.usedCompaction, true);
		assert.ok(result.omittedGroupCount > 0);

		const renderedTexts = result.messages.map((message) => extractMessageText(message)).join("\n\n");
		assert.match(renderedTexts, /\[Workspace Context\]/);
		assert.match(renderedTexts, /StripUntrustedProxyHeadersHandler/);
		assert.match(renderedTexts, /\[Compacted Transcript\]/);
		assert.match(renderedTexts, /Latest cycle conclusion/);
		assert.match(renderedTexts, /Investigate host header normalization/);

		const assistantReplayTexts = result.messages
			.filter((message): message is Extract<AgentMessage, { role: "assistant" }> => message.role === "assistant")
			.map((message) => extractMessageText(message))
			.join("\n");
		assert.doesNotMatch(assistantReplayTexts, /Cycle one conclusion/);
	});

	it("keeps recommended-action labels in durable context on the first user message", () => {
		const messages: AgentMessage[] = [createUserMessage("Let's go with option A.", 1)];

		const result = assembleResearchContextWindow({
			cwd: "/repo",
			contextFiles: [],
			recommendedActionsText:
				"A. Validate the active candidate.\nB. Draft the report.\nC. Compare against the known control path.",
			notebook: {},
			surfaceMap: { surfaces: {} },
			logicMap: { rules: {} },
			workspaceGraph: { version: 1, nodes: {}, edges: [] },
			plan: undefined,
			messages,
			model: TEST_MODEL,
			thinkingLevel: "medium",
		});

		assert.strictEqual(result.usedCompaction, false);
		const durableContextText = extractMessageText(result.messages[0]!);
		assert.match(durableContextText, /\[Recommended Actions\]/);
		assert.match(durableContextText, /1=A, 2=B, 3=C/);
		assert.match(durableContextText, /Validate the active candidate/);
	});

	it("injects a persisted compaction checkpoint into durable context before the raw tail", () => {
		const messages: AgentMessage[] = [createUserMessage("Continue the active proof branch.", 1)];

		const result = assembleResearchContextWindow({
			cwd: "/repo",
			contextFiles: [],
			recommendedActionsText: undefined,
			persistedCompactionSummary:
				"Compacted from 18 earlier transcript groups. Proven controls: Host without explicit port strips attacker-supplied forwarding headers.",
			notebook: {},
			surfaceMap: { surfaces: {} },
			logicMap: { rules: {} },
			workspaceGraph: { version: 1, nodes: {}, edges: [] },
			plan: undefined,
			messages,
			model: TEST_MODEL,
			thinkingLevel: "medium",
		});

		const durableContextText = extractMessageText(result.messages[0]!);
		assert.match(durableContextText, /\[Persisted Compaction Checkpoint\]/);
		assert.match(durableContextText, /Proven controls: Host without explicit port strips/);
	});

	it("gives eligible OpenAI GPT-5 runs extra context headroom before compaction", () => {
		const assistantBlock = "validated candidate evidence ".repeat(4_000);
		const messages: AgentMessage[] = [createUserMessage("Continue the active GPT-5 research run.", 1)];
		for (let index = 0; index < 10; index++) {
			messages.push(createAssistantMessage(`${index + 1}: ${assistantBlock}`, index + 2));
		}

		const strictWindowResult = assembleResearchContextWindow({
			cwd: "/repo",
			contextFiles: [],
			recommendedActionsText: undefined,
			notebook: {},
			surfaceMap: { surfaces: {} },
			logicMap: { rules: {} },
			workspaceGraph: { version: 1, nodes: {}, edges: [] },
			plan: undefined,
			messages,
			model: {
				...OPENAI_GPT5_MODEL,
				id: "test-openai-gpt5-without-soft-overflow",
				api: "anthropic",
				provider: "anthropic",
			} as Model<Api>,
			thinkingLevel: "medium",
		});
		const softWindowResult = assembleResearchContextWindow({
			cwd: "/repo",
			contextFiles: [],
			recommendedActionsText: undefined,
			notebook: {},
			surfaceMap: { surfaces: {} },
			logicMap: { rules: {} },
			workspaceGraph: { version: 1, nodes: {}, edges: [] },
			plan: undefined,
			messages,
			model: OPENAI_GPT5_MODEL,
			thinkingLevel: "medium",
		});

		assert.strictEqual(strictWindowResult.usedCompaction, true);
		assert.strictEqual(softWindowResult.usedCompaction, false);
		assert.ok(softWindowResult.estimatedTokens > strictWindowResult.estimatedTokens);
	});
});

function extractMessageText(message: AgentMessage): string {
	if (message.role === "assistant") {
		const assistantMessage = message as AssistantMessage;
		return assistantMessage.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n");
	}

	if (message.role !== "user" && message.role !== "toolResult") {
		return "";
	}

	const contentMessage = message as UserMessage | ToolResultMessage;
	if (typeof contentMessage.content === "string") {
		return contentMessage.content;
	}

	return contentMessage.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}
