import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ResearchJournalScope, ResearchJournalStore, ResearchOverlayScope } from "../research-journal/store.js";

export type FindingDossierStatus = "candidate" | "validated" | "ready_for_report" | "reported" | "rejected" | "blocked";

export interface FindingDossierControl {
	label: string;
	result: string;
	details?: string;
}

export interface FindingDossierRecord {
	id: string;
	findingId?: string;
	title: string;
	claim: string;
	target?: string;
	targetScope?: string;
	impact?: string;
	trigger?: string;
	surfaces: string[];
	logicRuleIds: string[];
	controls: FindingDossierControl[];
	evidence: string[];
	reproCommands: string[];
	artifactPaths: string[];
	blockers: string[];
	reportNotes?: string;
	tags: string[];
	status: FindingDossierStatus;
	storageScope: ResearchJournalScope;
	sessionId?: string;
	updatedAt: string;
}

export interface FindingDossierData {
	dossiers: Record<string, FindingDossierRecord>;
}

export interface FindingDossierUpsertInput {
	id: string;
	findingId?: string;
	title?: string;
	claim?: string;
	target?: string;
	targetScope?: string;
	impact?: string;
	trigger?: string;
	surfaces?: string[];
	logicRuleIds?: string[];
	controls?: FindingDossierControl[];
	evidence?: string[];
	reproCommands?: string[];
	artifactPaths?: string[];
	blockers?: string[];
	reportNotes?: string;
	tags?: string[];
	status?: FindingDossierStatus;
}

interface FindingDossierJournalPayload {
	record?: FindingDossierRecord;
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

function uniqueControls(values: FindingDossierControl[] | undefined): FindingDossierControl[] {
	if (!values || values.length === 0) {
		return [];
	}
	const seen = new Set<string>();
	const items: FindingDossierControl[] = [];
	for (const value of values) {
		const label = value.label.trim();
		const result = value.result.trim();
		const details = value.details?.trim();
		if (!label || !result) {
			continue;
		}
		const key = `${label.toLowerCase()}\u0000${result.toLowerCase()}\u0000${details?.toLowerCase() ?? ""}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		items.push({ label, result, details: details || undefined });
	}
	return items;
}

function mergeControls(
	existing: FindingDossierControl[],
	extra: FindingDossierControl[] | undefined,
): FindingDossierControl[] {
	return uniqueControls([...(existing ?? []), ...(extra ?? [])]);
}

function readBaseDossiers(path: string): FindingDossierData {
	if (!existsSync(path)) {
		return { dossiers: {} };
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<FindingDossierData>;
		return { dossiers: parsed.dossiers ?? {} };
	} catch {
		return { dossiers: {} };
	}
}

function applyJournalEntries(
	draft: FindingDossierData,
	entries: ReturnType<ResearchJournalStore["readForLineage"]>,
): FindingDossierData {
	for (const entry of entries) {
		if (entry.domain !== "finding_dossier" || entry.scope !== "session") {
			continue;
		}
		const payload = entry.payload as FindingDossierJournalPayload;
		if (entry.action === "delete" && payload.id) {
			delete draft.dossiers[payload.id];
			continue;
		}
		if (entry.action === "upsert" && payload.record) {
			draft.dossiers[payload.record.id] = payload.record;
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

export class FindingDossierStore {
	readonly path: string;
	private readonly journal: ResearchJournalStore;

	constructor(workspaceRoot: string, journal: ResearchJournalStore, relativePath = ".pire/finding-dossiers.json") {
		this.path = resolve(workspaceRoot, relativePath);
		this.journal = journal;
	}

	read(scope?: ResearchOverlayScope): FindingDossierData {
		const draft = readBaseDossiers(this.path);
		if (!scope) {
			return draft;
		}
		return applyJournalEntries(draft, this.journal.readForLineage(scope, "finding_dossier"));
	}

	async upsert(
		input: FindingDossierUpsertInput,
		context: ResearchOverlayScope,
		storageScope: ResearchJournalScope = "session",
	): Promise<FindingDossierData> {
		if (!input.id.trim()) {
			throw new Error('"id" is required.');
		}

		const existing = this.read(context).dossiers[input.id.trim()];
		const record: FindingDossierRecord = {
			id: input.id.trim(),
			findingId: input.findingId?.trim() ?? existing?.findingId,
			title: input.title?.trim() ?? existing?.title ?? input.id.trim(),
			claim: input.claim?.trim() ?? existing?.claim ?? "",
			target: input.target?.trim() ?? existing?.target,
			targetScope: input.targetScope?.trim() ?? existing?.targetScope,
			impact: input.impact?.trim() ?? existing?.impact,
			trigger: input.trigger?.trim() ?? existing?.trigger,
			surfaces: mergeUnique(existing?.surfaces ?? [], input.surfaces),
			logicRuleIds: mergeUnique(existing?.logicRuleIds ?? [], input.logicRuleIds),
			controls: mergeControls(existing?.controls ?? [], input.controls),
			evidence: mergeUnique(existing?.evidence ?? [], input.evidence),
			reproCommands: mergeUnique(existing?.reproCommands ?? [], input.reproCommands),
			artifactPaths: mergeUnique(existing?.artifactPaths ?? [], input.artifactPaths),
			blockers: mergeUnique(existing?.blockers ?? [], input.blockers),
			reportNotes: input.reportNotes?.trim() ?? existing?.reportNotes,
			tags: mergeUnique(existing?.tags ?? [], input.tags),
			status: input.status ?? existing?.status ?? "candidate",
			storageScope,
			sessionId: storageScope === "session" ? context.sessionId : undefined,
			updatedAt: new Date().toISOString(),
		};

		if (storageScope === "workspace") {
			await withMutationQueue(this.path, async () => {
				const draft = readBaseDossiers(this.path);
				draft.dossiers[record.id] = record;
				mkdirSync(dirname(this.path), { recursive: true });
				await writeFile(this.path, `${JSON.stringify(draft, null, 2)}\n`, "utf-8");
			});
		}

		await this.journal.append({
			sessionId: context.sessionId,
			sessionLineageIds: context.sessionLineageIds,
			scope: storageScope,
			domain: "finding_dossier",
			action: "upsert",
			entityId: record.id,
			summary: `${record.status}: ${record.title}`,
			payload: { record },
		});
		return this.read(context);
	}

	async delete(
		id: string,
		context: ResearchOverlayScope,
		storageScope: ResearchJournalScope = "session",
	): Promise<FindingDossierData> {
		const trimmedId = id.trim();
		if (!trimmedId) {
			throw new Error('"id" is required.');
		}

		if (storageScope === "workspace") {
			await withMutationQueue(this.path, async () => {
				const draft = readBaseDossiers(this.path);
				delete draft.dossiers[trimmedId];
				mkdirSync(dirname(this.path), { recursive: true });
				await writeFile(this.path, `${JSON.stringify(draft, null, 2)}\n`, "utf-8");
			});
		}

		await this.journal.append({
			sessionId: context.sessionId,
			sessionLineageIds: context.sessionLineageIds,
			scope: storageScope,
			domain: "finding_dossier",
			action: "delete",
			entityId: trimmedId,
			summary: `delete ${trimmedId}`,
			payload: { id: trimmedId },
		});
		return this.read(context);
	}

	formatForPrompt(records: readonly FindingDossierRecord[]): string {
		if (records.length === 0) {
			return "[Finding Dossiers]\n(empty)";
		}

		const lines = ["[Finding Dossiers]"];
		for (const record of records) {
			lines.push(`- ${record.id} status=${record.status}`);
			lines.push(`  title: ${compact(record.title, 140)}`);
			lines.push(`  claim: ${compact(record.claim, 200)}`);
			if (record.target) {
				lines.push(`  target: ${compact(record.target, 140)}`);
			}
			if (record.impact) {
				lines.push(`  impact: ${compact(record.impact, 160)}`);
			}
			if (record.trigger) {
				lines.push(`  trigger: ${compact(record.trigger, 180)}`);
			}
			if (record.controls.length > 0) {
				lines.push(
					`  controls: ${compact(record.controls.map((control) => `${control.label}=${control.result}`).join(" | "), 180)}`,
				);
			}
			if (record.reproCommands.length > 0) {
				lines.push(`  repro: ${compact(record.reproCommands.join(" | "), 180)}`);
			}
			if (record.blockers.length > 0) {
				lines.push(`  blockers: ${compact(record.blockers.join(" | "), 180)}`);
			}
		}
		return lines.join("\n");
	}
}
