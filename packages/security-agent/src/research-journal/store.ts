import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type ResearchJournalDomain =
	| "notebook"
	| "surface_map"
	| "logic_map"
	| "workspace_graph"
	| "research_artifact"
	| "finding_dossier";

export type ResearchJournalScope = "workspace" | "session";

export interface ResearchJournalEntry {
	id: string;
	timestamp: string;
	sessionId: string;
	sessionLineageIds: string[];
	scope: ResearchJournalScope;
	domain: ResearchJournalDomain;
	action: string;
	entityId?: string;
	summary?: string;
	payload: Record<string, unknown>;
}

export interface ResearchJournalAppendInput {
	sessionId: string;
	sessionLineageIds: string[];
	scope: ResearchJournalScope;
	domain: ResearchJournalDomain;
	action: string;
	entityId?: string;
	summary?: string;
	payload?: Record<string, unknown>;
}

export interface ResearchOverlayScope {
	sessionId: string;
	sessionLineageIds: string[];
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

function createJournalEntry(input: ResearchJournalAppendInput): ResearchJournalEntry {
	return {
		id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
		timestamp: new Date().toISOString(),
		sessionId: input.sessionId,
		sessionLineageIds: [...input.sessionLineageIds],
		scope: input.scope,
		domain: input.domain,
		action: input.action,
		entityId: input.entityId?.trim() || undefined,
		summary: input.summary?.trim() || undefined,
		payload: input.payload ?? {},
	};
}

export class ResearchJournalStore {
	readonly path: string;

	constructor(workspaceRoot: string, relativePath = ".pire/research-journal.jsonl") {
		this.path = resolve(workspaceRoot, relativePath);
	}

	read(): ResearchJournalEntry[] {
		if (!existsSync(this.path)) {
			return [];
		}

		const content = readFileSync(this.path, "utf-8");
		if (!content.trim()) {
			return [];
		}

		const entries: ResearchJournalEntry[] = [];
		for (const line of content.split("\n")) {
			if (!line.trim()) {
				continue;
			}
			try {
				entries.push(JSON.parse(line) as ResearchJournalEntry);
			} catch {
				// Ignore malformed lines while preserving valid journal entries.
			}
		}
		return entries;
	}

	readForLineage(scope: ResearchOverlayScope, domain?: ResearchJournalDomain): ResearchJournalEntry[] {
		const lineage = new Set(scope.sessionLineageIds);
		return this.read().filter((entry) => {
			if (domain && entry.domain !== domain) {
				return false;
			}
			return lineage.has(entry.sessionId);
		});
	}

	async append(input: ResearchJournalAppendInput): Promise<ResearchJournalEntry> {
		const entry = createJournalEntry(input);
		await withMutationQueue(this.path, async () => {
			mkdirSync(dirname(this.path), { recursive: true });
			if (!existsSync(this.path)) {
				await writeFile(this.path, `${JSON.stringify(entry)}\n`, "utf-8");
				return;
			}
			await appendFile(this.path, `${JSON.stringify(entry)}\n`, "utf-8");
		});
		return entry;
	}
}
