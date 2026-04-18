import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@mariozechner/pi-ai";
import type { WorkspaceGraphStore } from "../workspace-graph/store.js";

const workspaceGraphToolSchema = Type.Object({
	action: Type.Union([Type.Literal("read"), Type.Literal("search")], {
		description:
			"Read the persistent workspace graph or search it using exact identifiers first and related recall second.",
	}),
	query: Type.Optional(
		Type.String({ description: "Identifier, path, target, component, or evidence string to search for." }),
	),
	maxExact: Type.Optional(Type.Number({ description: "Maximum exact-match results to return." })),
	maxRelated: Type.Optional(Type.Number({ description: "Maximum related-recall results to return." })),
});

type WorkspaceGraphToolParams = Static<typeof workspaceGraphToolSchema>;

export function createWorkspaceGraphTool(
	store: WorkspaceGraphStore,
): AgentTool<typeof workspaceGraphToolSchema, { action: string; nodes: number; exact?: number; related?: number }> {
	return {
		name: "workspace_graph",
		label: "Workspace Graph",
		description:
			"Read or search the persistent workspace graph. Use this to reuse prior nearby work, exact identifiers, and related surfaces before rediscovering the same target.",
		parameters: workspaceGraphToolSchema,
		async execute(_toolCallId: string, params: WorkspaceGraphToolParams) {
			const data = store.read();
			if (params.action === "read") {
				return {
					content: [{ type: "text", text: store.formatForPrompt() }],
					details: {
						action: params.action,
						nodes: Object.keys(data.nodes).length,
					},
				};
			}

			const query = params.query?.trim();
			if (!query) {
				throw new Error('"query" is required for workspace_graph search.');
			}
			const result = store.search(query, params.maxExact ?? 8, params.maxRelated ?? 6);
			return {
				content: [{ type: "text", text: store.formatSearchResult(query, result) }],
				details: {
					action: params.action,
					nodes: Object.keys(data.nodes).length,
					exact: result.exact.length,
					related: result.related.length,
				},
			};
		},
	};
}
