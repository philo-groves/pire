import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ResearchJournalScope, ResearchJournalStore, ResearchOverlayScope } from "../research-journal/store.js";

export type ResearchArtifactKind =
	| "hypothesis"
	| "proof"
	| "negative_result"
	| "repro"
	| "report_note"
	| "finding_note";

export type ResearchArtifactStatus = "active" | "validated" | "rejected" | "superseded";

export interface ResearchArtifactRecord {
	id: string;
	kind: ResearchArtifactKind;
	title: string;
	summary: string;
	content?: string;
	surfaces: string[];
	findingIds: string[];
	logicRuleIds: string[];
	commands: string[];
	artifactPaths: string[];
	tags: string[];
	status: ResearchArtifactStatus;
	storageScope: ResearchJournalScope;
	sessionId?: string;
	updatedAt: string;
}

export interface ResearchArtifactData {
	artifacts: Record<string, ResearchArtifactRecord>;
}

export interface ResearchArtifactUpsertInput {
	id: string;
	kind?: ResearchArtifactKind;
	title?: string;
	summary?: string;
	content?: string;
	surfaces?: string[];
	findingIds?: string[];
	logicRuleIds?: string[];
	commands?: string[];
	artifactPaths?: string[];
	tags?: string[];
	status?: ResearchArtifactStatus;
}

interface ResearchArtifactJournalPayload {
	record?: ResearchArtifactRecord;
	id?: string;
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
		if (trimmed.length === 0 || seen.has(trimmed.toLowerCase())) {
			continue;
		}
		seen.add(trimmed.toLowerCase());
		items.push(trimmed);
	}
	return items;
}

function mergeUnique(existing: string[], extra: string[] | undefined): string[] {
	return unique([...existing, ...(extra ?? [])]);
}

function defaultArtifactKind(id: string): ResearchArtifactKind {
	if (id.startsWith("proof:")) {
		return "proof";
	}
	if (id.startsWith("repro:")) {
		return "repro";
	}
	if (id.startsWith("note:")) {
		return "report_note";
	}
	return "hypothesis";
}

function readBaseArtifacts(path: string): ResearchArtifactData {
	if (!existsSync(path)) {
		return { artifacts: {} };
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<ResearchArtifactData>;
		return { artifacts: parsed.artifacts ?? {} };
	} catch {
		return { artifacts: {} };
	}
}

function applyJournalEntries(
	draft: ResearchArtifactData,
	entries: ReturnType<ResearchJournalStore["readForLineage"]>,
): ResearchArtifactData {
	for (const entry of entries) {
		if (entry.domain !== "research_artifact" || entry.scope !== "session") {
			continue;
		}
		const payload = entry.payload as ResearchArtifactJournalPayload;
		if (entry.action === "delete" && payload.id) {
			delete draft.artifacts[payload.id];
			continue;
		}
		if (entry.action === "upsert" && payload.record) {
			draft.artifacts[payload.record.id] = payload.record;
		}
	}
	return draft;
}

function compact(text: string, maxChars = 180): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxChars) {
		return normalized;
	}
	return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

export class ResearchArtifactStore {
	readonly path: string;
	private readonly journal: ResearchJournalStore;

	constructor(workspaceRoot: string, journal: ResearchJournalStore, relativePath = ".pire/research-artifacts.json") {
		this.path = resolve(workspaceRoot, relativePath);
		this.journal = journal;
	}

	read(scope?: ResearchOverlayScope): ResearchArtifactData {
		const draft = readBaseArtifacts(this.path);
		if (!scope) {
			return draft;
		}
		return applyJournalEntries(draft, this.journal.readForLineage(scope, "research_artifact"));
	}

	async upsert(
		input: ResearchArtifactUpsertInput,
		context: ResearchOverlayScope,
		storageScope: ResearchJournalScope = "session",
	): Promise<ResearchArtifactData> {
		if (!input.id.trim()) {
			throw new Error('"id" is required.');
		}

		const existing = this.read(context).artifacts[input.id.trim()];
		const record: ResearchArtifactRecord = {
			id: input.id.trim(),
			kind: input.kind ?? existing?.kind ?? defaultArtifactKind(input.id.trim()),
			title: input.title?.trim() ?? existing?.title ?? input.id.trim(),
			summary: input.summary?.trim() ?? existing?.summary ?? "",
			content: input.content?.trim() ?? existing?.content,
			surfaces: mergeUnique(existing?.surfaces ?? [], input.surfaces),
			findingIds: mergeUnique(existing?.findingIds ?? [], input.findingIds),
			logicRuleIds: mergeUnique(existing?.logicRuleIds ?? [], input.logicRuleIds),
			commands: mergeUnique(existing?.commands ?? [], input.commands),
			artifactPaths: mergeUnique(existing?.artifactPaths ?? [], input.artifactPaths),
			tags: mergeUnique(existing?.tags ?? [], input.tags),
			status: input.status ?? existing?.status ?? "active",
			storageScope,
			sessionId: storageScope === "session" ? context.sessionId : undefined,
			updatedAt: new Date().toISOString(),
		};

		if (storageScope === "workspace") {
			await withMutationQueue(this.path, async () => {
				const draft = readBaseArtifacts(this.path);
				draft.artifacts[record.id] = record;
				mkdirSync(dirname(this.path), { recursive: true });
				await writeFile(this.path, `${JSON.stringify(draft, null, 2)}\n`, "utf-8");
			});
		}

		await this.journal.append({
			sessionId: context.sessionId,
			sessionLineageIds: context.sessionLineageIds,
			scope: storageScope,
			domain: "research_artifact",
			action: "upsert",
			entityId: record.id,
			summary: `${record.kind}: ${record.title}`,
			payload: { record },
		});

		return this.read(context);
	}

	async delete(
		id: string,
		context: ResearchOverlayScope,
		storageScope: ResearchJournalScope = "session",
	): Promise<ResearchArtifactData> {
		const trimmedId = id.trim();
		if (!trimmedId) {
			throw new Error('"id" is required.');
		}

		if (storageScope === "workspace") {
			await withMutationQueue(this.path, async () => {
				const draft = readBaseArtifacts(this.path);
				delete draft.artifacts[trimmedId];
				mkdirSync(dirname(this.path), { recursive: true });
				await writeFile(this.path, `${JSON.stringify(draft, null, 2)}\n`, "utf-8");
			});
		}

		await this.journal.append({
			sessionId: context.sessionId,
			sessionLineageIds: context.sessionLineageIds,
			scope: storageScope,
			domain: "research_artifact",
			action: "delete",
			entityId: trimmedId,
			summary: `delete ${trimmedId}`,
			payload: { id: trimmedId },
		});
		return this.read(context);
	}

	formatForPrompt(records: readonly ResearchArtifactRecord[]): string {
		if (records.length === 0) {
			return "[Research Artifacts]\n(empty)";
		}
		const lines = ["[Research Artifacts]"];
		for (const record of records) {
			lines.push(`- ${record.id} [${record.kind}] status=${record.status}`);
			lines.push(`  title: ${compact(record.title, 140)}`);
			lines.push(`  summary: ${compact(record.summary || record.content || "", 220)}`);
			if (record.surfaces.length > 0) {
				lines.push(`  surfaces: ${compact(record.surfaces.join(", "), 160)}`);
			}
			if (record.findingIds.length > 0) {
				lines.push(`  findings: ${compact(record.findingIds.join(", "), 160)}`);
			}
			if (record.commands.length > 0) {
				lines.push(`  commands: ${compact(record.commands.join(" | "), 180)}`);
			}
			if (record.artifactPaths.length > 0) {
				lines.push(`  artifacts: ${compact(record.artifactPaths.join(", "), 180)}`);
			}
		}
		return lines.join("\n");
	}
}
