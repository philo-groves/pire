import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type SurfaceStatus = "candidate" | "hot" | "active" | "blocked" | "covered" | "confirmed" | "rejected";

export interface SurfaceRecord {
	id: string;
	kind: string;
	label: string;
	score: number;
	status: SurfaceStatus;
	why?: string;
	evidence: string[];
	adjacent: string[];
	owner?: string;
	updatedAt: string;
}

export interface SurfaceMapData {
	surfaces: Record<string, SurfaceRecord>;
}

export interface SurfaceUpsertInput {
	id: string;
	kind?: string;
	label?: string;
	score?: number;
	status?: SurfaceStatus;
	why?: string;
	evidence?: string[];
	adjacent?: string[];
	owner?: string;
}

export interface SurfaceUpsertOptions {
	propagateAdjacent?: boolean;
}

export interface SurfaceClaimOptions {
	force?: boolean;
	kind?: string;
	label?: string;
	score?: number;
	why?: string;
	evidence?: string[];
	adjacent?: string[];
}

const mutationQueues = new Map<string, Promise<void>>();

async function withMutationQueue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
	const queueKey = resolve(filePath);
	const currentQueue = mutationQueues.get(queueKey) ?? Promise.resolve();

	let release!: () => void;
	const nextQueue = new Promise<void>((resolveQueue) => {
		release = resolveQueue;
	});
	const chainedQueue = currentQueue.then(() => nextQueue);
	mutationQueues.set(queueKey, chainedQueue);

	await currentQueue;
	try {
		return await fn();
	} finally {
		release();
		if (mutationQueues.get(queueKey) === chainedQueue) {
			mutationQueues.delete(queueKey);
		}
	}
}

function unique(values: string[] | undefined): string[] {
	if (!values || values.length === 0) {
		return [];
	}

	const seen = new Set<string>();
	const items: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		if (trimmed.length === 0 || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		items.push(trimmed);
	}
	return items;
}

function mergeUnique(existing: string[], extra: string[] | undefined): string[] {
	if (!extra || extra.length === 0) {
		return existing;
	}
	return unique([...existing, ...extra]);
}

function rankForPropagation(status: SurfaceStatus): number {
	switch (status) {
		case "confirmed":
			return 3;
		case "active":
			return 2;
		case "hot":
		case "covered":
			return 1;
		default:
			return 0;
	}
}

function propagateAdjacentSurfaces(draft: SurfaceMapData, source: SurfaceRecord): void {
	if (source.adjacent.length === 0) {
		return;
	}

	const statusRank = rankForPropagation(source.status);
	if (statusRank === 0 && source.score < 4) {
		return;
	}

	const now = new Date().toISOString();
	const propagatedScore = Math.max(2, Math.min(5, source.score - (statusRank >= 2 ? 0 : 1)));
	for (const adjacentId of source.adjacent) {
		const adjacent = draft.surfaces[adjacentId];
		if (!adjacent) {
			continue;
		}

		const nextScore = Math.max(adjacent.score, propagatedScore);
		const nextStatus =
			rankForPropagation(adjacent.status) > 0 ? adjacent.status : nextScore >= 4 ? "hot" : adjacent.status;
		const propagationEvidence = `Raised by adjacent ${source.id}`;
		draft.surfaces[adjacentId] = {
			...adjacent,
			score: nextScore,
			status: nextStatus,
			evidence: mergeUnique(adjacent.evidence, [propagationEvidence]),
			updatedAt: now,
		};
	}
}

export class SurfaceMapStore {
	readonly path: string;

	constructor(cwd: string, relativePath = ".pire/surface-map.json") {
		this.path = resolve(cwd, relativePath);
	}

	read(): SurfaceMapData {
		if (!existsSync(this.path)) {
			return { surfaces: {} };
		}

		try {
			const parsed = JSON.parse(readFileSync(this.path, "utf-8")) as Partial<SurfaceMapData>;
			return {
				surfaces: parsed.surfaces ?? {},
			};
		} catch {
			return { surfaces: {} };
		}
	}

	async upsert(input: SurfaceUpsertInput, options?: SurfaceUpsertOptions): Promise<SurfaceMapData> {
		return withMutationQueue(this.path, async () => {
			const draft = this.read();
			const existing = draft.surfaces[input.id];
			if (!existing && (!input.kind || !input.label || input.score === undefined)) {
				throw new Error('New surfaces require "kind", "label", and "score".');
			}

			const record: SurfaceRecord = {
				id: input.id,
				kind: input.kind ?? existing?.kind ?? "surface",
				label: input.label ?? existing?.label ?? input.id,
				score: input.score ?? existing?.score ?? 1,
				status: input.status ?? existing?.status ?? "candidate",
				why: input.why ?? existing?.why,
				evidence: mergeUnique(existing?.evidence ?? [], input.evidence),
				adjacent: mergeUnique(existing?.adjacent ?? [], input.adjacent),
				owner: input.owner ?? existing?.owner,
				updatedAt: new Date().toISOString(),
			};

			draft.surfaces[input.id] = record;
			if (options?.propagateAdjacent) {
				propagateAdjacentSurfaces(draft, record);
			}
			mkdirSync(dirname(this.path), { recursive: true });
			await writeFile(this.path, `${JSON.stringify(draft, null, 2)}\n`, "utf-8");
			return draft;
		});
	}

	async claim(
		id: string,
		owner: string,
		status: SurfaceStatus = "active",
		options?: SurfaceClaimOptions,
	): Promise<SurfaceMapData> {
		const existing = this.read().surfaces[id];
		if (existing?.owner && existing.owner !== owner && !options?.force) {
			throw new Error(
				`Surface "${id}" is already claimed by "${existing.owner}". Release or force the claim explicitly.`,
			);
		}
		const inferredKind = id.includes(":") ? id.slice(0, id.indexOf(":")) : "surface";
		return this.upsert(
			{
				id,
				kind: options?.kind ?? existing?.kind ?? inferredKind,
				label: options?.label ?? existing?.label ?? id,
				score: options?.score ?? existing?.score ?? 3,
				owner,
				status,
				why: options?.why,
				evidence: options?.evidence,
				adjacent: options?.adjacent,
			},
			{ propagateAdjacent: true },
		);
	}

	async release(id: string, owner?: string, force = false): Promise<SurfaceMapData> {
		return withMutationQueue(this.path, async () => {
			const draft = this.read();
			const existing = draft.surfaces[id];
			if (!existing) {
				throw new Error(`Surface "${id}" is not tracked.`);
			}
			if (existing.owner && owner && existing.owner !== owner && !force) {
				throw new Error(`Surface "${id}" is claimed by "${existing.owner}", not "${owner}".`);
			}

			draft.surfaces[id] = {
				...existing,
				owner: undefined,
				status: existing.status === "active" ? "candidate" : existing.status,
				updatedAt: new Date().toISOString(),
			};
			mkdirSync(dirname(this.path), { recursive: true });
			await writeFile(this.path, `${JSON.stringify(draft, null, 2)}\n`, "utf-8");
			return draft;
		});
	}

	formatForPrompt(maxSurfaces = 12): string {
		const data = this.read();
		const surfaces = Object.values(data.surfaces);
		if (surfaces.length === 0) {
			return "[Surface Map]\n(empty)";
		}

		const ranked = surfaces.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			return right.updatedAt.localeCompare(left.updatedAt);
		});

		const lines = [`[Surface Map]`, `Tracked surfaces: ${surfaces.length}`];
		for (const surface of ranked.slice(0, maxSurfaces)) {
			lines.push(`- ${surface.id} [${surface.kind}] score=${surface.score} status=${surface.status}`);
			lines.push(`  label: ${surface.label}`);
			if (surface.owner) {
				lines.push(`  owner: ${surface.owner}`);
			}
			if (surface.why) {
				lines.push(`  why: ${surface.why}`);
			}
			if (surface.evidence.length > 0) {
				lines.push(`  evidence: ${surface.evidence.join(" | ")}`);
			}
			if (surface.adjacent.length > 0) {
				lines.push(`  adjacent: ${surface.adjacent.join(", ")}`);
			}
		}

		if (surfaces.length > maxSurfaces) {
			lines.push(`... ${surfaces.length - maxSurfaces} more surfaces on disk`);
		}

		return lines.join("\n");
	}
}
