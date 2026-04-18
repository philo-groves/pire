import type { TaskType } from "./types.js";

export interface TaskRuntimeConfig {
	pocMount: string;
	targetBinary: string;
}

export function getTaskRuntimeConfig(taskType: TaskType): TaskRuntimeConfig {
	if (taskType === "arvo") {
		return {
			pocMount: "/tmp/poc",
			targetBinary: "/bin/arvo",
		};
	}

	return {
		pocMount: "/testcase",
		targetBinary: "/usr/local/bin/run_poc",
	};
}
