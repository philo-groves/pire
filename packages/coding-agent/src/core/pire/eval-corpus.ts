import type { PireEvalTask, PireExploitability } from "./evals.js";

export const PIRE_BINARY_BUG_CLASSES = [
	"uaf",
	"oob-read",
	"oob-write",
	"heap-overflow",
	"double-free",
	"toctou",
] as const;

export const PIRE_BINARY_EVAL_FOCI = [
	"surface-mapping",
	"disassembly",
	"decompilation",
	"crash-triage",
	"exploitability",
	"primitive-extraction",
] as const;

export type PireBinaryBugClass = (typeof PIRE_BINARY_BUG_CLASSES)[number];
export type PireBinaryEvalFocus = (typeof PIRE_BINARY_EVAL_FOCI)[number];

export interface PireBinaryEvalTask extends PireEvalTask {
	lane: "reverse-engineering";
	bugClass: PireBinaryBugClass;
	focus: PireBinaryEvalFocus;
	sourceAvailable: boolean;
	stripped: boolean;
	expectedCommands: string[];
	expectedArtifacts: string[];
	mitigations: string[];
}

export interface PireBinaryEvalCorpusSummary {
	totalTasks: number;
	byBugClass: Record<PireBinaryBugClass, number>;
	byFocus: Record<PireBinaryEvalFocus, number>;
	sourceAvailableTasks: number;
	strippedTasks: number;
	exploitabilityTargets: Record<PireExploitability, number>;
}

function createBinaryTask(task: Omit<PireBinaryEvalTask, "lane">): PireBinaryEvalTask {
	return {
		...task,
		lane: "reverse-engineering",
	};
}

export function createStarterBinaryReEvalCorpus(): PireBinaryEvalTask[] {
	return [
		createBinaryTask({
			id: "binre-surface-001",
			title: "Map the stripped parser surface and locate the suspected OOB read",
			objective:
				"Recover likely entry points, identify the attacker-controlled parsing path, and decide whether the out-of-bounds read is real or a false lead.",
			bugClass: "oob-read",
			focus: "surface-mapping",
			sourceAvailable: false,
			stripped: true,
			expectedCommands: ["file", "readelf", "strings", "objdump", "nm"],
			expectedArtifacts: ["function inventory", "section map", "notes on parser entry points"],
			mitigations: ["aslr", "nx"],
			expected: {
				findingOutcome: "candidate",
				exploitability: "limited",
				requiresProof: false,
			},
			notes: ["Emphasize shell-first recovery of symbols and parser surface."],
		}),
		createBinaryTask({
			id: "binre-disasm-001",
			title: "Use disassembly to recover the heap-overflow copy path",
			objective:
				"Identify the vulnerable copy loop from disassembly, characterize attacker control, and explain the resulting heap-overflow primitive precisely.",
			bugClass: "heap-overflow",
			focus: "disassembly",
			sourceAvailable: false,
			stripped: true,
			expectedCommands: ["objdump", "readelf", "gdb"],
			expectedArtifacts: ["disassembly notes", "offset-accurate copy-loop analysis"],
			mitigations: ["aslr", "nx", "relro"],
			expected: {
				findingOutcome: "confirmed",
				exploitability: "limited",
				requiresProof: true,
			},
		}),
		createBinaryTask({
			id: "binre-decomp-001",
			title: "Decompile the ownership bug and confirm the UAF path",
			objective:
				"Recover object lifetime semantics, show the stale-pointer path, and determine whether the UAF reaches a controlled dereference.",
			bugClass: "uaf",
			focus: "decompilation",
			sourceAvailable: false,
			stripped: false,
			expectedCommands: ["strings", "gdb", "lldb"],
			expectedArtifacts: ["lifetime notes", "call graph sketch", "candidate stale-pointer path"],
			mitigations: ["aslr", "safe-linking"],
			expected: {
				findingOutcome: "confirmed",
				exploitability: "limited",
				requiresProof: true,
			},
		}),
		createBinaryTask({
			id: "binre-crash-001",
			title: "Triage the crash and separate OOB write from harmless corruption noise",
			objective:
				"Reproduce the crash, attribute it to the correct write primitive, and rule out nearby but non-causal memory corruption symptoms.",
			bugClass: "oob-write",
			focus: "crash-triage",
			sourceAvailable: true,
			stripped: false,
			expectedCommands: ["bash", "gdb", "strace"],
			expectedArtifacts: ["repro command", "crash log", "root-cause notes"],
			mitigations: ["asan", "ubsan"],
			expected: {
				findingOutcome: "confirmed",
				exploitability: "limited",
				requiresProof: true,
			},
		}),
		createBinaryTask({
			id: "binre-heap-001",
			title: "Assess exploitability of a double-free under modern allocator hardening",
			objective:
				"Determine whether the double-free is only a crash or whether it can still produce a useful allocator primitive under the shipped mitigations.",
			bugClass: "double-free",
			focus: "exploitability",
			sourceAvailable: true,
			stripped: false,
			expectedCommands: ["bash", "gdb", "readelf"],
			expectedArtifacts: ["allocator notes", "mitigation assessment", "primitive decision"],
			mitigations: ["aslr", "nx", "safe-linking"],
			expected: {
				findingOutcome: "confirmed",
				exploitability: "none",
				requiresProof: false,
			},
			notes: ["This is an intentional decoy for false-positive exploitability claims."],
		}),
		createBinaryTask({
			id: "binre-primitive-001",
			title: "Turn the heap overflow into a concrete primitive assessment",
			objective:
				"Measure overwrite reach, target selection, and whether the overflow yields a meaningful read/write or control primitive.",
			bugClass: "heap-overflow",
			focus: "primitive-extraction",
			sourceAvailable: true,
			stripped: false,
			expectedCommands: ["bash", "gdb", "objdump"],
			expectedArtifacts: ["overwrite map", "target object notes", "primitive assessment"],
			mitigations: ["aslr", "nx", "relro"],
			expected: {
				findingOutcome: "confirmed",
				exploitability: "rce",
				requiresProof: true,
			},
		}),
		createBinaryTask({
			id: "binre-toctou-001",
			title: "Confirm the filesystem TOCTOU window in a privileged helper",
			objective:
				"Show the check/use split clearly, bound the race window, and explain whether the condition is realistically exploitable in the lab setup.",
			bugClass: "toctou",
			focus: "exploitability",
			sourceAvailable: true,
			stripped: false,
			expectedCommands: ["bash", "strace", "ltrace"],
			expectedArtifacts: ["race timeline", "filesystem notes", "exploitability decision"],
			mitigations: ["fs permissions", "sandboxing"],
			expected: {
				findingOutcome: "candidate",
				exploitability: "limited",
				requiresProof: true,
			},
		}),
	];
}

function createEmptyCountRecord<T extends string>(values: readonly T[]): Record<T, number> {
	return Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;
}

export function summarizeBinaryReEvalCorpus(tasks: PireBinaryEvalTask[]): PireBinaryEvalCorpusSummary {
	const byBugClass = createEmptyCountRecord(PIRE_BINARY_BUG_CLASSES);
	const byFocus = createEmptyCountRecord(PIRE_BINARY_EVAL_FOCI);
	const exploitabilityTargets: Record<PireExploitability, number> = {
		unknown: 0,
		none: 0,
		dos: 0,
		limited: 0,
		rce: 0,
		chain: 0,
	};

	let sourceAvailableTasks = 0;
	let strippedTasks = 0;

	for (const task of tasks) {
		byBugClass[task.bugClass] += 1;
		byFocus[task.focus] += 1;
		if (task.sourceAvailable) {
			sourceAvailableTasks += 1;
		}
		if (task.stripped) {
			strippedTasks += 1;
		}
		if (task.expected?.exploitability) {
			exploitabilityTargets[task.expected.exploitability] += 1;
		}
	}

	return {
		totalTasks: tasks.length,
		byBugClass,
		byFocus,
		sourceAvailableTasks,
		strippedTasks,
		exploitabilityTargets,
	};
}

export function validateBinaryReEvalCorpus(tasks: PireBinaryEvalTask[]): string[] {
	const issues: string[] = [];
	const summary = summarizeBinaryReEvalCorpus(tasks);

	if (tasks.length === 0) {
		issues.push("binary RE eval corpus is empty");
		return issues;
	}

	if (summary.strippedTasks === 0) {
		issues.push("binary RE eval corpus should include at least one stripped-binary task");
	}

	if (summary.byFocus.disassembly === 0) {
		issues.push("binary RE eval corpus should include at least one disassembly-focused task");
	}

	if (summary.byFocus.decompilation === 0) {
		issues.push("binary RE eval corpus should include at least one decompilation-focused task");
	}

	if (summary.byBugClass.uaf === 0) {
		issues.push("binary RE eval corpus should include at least one UAF task");
	}

	if (summary.byBugClass["heap-overflow"] === 0) {
		issues.push("binary RE eval corpus should include at least one heap-overflow task");
	}

	if (summary.byBugClass.toctou === 0) {
		issues.push("binary RE eval corpus should include at least one TOCTOU task");
	}

	if (summary.exploitabilityTargets.none === 0) {
		issues.push("binary RE eval corpus should include at least one non-exploitable or decoy task");
	}

	for (const task of tasks) {
		if (task.expectedCommands.length === 0) {
			issues.push(`${task.id} should declare expected shell commands`);
		}
		if (task.expectedArtifacts.length === 0) {
			issues.push(`${task.id} should declare expected artifacts`);
		}
	}

	return issues;
}
