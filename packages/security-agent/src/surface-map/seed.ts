import type { WorkspaceGraphStore } from "../workspace-graph/store.js";
import type { SurfaceMapStore, SurfaceStatus, SurfaceUpsertInput } from "./store.js";

function toSurfaceStatus(status: string): SurfaceStatus {
	switch (status) {
		case "hot":
		case "active":
		case "blocked":
		case "covered":
		case "confirmed":
		case "rejected":
			return status;
		default:
			return "candidate";
	}
}

export async function seedSurfaceMapFromWorkspaceGraph(
	surfaceMap: SurfaceMapStore,
	workspaceGraph: WorkspaceGraphStore,
	maxSurfaces = 8,
): Promise<boolean> {
	const existing = surfaceMap.read();
	if (Object.keys(existing.surfaces).length > 0) {
		return false;
	}

	const graph = workspaceGraph.read();
	const nodes = Object.values(graph.nodes)
		.filter((node) => node.kind !== "finding")
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			return right.updatedAt.localeCompare(left.updatedAt);
		});

	if (nodes.length === 0) {
		return false;
	}

	const adjacency = new Map<string, string[]>();
	for (const edge of graph.edges) {
		const neighbors = adjacency.get(edge.from) ?? [];
		if (!neighbors.includes(edge.to)) {
			neighbors.push(edge.to);
		}
		adjacency.set(edge.from, neighbors);
	}

	for (const node of nodes.slice(0, maxSurfaces)) {
		const upsert: SurfaceUpsertInput = {
			id: node.id,
			kind: node.kind,
			label: node.label,
			score: node.score,
			status: toSurfaceStatus(node.status),
			why: node.summary,
			evidence: node.tags.slice(0, 6),
			adjacent: adjacency.get(node.id) ?? [],
		};
		await surfaceMap.upsert(upsert);
	}

	return true;
}
