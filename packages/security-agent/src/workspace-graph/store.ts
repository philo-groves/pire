import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SurfaceRecord } from "../surface-map/store.js";

const mutationQueues = new Map<string, Promise<void>>();
const GRAPH_VERSION = 1;
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
]);

export interface WorkspaceGraphNode {
	id: string;
	kind: string;
	label: string;
	score: number;
	status: string;
	summary?: string;
	text: string;
	tags: string[];
	path?: string;
	source: string;
	terms: Record<string, number>;
	updatedAt: string;
}

export interface WorkspaceGraphEdge {
	from: string;
	to: string;
	relation: string;
	weight: number;
	updatedAt: string;
}

export interface WorkspaceGraphData {
	version: number;
	nodes: Record<string, WorkspaceGraphNode>;
	edges: WorkspaceGraphEdge[];
}

export interface WorkspaceGraphNodeInput {
	id: string;
	kind: string;
	label: string;
	score?: number;
	status?: string;
	summary?: string;
	text?: string;
	tags?: string[];
	path?: string;
	source?: string;
}

export interface WorkspaceGraphEdgeInput {
	from: string;
	to: string;
	relation: string;
	weight?: number;
}

export interface WorkspaceGraphSeed {
	nodes: WorkspaceGraphNodeInput[];
	edges?: WorkspaceGraphEdgeInput[];
}

export interface WorkspaceGraphSearchHit {
	node: WorkspaceGraphNode;
	score: number;
	mode: "exact" | "vector";
}

export interface WorkspaceGraphSearchResult {
	exact: WorkspaceGraphSearchHit[];
	related: WorkspaceGraphSearchHit[];
}

export interface FindingCandidateInput {
	id?: string;
	label: string;
	summary: string;
	surfaces?: string[];
	evidence?: string[];
	tags?: string[];
	proof?: string;
	status?: "candidate" | "confirmed" | "rejected";
	force?: boolean;
}

export interface FindingReview {
	recommendation: "promote" | "needs_more_evidence" | "possible_duplicate";
	reasons: string[];
	evidenceScore: number;
	exactMatches: WorkspaceGraphSearchHit[];
	relatedMatches: WorkspaceGraphSearchHit[];
}

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
		if (trimmed.length === 0) {
			continue;
		}
		const normalized = trimmed.toLowerCase();
		if (seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		items.push(trimmed);
	}
	return items;
}

function tokenize(text: string): string[] {
	const matches = text.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? [];
	return matches.filter((token) => !STOP_WORDS.has(token));
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

function mergeText(parts: Array<string | undefined>): string {
	const trimmed = parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part && part.length > 0));
	return trimmed.join("\n");
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

function buildFindingQuery(input: FindingCandidateInput): string {
	return [
		input.id,
		input.label,
		input.summary,
		...(input.surfaces ?? []),
		...(input.tags ?? []),
		...(input.evidence ?? []),
		input.proof,
	]
		.filter((part): part is string => Boolean(part && part.trim().length > 0))
		.join("\n");
}

function scoreFindingEvidence(input: FindingCandidateInput): { score: number; reasons: string[] } {
	let score = 0;
	const reasons: string[] = [];

	if ((input.surfaces?.length ?? 0) > 0) {
		score += Math.min(2, input.surfaces?.length ?? 0);
		reasons.push(`linked surfaces: ${input.surfaces?.length ?? 0}`);
	}
	if ((input.evidence?.length ?? 0) >= 2) {
		score += 2;
		reasons.push(`evidence items: ${input.evidence?.length ?? 0}`);
	} else if ((input.evidence?.length ?? 0) === 1) {
		score += 1;
		reasons.push("single evidence item");
	}
	if (input.summary.trim().length >= 80) {
		score += 1;
		reasons.push("detailed summary");
	}
	if (input.proof?.trim()) {
		score += 2;
		reasons.push("target-backed proof evidence");
	}
	if (input.status === "confirmed") {
		score += 1;
		reasons.push("explicit confirmed status");
	}
	return { score, reasons };
}

function edgeKey(edge: WorkspaceGraphEdgeInput): string {
	return `${edge.from}\u0000${edge.to}\u0000${edge.relation}`;
}

function mergeSeedIntoDraft(draft: WorkspaceGraphData, seed: WorkspaceGraphSeed): WorkspaceGraphData {
	for (const node of seed.nodes) {
		const existing = draft.nodes[node.id];
		draft.nodes[node.id] = normalizeNode(node, existing);
	}
	for (const edgeInput of seed.edges ?? []) {
		const key = edgeKey(edgeInput);
		const existingIndex = draft.edges.findIndex((edge) => edgeKey(edge) === key);
		const edge: WorkspaceGraphEdge = {
			from: edgeInput.from,
			to: edgeInput.to,
			relation: edgeInput.relation,
			weight: edgeInput.weight ?? 1,
			updatedAt: new Date().toISOString(),
		};
		if (existingIndex >= 0) {
			draft.edges[existingIndex] = edge;
		} else {
			draft.edges.push(edge);
		}
	}
	return draft;
}

function exactMatchScore(node: WorkspaceGraphNode, query: string): number {
	const lowerQuery = query.toLowerCase();
	if (lowerQuery.length === 0) {
		return 0;
	}

	let score = 0;
	if (node.id.toLowerCase() === lowerQuery) {
		score += 6;
	} else if (node.id.toLowerCase().includes(lowerQuery)) {
		score += 4;
	}
	if (node.label.toLowerCase().includes(lowerQuery)) {
		score += 4;
	}
	if (node.path?.toLowerCase().includes(lowerQuery)) {
		score += 3;
	}
	if (node.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))) {
		score += 3;
	}
	if (node.summary?.toLowerCase().includes(lowerQuery)) {
		score += 2;
	}
	if (node.text.toLowerCase().includes(lowerQuery)) {
		score += 1;
	}
	return score;
}

function normalizeNode(input: WorkspaceGraphNodeInput, existing?: WorkspaceGraphNode): WorkspaceGraphNode {
	const tags = unique([...(existing?.tags ?? []), ...(input.tags ?? [])]);
	const summary = input.summary?.trim() || existing?.summary;
	const text = mergeText([existing?.text, input.text, summary]);
	return {
		id: input.id,
		kind: input.kind || existing?.kind || "surface",
		label: input.label || existing?.label || input.id,
		score: input.score ?? existing?.score ?? 1,
		status: input.status ?? existing?.status ?? "candidate",
		summary,
		text,
		tags,
		path: input.path ?? existing?.path,
		source: input.source ?? existing?.source ?? "workspace",
		terms: buildTerms({
			label: input.label || existing?.label || input.id,
			summary,
			text,
			tags,
			path: input.path ?? existing?.path,
		}),
		updatedAt: new Date().toISOString(),
	};
}

export class WorkspaceGraphStore {
	readonly workspaceRoot: string;
	readonly path: string;

	constructor(workspaceRoot: string, relativePath = ".pire/workspace-graph.json") {
		this.workspaceRoot = resolve(workspaceRoot);
		this.path = resolve(this.workspaceRoot, relativePath);
	}

	read(): WorkspaceGraphData {
		if (!existsSync(this.path)) {
			return { version: GRAPH_VERSION, nodes: {}, edges: [] };
		}

		try {
			const parsed = JSON.parse(readFileSync(this.path, "utf-8")) as Partial<WorkspaceGraphData>;
			return {
				version: parsed.version ?? GRAPH_VERSION,
				nodes: parsed.nodes ?? {},
				edges: parsed.edges ?? [],
			};
		} catch {
			return { version: GRAPH_VERSION, nodes: {}, edges: [] };
		}
	}

	isEmpty(): boolean {
		return Object.keys(this.read().nodes).length === 0;
	}

	private async write(data: WorkspaceGraphData): Promise<WorkspaceGraphData> {
		mkdirSync(dirname(this.path), { recursive: true });
		await writeFile(this.path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
		return data;
	}

	async mergeSeed(seed: WorkspaceGraphSeed): Promise<WorkspaceGraphData> {
		return withMutationQueue(this.path, async () => {
			return this.write(mergeSeedIntoDraft(this.read(), seed));
		});
	}

	async upsertNode(input: WorkspaceGraphNodeInput): Promise<WorkspaceGraphData> {
		return withMutationQueue(this.path, async () => {
			const draft = this.read();
			const existing = draft.nodes[input.id];
			draft.nodes[input.id] = normalizeNode(input, existing);
			return this.write(draft);
		});
	}

	async upsertEdge(input: WorkspaceGraphEdgeInput): Promise<WorkspaceGraphData> {
		return withMutationQueue(this.path, async () => {
			const draft = this.read();
			const key = edgeKey(input);
			const existingIndex = draft.edges.findIndex((edge) => edgeKey(edge) === key);
			const edge: WorkspaceGraphEdge = {
				from: input.from,
				to: input.to,
				relation: input.relation,
				weight: input.weight ?? 1,
				updatedAt: new Date().toISOString(),
			};
			if (existingIndex >= 0) {
				draft.edges[existingIndex] = edge;
			} else {
				draft.edges.push(edge);
			}
			return this.write(draft);
		});
	}

	async seedIfEmpty(seed: WorkspaceGraphSeed): Promise<WorkspaceGraphData> {
		return withMutationQueue(this.path, async () => {
			const draft = this.read();
			if (Object.keys(draft.nodes).length > 0) {
				return draft;
			}
			return this.write(mergeSeedIntoDraft(draft, seed));
		});
	}

	async syncSurface(surface: SurfaceRecord): Promise<WorkspaceGraphData> {
		return withMutationQueue(this.path, async () => {
			const draft = this.read();
			draft.nodes[surface.id] = normalizeNode(
				{
					id: surface.id,
					kind: surface.kind,
					label: surface.label,
					score: surface.score,
					status: surface.status,
					summary: surface.why,
					text: mergeText([surface.why, surface.evidence.join("\n")]),
					tags: surface.evidence,
					source: "surface_map",
				},
				draft.nodes[surface.id],
			);

			for (const adjacent of surface.adjacent) {
				const key = edgeKey({
					from: surface.id,
					to: adjacent,
					relation: "adjacent",
				});
				const existingIndex = draft.edges.findIndex((edge) => edgeKey(edge) === key);
				const edge: WorkspaceGraphEdge = {
					from: surface.id,
					to: adjacent,
					relation: "adjacent",
					weight: 1,
					updatedAt: new Date().toISOString(),
				};
				if (existingIndex >= 0) {
					draft.edges[existingIndex] = edge;
				} else {
					draft.edges.push(edge);
				}
			}

			return this.write(draft);
		});
	}

	reviewFindingCandidate(input: FindingCandidateInput): FindingReview {
		const query = buildFindingQuery(input);
		const result = this.search(query, 6, 6);
		const exactMatches = result.exact.filter((hit) => hit.node.kind === "finding" && hit.node.id !== input.id);
		const relatedMatches = result.related.filter((hit) => hit.node.kind === "finding" && hit.node.id !== input.id);
		const evidence = scoreFindingEvidence(input);
		const reasons = [...evidence.reasons];

		const strongDuplicate =
			exactMatches.some((hit) => hit.score >= 6) || relatedMatches.some((hit) => hit.score >= 0.5);
		if (strongDuplicate) {
			reasons.push("similar durable finding already exists in the workspace graph");
			return {
				recommendation: "possible_duplicate",
				reasons,
				evidenceScore: evidence.score,
				exactMatches,
				relatedMatches,
			};
		}

		if (evidence.score >= 4) {
			reasons.push("evidence is strong enough for durable promotion");
			return {
				recommendation: "promote",
				reasons,
				evidenceScore: evidence.score,
				exactMatches,
				relatedMatches,
			};
		}

		reasons.push("candidate still needs stronger target-backed evidence or more linked context");
		return {
			recommendation: "needs_more_evidence",
			reasons,
			evidenceScore: evidence.score,
			exactMatches,
			relatedMatches,
		};
	}

	async promoteFinding(input: FindingCandidateInput): Promise<{
		id?: string;
		blocked: boolean;
		review: FindingReview;
	}> {
		const review = this.reviewFindingCandidate(input);
		if (review.recommendation === "possible_duplicate" && !input.force) {
			return { blocked: true, review };
		}

		const findingId = input.id?.trim() || `finding:${slugify(input.label)}`;
		const status = review.recommendation === "promote" ? "confirmed" : (input.status ?? "candidate");
		await this.upsertNode({
			id: findingId,
			kind: "finding",
			label: input.label.trim(),
			score: review.recommendation === "promote" ? 5 : 3,
			status,
			summary: input.summary.trim(),
			text: mergeText([input.summary, ...(input.evidence ?? []), input.proof]),
			tags: unique(["finding", ...(input.tags ?? []), ...(input.surfaces ?? [])]),
			source: "finding_gate",
		});

		for (const surfaceId of input.surfaces ?? []) {
			await this.upsertEdge({
				from: findingId,
				to: surfaceId,
				relation: "touches",
				weight: 1,
			});
		}

		for (const duplicate of [...review.exactMatches, ...review.relatedMatches].slice(0, 4)) {
			await this.upsertEdge({
				from: findingId,
				to: duplicate.node.id,
				relation: "related_finding",
				weight: duplicate.score,
			});
		}

		return { id: findingId, blocked: false, review };
	}

	search(query: string, maxExact = 8, maxRelated = 6): WorkspaceGraphSearchResult {
		const data = this.read();
		const nodes = Object.values(data.nodes);
		const trimmedQuery = query.trim();
		if (trimmedQuery.length === 0) {
			return { exact: [], related: [] };
		}

		const exact = nodes
			.map((node) => ({ node, score: exactMatchScore(node, trimmedQuery), mode: "exact" as const }))
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
			.map((node) => ({
				node,
				score: Number(cosineSimilarity(queryTerms, node.terms).toFixed(4)),
				mode: "vector" as const,
			}))
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

	formatForPrompt(maxNodes = 8): string {
		const data = this.read();
		const nodes = Object.values(data.nodes);
		if (nodes.length === 0) {
			return "[Workspace Graph]\n(empty)";
		}

		const ranked = nodes.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			return right.updatedAt.localeCompare(left.updatedAt);
		});

		const lines = [`[Workspace Graph]`, `Persistent nodes: ${nodes.length}`];
		for (const node of ranked.slice(0, maxNodes)) {
			lines.push(`- ${node.id} [${node.kind}] score=${node.score} status=${node.status}`);
			lines.push(`  label: ${node.label}`);
			if (node.path) {
				lines.push(`  path: ${node.path}`);
			}
			if (node.summary) {
				lines.push(`  summary: ${node.summary}`);
			}
			if (node.tags.length > 0) {
				lines.push(`  tags: ${node.tags.slice(0, 8).join(", ")}`);
			}
		}

		if (nodes.length > maxNodes) {
			lines.push(`... ${nodes.length - maxNodes} more nodes on disk`);
		}

		return lines.join("\n");
	}

	formatSearchResult(query: string, result: WorkspaceGraphSearchResult): string {
		const lines = [`Workspace graph results for: ${query}`];
		if (result.exact.length === 0 && result.related.length === 0) {
			lines.push("(no matches)");
			return lines.join("\n");
		}

		if (result.exact.length > 0) {
			lines.push("Exact matches:");
			for (const hit of result.exact) {
				lines.push(
					`- ${hit.node.id} [${hit.node.kind}] exact=${hit.score} score=${hit.node.score} label=${hit.node.label}`,
				);
				if (hit.node.path) {
					lines.push(`  path: ${hit.node.path}`);
				}
				if (hit.node.summary) {
					lines.push(`  summary: ${hit.node.summary}`);
				}
			}
		}

		if (result.related.length > 0) {
			lines.push("Related recall:");
			for (const hit of result.related) {
				lines.push(
					`- ${hit.node.id} [${hit.node.kind}] similarity=${hit.score.toFixed(3)} score=${hit.node.score} label=${hit.node.label}`,
				);
				if (hit.node.path) {
					lines.push(`  path: ${hit.node.path}`);
				}
				if (hit.node.summary) {
					lines.push(`  summary: ${hit.node.summary}`);
				}
			}
		}

		return lines.join("\n");
	}

	formatFindingReview(input: FindingCandidateInput, review: FindingReview): string {
		const lines = [
			`Finding gate review for: ${input.label}`,
			`Recommendation: ${review.recommendation}`,
			`Evidence score: ${review.evidenceScore}`,
		];
		for (const reason of review.reasons) {
			lines.push(`- ${reason}`);
		}

		if (review.exactMatches.length > 0) {
			lines.push("Exact durable matches:");
			for (const hit of review.exactMatches) {
				lines.push(`- ${hit.node.id} exact=${hit.score} label=${hit.node.label}`);
			}
		}
		if (review.relatedMatches.length > 0) {
			lines.push("Related durable matches:");
			for (const hit of review.relatedMatches) {
				lines.push(`- ${hit.node.id} similarity=${hit.score.toFixed(3)} label=${hit.node.label}`);
			}
		}

		return lines.join("\n");
	}
}
