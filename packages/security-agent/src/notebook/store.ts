import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface NotebookData {
	[key: string]: string;
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

export class NotebookStore {
	readonly path: string;

	constructor(cwd: string, relativePath = ".pire/notebook.json") {
		this.path = resolve(cwd, relativePath);
	}

	read(): NotebookData {
		if (!existsSync(this.path)) {
			return {};
		}

		try {
			return JSON.parse(readFileSync(this.path, "utf-8")) as NotebookData;
		} catch {
			return {};
		}
	}

	async set(key: string, value: string): Promise<NotebookData> {
		return this.update((draft) => {
			draft[key] = value;
		});
	}

	async append(key: string, value: string): Promise<NotebookData> {
		return this.update((draft) => {
			const existing = draft[key] ?? "";
			draft[key] = existing ? `${existing}\n${value}` : value;
		});
	}

	async delete(key: string): Promise<NotebookData> {
		return this.update((draft) => {
			delete draft[key];
		});
	}

	async update(mutator: (draft: NotebookData) => void): Promise<NotebookData> {
		return withMutationQueue(this.path, async () => {
			const draft = this.read();
			mutator(draft);
			mkdirSync(dirname(this.path), { recursive: true });
			await writeFile(this.path, `${JSON.stringify(draft, null, 2)}\n`, "utf-8");
			return draft;
		});
	}

	formatForPrompt(): string {
		const notebook = this.read();
		const keys = Object.keys(notebook);
		if (keys.length === 0) {
			return "[Research Notebook]\n(empty)";
		}

		const lines = ["[Research Notebook]"];
		for (const key of keys) {
			const value = notebook[key];
			if (value.includes("\n")) {
				lines.push(`${key}:\n${value}`);
			} else {
				lines.push(`${key}: ${value}`);
			}
		}

		return lines.join("\n");
	}
}
