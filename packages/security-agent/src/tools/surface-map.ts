import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@mariozechner/pi-ai";
import type { SurfaceMapStore, SurfaceStatus, SurfaceUpsertInput } from "../surface-map/store.js";
import type { WorkspaceGraphStore } from "../workspace-graph/store.js";

const surfaceStatusSchema = Type.Union([
	Type.Literal("candidate"),
	Type.Literal("hot"),
	Type.Literal("active"),
	Type.Literal("blocked"),
	Type.Literal("covered"),
	Type.Literal("confirmed"),
	Type.Literal("rejected"),
]);

const surfaceMapToolSchema = Type.Object({
	action: Type.Union([Type.Literal("read"), Type.Literal("upsert"), Type.Literal("claim"), Type.Literal("release")], {
		description:
			"Read the current surface map, upsert a ranked surface, claim a surface for active work, or release a claim.",
	}),
	id: Type.Optional(Type.String({ description: "Stable surface id, e.g. parser:cmap or route:login" })),
	kind: Type.Optional(
		Type.String({
			description: "Surface kind, e.g. file, module, symbol, parser, endpoint, auth_flow, binary, boundary",
		}),
	),
	label: Type.Optional(Type.String({ description: "Human-readable surface name" })),
	score: Type.Optional(Type.Number({ description: "Priority score from 1 (cold) to 5 (hot and reachable)." })),
	status: Type.Optional(surfaceStatusSchema),
	why: Type.Optional(Type.String({ description: "Short reason this surface matters" })),
	evidence: Type.Optional(
		Type.Array(Type.String(), {
			description: "Short evidence strings that justify or refine the ranking",
		}),
	),
	adjacent: Type.Optional(
		Type.Array(Type.String(), {
			description: "Neighbor surface ids that should be considered if this surface gets hotter",
		}),
	),
	owner: Type.Optional(Type.String({ description: "Short owner label for active work on this surface" })),
	force: Type.Optional(
		Type.Boolean({ description: "Allow an explicit takeover or release when the current owner is different." }),
	),
});

type SurfaceMapToolParams = Static<typeof surfaceMapToolSchema>;

function validateUpsert(params: SurfaceMapToolParams): SurfaceUpsertInput {
	if (!params.id || params.id.trim().length === 0) {
		throw new Error('"id" is required.');
	}

	return {
		id: params.id.trim(),
		kind: params.kind?.trim(),
		label: params.label?.trim(),
		score: params.score,
		status: params.status as SurfaceStatus | undefined,
		why: params.why?.trim(),
		evidence: params.evidence?.map((value) => value.trim()),
		adjacent: params.adjacent?.map((value) => value.trim()),
		owner: params.owner?.trim(),
	};
}

export function createSurfaceMapTool(
	store: SurfaceMapStore,
	workspaceGraph?: WorkspaceGraphStore,
): AgentTool<typeof surfaceMapToolSchema, { action: string; surfaces: number; id?: string }> {
	return {
		name: "surface_map",
		label: "Surface Map",
		description:
			"Track, rank, and claim likely attack surfaces. Use this early to map promising surfaces and update it as evidence raises or lowers neighboring targets.",
		parameters: surfaceMapToolSchema,
		async execute(_toolCallId: string, params: SurfaceMapToolParams) {
			if (params.action === "read") {
				const data = store.read();
				return {
					content: [{ type: "text", text: store.formatForPrompt() }],
					details: {
						action: params.action,
						surfaces: Object.keys(data.surfaces).length,
					},
				};
			}

			if (params.action === "claim") {
				if (!params.id || params.id.trim().length === 0) {
					throw new Error('"id" is required for claim.');
				}
				if (!params.owner || params.owner.trim().length === 0) {
					throw new Error('"owner" is required for claim.');
				}
				const updated = await store.claim(
					params.id.trim(),
					params.owner.trim(),
					(params.status as SurfaceStatus | undefined) ?? "active",
					{
						force: params.force,
						kind: params.kind?.trim(),
						label: params.label?.trim(),
						score: params.score,
						why: params.why?.trim(),
						evidence: params.evidence?.map((value) => value.trim()),
						adjacent: params.adjacent?.map((value) => value.trim()),
					},
				);
				const claimedSurface = updated.surfaces[params.id.trim()];
				if (workspaceGraph && claimedSurface) {
					await workspaceGraph.syncSurface(claimedSurface);
					for (const adjacentId of claimedSurface.adjacent) {
						const adjacent = updated.surfaces[adjacentId];
						if (adjacent) {
							await workspaceGraph.syncSurface(adjacent);
						}
					}
				}
				return {
					content: [{ type: "text", text: `Claimed ${params.id.trim()} for ${params.owner.trim()}` }],
					details: {
						action: params.action,
						id: params.id.trim(),
						surfaces: Object.keys(updated.surfaces).length,
					},
				};
			}

			if (params.action === "release") {
				if (!params.id || params.id.trim().length === 0) {
					throw new Error('"id" is required for release.');
				}
				const updated = await store.release(params.id.trim(), params.owner?.trim(), params.force ?? false);
				const releasedSurface = updated.surfaces[params.id.trim()];
				if (workspaceGraph && releasedSurface) {
					await workspaceGraph.syncSurface(releasedSurface);
				}
				return {
					content: [{ type: "text", text: `Released ${params.id.trim()}` }],
					details: {
						action: params.action,
						id: params.id.trim(),
						surfaces: Object.keys(updated.surfaces).length,
					},
				};
			}

			const updated = await store.upsert(validateUpsert(params), { propagateAdjacent: true });
			const surface = updated.surfaces[params.id?.trim() ?? ""];
			if (workspaceGraph && surface) {
				await workspaceGraph.syncSurface(surface);
				for (const adjacentId of surface.adjacent) {
					const adjacent = updated.surfaces[adjacentId];
					if (adjacent) {
						await workspaceGraph.syncSurface(adjacent);
					}
				}
			}
			return {
				content: [
					{
						type: "text",
						text: `Updated ${surface.id} [${surface.kind}] score=${surface.score} status=${surface.status}`,
					},
				],
				details: {
					action: params.action,
					id: surface.id,
					surfaces: Object.keys(updated.surfaces).length,
				},
			};
		},
	};
}
