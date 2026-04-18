/**
 * CyberGym task index
 *
 * Fetches tasks.json from HuggingFace, parses it, and provides
 * filtering/selection for evaluation runs.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RawCyberGymTask, CyberGymTask, TaskType, DifficultyLevel } from "./types.js";

const HF_TASKS_URL =
	"https://huggingface.co/datasets/sunblaze-ucb/cybergym/resolve/main/tasks.json";

function parseTaskId(taskId: string): { type: TaskType; numericId: number } {
	const [typeStr, idStr] = taskId.split(":");
	return {
		type: typeStr as TaskType,
		numericId: parseInt(idStr, 10),
	};
}

function parseRawTask(raw: RawCyberGymTask): CyberGymTask {
	const { type, numericId } = parseTaskId(raw.task_id);
	return {
		taskId: raw.task_id,
		taskType: type,
		numericId,
		projectName: raw.project_name,
		projectLanguage: raw.project_language,
		vulnerabilityDescription: raw.vulnerability_description,
		filePaths: {
			level0: raw.task_difficulty.level0,
			level1: raw.task_difficulty.level1,
			level2: raw.task_difficulty.level2,
			level3: raw.task_difficulty.level3,
		},
	};
}

/**
 * Fetch tasks.json from HuggingFace, caching locally.
 * Returns parsed task array.
 */
export async function loadTasks(cacheDir: string): Promise<CyberGymTask[]> {
	const cachePath = join(cacheDir, "tasks.json");

	if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

	let rawTasks: RawCyberGymTask[];

	if (existsSync(cachePath)) {
		rawTasks = JSON.parse(readFileSync(cachePath, "utf-8")) as RawCyberGymTask[];
	} else {
		process.stderr.write("Fetching tasks.json from HuggingFace...\n");
		const response = await fetch(HF_TASKS_URL);
		if (!response.ok) {
			throw new Error(`Failed to fetch tasks.json: ${response.status} ${response.statusText}`);
		}
		const text = await response.text();
		writeFileSync(cachePath, text, "utf-8");
		rawTasks = JSON.parse(text) as RawCyberGymTask[];
		process.stderr.write(`Cached ${rawTasks.length} tasks to ${cachePath}\n`);
	}

	return rawTasks.map(parseRawTask);
}

export interface TaskFilter {
	taskType?: TaskType;
	difficulty?: DifficultyLevel;
	project?: string;
	taskIds?: string[];
	limit?: number;
	shuffle?: boolean;
	seed?: number;
	/** Skip tasks with IDs in this set (for resuming) */
	skip?: Set<string>;
}

function normalizeSeed(seed: number): number {
	return (seed >>> 0) || 0x6d2b79f5;
}

function createPrng(seed: number): () => number {
	let state = normalizeSeed(seed);
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = Math.imul(state ^ (state >>> 15), 1 | state);
		value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffleTasks(tasks: CyberGymTask[], seed: number): CyberGymTask[] {
	const shuffled = [...tasks];
	const random = createPrng(seed);

	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}

	return shuffled;
}

export function filterTasks(tasks: CyberGymTask[], filter: TaskFilter): CyberGymTask[] {
	let result = tasks;

	if (filter.taskType) {
		result = result.filter((t) => t.taskType === filter.taskType);
	}
	if (filter.project) {
		const proj = filter.project.toLowerCase();
		result = result.filter((t) => t.projectName.toLowerCase() === proj);
	}
	if (filter.taskIds) {
		const idSet = new Set(filter.taskIds);
		result = result.filter((t) => idSet.has(t.taskId));
	}
	if (filter.skip) {
		result = result.filter((t) => !filter.skip!.has(t.taskId));
	}
	if (filter.shuffle && !filter.taskIds?.length) {
		result = shuffleTasks(result, filter.seed ?? Date.now());
	}
	if (filter.limit !== undefined && filter.limit > 0) {
		result = result.slice(0, filter.limit);
	}

	return result;
}
