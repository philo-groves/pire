/**
 * CyberGym benchmark types
 *
 * Based on the CyberGym dataset (sunblaze-ucb/cybergym).
 * Tasks are C/C++ vulnerability analysis challenges where agents
 * must craft a PoC input that triggers a sanitizer crash.
 */

/** Raw task entry from tasks.json on HuggingFace */
export interface RawCyberGymTask {
	task_id: string; // e.g., "arvo:1065", "oss-fuzz:42534949"
	project_name: string;
	project_homepage: string;
	project_main_repo: string;
	project_language: string;
	vulnerability_description: string;
	task_difficulty: {
		level0: string[];
		level1: string[];
		level2: string[];
		level3: string[];
	};
}

export type TaskType = "arvo" | "oss-fuzz" | "oss-fuzz-latest";
export type DifficultyLevel = "level0" | "level1" | "level2" | "level3";

/** Parsed task ready for evaluation */
export interface CyberGymTask {
	taskId: string;
	taskType: TaskType;
	numericId: number;
	projectName: string;
	projectLanguage: string;
	vulnerabilityDescription: string;
	/** HF data file paths per difficulty level */
	filePaths: Record<DifficultyLevel, string[]>;
}

/** Docker image pair for a task */
export interface TaskImages {
	vul: string; // e.g., "n132/arvo:1065-vul"
	fix: string; // e.g., "n132/arvo:1065-fix"
}

/** Prepared workspace for agent execution */
export interface TaskWorkspace {
	dir: string;
	sourceDir: string;
	pocPath: string;
	description?: string;
	errorTrace?: string;
	patchPath?: string;
	buildScripts: string[];
	buildTargets: string[];
	entrypointHints: string[];
}

/** Result of PoC validation against vul/fix containers */
export interface ValidationResult {
	vulExitCode: number;
	vulCrashed: boolean;
	fixExitCode: number;
	fixSurvived: boolean;
	passed: boolean;
	vulOutput: string;
	fixOutput: string;
}

/** Trajectory metrics — how the agent worked, not just whether it succeeded */
export interface TrajectoryMetrics {
	/** Total agent output length in characters */
	outputLength: number;
	/** Number of notebook entries at end of run */
	notebookEntries: number;
	/** Number of tracked surfaces at end of run */
	surfaceMapEntries: number;
	/** Whether agent created a plan */
	hadPlan: boolean;
	/** Whether agent used the surface map tool */
	hadSurfaceMap: boolean;
	/** Time spent on Docker pull + data fetch (not agent time) */
	setupSeconds: number;
	/** Agent-only wall clock time */
	agentSeconds: number;
}

export interface AggregatePassStats {
	total: number;
	passed: number;
	rate: number;
}

export interface RepoSnapshot {
	commitHash: string;
	dirty: boolean;
}

/** Per-task eval result */
export interface CyberGymResult {
	taskId: string;
	taskType: string;
	projectName: string;
	difficulty: DifficultyLevel;
	passed: boolean;
	vulCrashed: boolean;
	fixSurvived: boolean;
	pocFound: boolean;
	timeSeconds: number;
	timedOut: boolean;
	error: string | undefined;
	trajectory?: TrajectoryMetrics;
}

export interface CyberGymReport {
	timestamp: string;
	difficulty: DifficultyLevel;
	shuffled: boolean;
	shuffleSeed?: number;
	total: number;
	passed: number;
	failed: number;
	passRate: number;
	byTaskType: Record<string, AggregatePassStats>;
	byProject: Record<string, AggregatePassStats>;
	results: CyberGymResult[];
	repo?: RepoSnapshot;
}
