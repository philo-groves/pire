import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@mariozechner/pi-ai";
import type { LogicMapStore, LogicStatus, LogicUpsertInput } from "../logic-map/store.js";
import type { ResearchJournalStore, ResearchOverlayScope } from "../research-journal/store.js";
import type { WorkspaceGraphStore } from "../workspace-graph/store.js";

const logicStatusSchema = Type.Union([
	Type.Literal("candidate"),
	Type.Literal("aligned"),
	Type.Literal("violated"),
	Type.Literal("confirmed"),
	Type.Literal("rejected"),
]);

const logicMapToolSchema = Type.Object({
	action: Type.Union([Type.Literal("read"), Type.Literal("upsert")], {
		description:
			"Read the current intended-vs-implemented logic map, or upsert a policy/spec rule with its observed gap.",
	}),
	id: Type.Optional(Type.String({ description: "Stable rule id, e.g. auth:session-role-check" })),
	label: Type.Optional(Type.String({ description: "Human-readable rule name" })),
	intended: Type.Optional(Type.String({ description: "Intended policy, contract, or behavior." })),
	implemented: Type.Optional(Type.String({ description: "Observed implemented behavior." })),
	gap: Type.Optional(Type.String({ description: "Why the implementation diverges or why the invariant matters." })),
	surfaces: Type.Optional(Type.Array(Type.String(), { description: "Related surfaces or endpoints." })),
	evidence: Type.Optional(
		Type.Array(Type.String(), { description: "Supporting evidence for the intended/observed comparison." }),
	),
	status: Type.Optional(logicStatusSchema),
});

type LogicMapToolParams = Static<typeof logicMapToolSchema>;

function normalizeInput(params: LogicMapToolParams): LogicUpsertInput {
	if (!params.id?.trim()) {
		throw new Error('"id" is required.');
	}
	return {
		id: params.id.trim(),
		label: params.label?.trim(),
		intended: params.intended?.trim(),
		implemented: params.implemented?.trim(),
		gap: params.gap?.trim(),
		surfaces: params.surfaces?.map((value) => value.trim()),
		evidence: params.evidence?.map((value) => value.trim()),
		status: params.status as LogicStatus | undefined,
	};
}

export function createLogicMapTool(
	store: LogicMapStore,
	workspaceGraph?: WorkspaceGraphStore,
	journal?: ResearchJournalStore,
	getOverlayScope?: () => ResearchOverlayScope,
): AgentTool<typeof logicMapToolSchema, { action: string; rules: number; id?: string }> {
	return {
		name: "logic_map",
		label: "Logic Map",
		description:
			"Track intended-vs-implemented rules for auth, state machines, business logic, and trust boundaries. Use this when the bug is a policy or invariant mismatch rather than a parser crash.",
		parameters: logicMapToolSchema,
		async execute(_toolCallId: string, params: LogicMapToolParams) {
			const overlayScope = journal && getOverlayScope ? getOverlayScope() : undefined;
			if (params.action === "read") {
				const data = store.read();
				return {
					content: [{ type: "text", text: store.formatForPrompt() }],
					details: {
						action: params.action,
						rules: Object.keys(data.rules).length,
					},
				};
			}

			const updated = await store.upsert(normalizeInput(params));
			const record = updated.rules[params.id?.trim() ?? ""];
			if (workspaceGraph && record) {
				await workspaceGraph.upsertNode({
					id: `logic:${record.id}`,
					kind: "logic_rule",
					label: record.label,
					score: record.status === "confirmed" || record.status === "violated" ? 4 : 3,
					status: record.status,
					summary: record.gap,
					text: `${record.intended}\n${record.implemented}\n${record.gap}\n${record.evidence.join("\n")}`,
					tags: ["logic", ...record.surfaces],
					source: "logic_map",
				});
				for (const surfaceId of record.surfaces) {
					await workspaceGraph.upsertEdge({
						from: `logic:${record.id}`,
						to: surfaceId,
						relation: "constrains",
						weight: 1,
					});
				}
			}
			if (journal && overlayScope) {
				await journal.append({
					sessionId: overlayScope.sessionId,
					sessionLineageIds: overlayScope.sessionLineageIds,
					scope: "workspace",
					domain: "logic_map",
					action: "upsert",
					entityId: record.id,
					summary: `${record.status}: ${record.label}`,
					payload: { record },
				});
				await journal.append({
					sessionId: overlayScope.sessionId,
					sessionLineageIds: overlayScope.sessionLineageIds,
					scope: "workspace",
					domain: "workspace_graph",
					action: "upsert_logic_rule",
					entityId: `logic:${record.id}`,
					summary: record.label,
					payload: { logicRuleId: record.id, surfaces: record.surfaces },
				});
			}

			return {
				content: [{ type: "text", text: `Updated logic rule ${record.id} status=${record.status}` }],
				details: {
					action: params.action,
					rules: Object.keys(updated.rules).length,
					id: record.id,
				},
			};
		},
	};
}
