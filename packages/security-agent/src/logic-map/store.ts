import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type LogicStatus = "candidate" | "aligned" | "violated" | "confirmed" | "rejected";

export interface LogicRecord {
	id: string;
	label: string;
	intended: string;
	implemented: string;
	gap: string;
	surfaces: string[];
	evidence: string[];
	status: LogicStatus;
	updatedAt: string;
}

export interface LogicMapData {
	rules: Record<string, LogicRecord>;
}

export interface LogicUpsertInput {
	id: string;
	label?: string;
	intended?: string;
	implemented?: string;
	gap?: string;
	surfaces?: string[];
	evidence?: string[];
	status?: LogicStatus;
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

export class LogicMapStore {
	readonly path: string;

	constructor(cwd: string, relativePath = ".pire/logic-map.json") {
		this.path = resolve(cwd, relativePath);
	}

	read(): LogicMapData {
		if (!existsSync(this.path)) {
			return { rules: {} };
		}

		try {
			const parsed = JSON.parse(readFileSync(this.path, "utf-8")) as Partial<LogicMapData>;
			return { rules: parsed.rules ?? {} };
		} catch {
			return { rules: {} };
		}
	}

	async upsert(input: LogicUpsertInput): Promise<LogicMapData> {
		return withMutationQueue(this.path, async () => {
			const draft = this.read();
			const existing = draft.rules[input.id];
			if (
				!existing &&
				(!input.label?.trim() || !input.intended?.trim() || !input.implemented?.trim() || !input.gap?.trim())
			) {
				throw new Error('New logic rules require "label", "intended", "implemented", and "gap".');
			}

			draft.rules[input.id] = {
				id: input.id,
				label: input.label?.trim() ?? existing?.label ?? input.id,
				intended: input.intended?.trim() ?? existing?.intended ?? "",
				implemented: input.implemented?.trim() ?? existing?.implemented ?? "",
				gap: input.gap?.trim() ?? existing?.gap ?? "",
				surfaces: mergeUnique(existing?.surfaces ?? [], input.surfaces),
				evidence: mergeUnique(existing?.evidence ?? [], input.evidence),
				status: input.status ?? existing?.status ?? "candidate",
				updatedAt: new Date().toISOString(),
			};

			mkdirSync(dirname(this.path), { recursive: true });
			await writeFile(this.path, `${JSON.stringify(draft, null, 2)}\n`, "utf-8");
			return draft;
		});
	}

	formatForPrompt(maxRules = 8): string {
		const data = this.read();
		const rules = Object.values(data.rules);
		if (rules.length === 0) {
			return "[Logic Map]\n(empty)";
		}

		const ranked = rules.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
		const lines = [`[Logic Map]`, `Tracked rules: ${rules.length}`];
		for (const rule of ranked.slice(0, maxRules)) {
			lines.push(`- ${rule.id} status=${rule.status} label=${rule.label}`);
			lines.push(`  intended: ${rule.intended}`);
			lines.push(`  implemented: ${rule.implemented}`);
			lines.push(`  gap: ${rule.gap}`);
			if (rule.surfaces.length > 0) {
				lines.push(`  surfaces: ${rule.surfaces.join(", ")}`);
			}
			if (rule.evidence.length > 0) {
				lines.push(`  evidence: ${rule.evidence.join(" | ")}`);
			}
		}

		if (rules.length > maxRules) {
			lines.push(`... ${rules.length - maxRules} more logic rules on disk`);
		}

		return lines.join("\n");
	}
}
