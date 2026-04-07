import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type PireEvalRunBundle,
	type PireEvalRunScore,
	type PireEvalTaskSuite,
	parsePireEvalRunBundle,
	parsePireEvalTaskSuite,
	scorePireEvalRunBundle,
	stringifyPireEvalRunBundle,
	summarizePireEvalRunScore,
} from "./eval-bundles.js";
import type { PireEvalEvidenceRef, PireEvalJudgement, PireExploitability } from "./evals.js";

interface PireSessionFindingRecord {
	id: string;
	title: string;
	status: "candidate" | "confirmed" | "reported";
	statement: string;
	reproStatus: "not-reproduced" | "partial" | "reproduced";
	relatedEvidenceIds: string[];
	relatedArtifactIds: string[];
}

interface PireSessionEvidenceRecord {
	id: string;
	summary: string;
	commandId?: string;
	artifactIds: string[];
}

interface PireSessionTrackerSnapshot {
	findings: PireSessionFindingRecord[];
	evidence: PireSessionEvidenceRecord[];
}

interface PireSessionArtifactRecord {
	path: string;
	type: string;
}

interface PireSessionArtifactManifestSnapshot {
	artifacts: PireSessionArtifactRecord[];
}

export interface PireEvalSessionTaskBinding {
	taskId: string;
	findingId?: string;
	findingTitle?: string;
	findingTitleIncludes?: string;
	exploitability?: PireExploitability;
	judgement?: Partial<PireEvalJudgement>;
	notes?: string[];
}

export interface CreatePireEvalRunBundleFromSessionOptions {
	cwd: string;
	suite: PireEvalTaskSuite;
	runId: string;
	bindings: PireEvalSessionTaskBinding[];
	model?: string;
	startedAt?: string;
	finishedAt?: string;
	notes?: string[];
}

export interface PireEvalSessionBindingFile {
	version: 1;
	suiteId?: string;
	runId?: string;
	model?: string;
	startedAt?: string;
	finishedAt?: string;
	notes?: string[];
	bindings: PireEvalSessionTaskBinding[];
}

function parseJsonFile<T>(text: string, fallback: T): T {
	try {
		return JSON.parse(text) as T;
	} catch {
		return fallback;
	}
}

function artifactRefToPath(ref: string): string {
	return ref.startsWith("artifact:") ? ref.slice("artifact:".length) : ref;
}

function dedupeEvidenceRefs(evidence: PireEvalEvidenceRef[]): PireEvalEvidenceRef[] {
	const seen = new Set<string>();
	return evidence.filter((entry) => {
		const key = `${entry.kind}:${entry.ref}`;
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

function normalizeJudgement(base: PireEvalJudgement, override?: Partial<PireEvalJudgement>): PireEvalJudgement {
	return {
		dimensions: {
			...base.dimensions,
			...(override?.dimensions ?? {}),
		},
		falsePositive: override?.falsePositive ?? base.falsePositive,
		overclaim: override?.overclaim ?? base.overclaim,
		notes: [...(base.notes ?? []), ...(override?.notes ?? [])],
	};
}

function createHeuristicJudgement(finding: PireSessionFindingRecord, evidenceCount: number): PireEvalJudgement {
	return {
		dimensions: {
			discovery: "hit",
			classification: finding.status === "candidate" ? "partial" : "hit",
			rootCause: finding.statement.trim().length > 0 ? "partial" : "miss",
			proof: finding.reproStatus === "reproduced" ? "hit" : finding.reproStatus === "partial" ? "partial" : "miss",
			reporting: evidenceCount > 0 ? "partial" : "miss",
		},
	};
}

function findBoundFinding(
	tracker: PireSessionTrackerSnapshot,
	binding: PireEvalSessionTaskBinding,
): PireSessionFindingRecord | undefined {
	if (binding.findingId) {
		return tracker.findings.find((finding) => finding.id === binding.findingId);
	}
	if (binding.findingTitle) {
		return tracker.findings.find((finding) => finding.title === binding.findingTitle);
	}
	if (binding.findingTitleIncludes) {
		const needle = binding.findingTitleIncludes.toLowerCase();
		return tracker.findings.find((finding) => finding.title.toLowerCase().includes(needle));
	}
	return undefined;
}

function extractEvidenceRefs(params: {
	finding: PireSessionFindingRecord;
	tracker: PireSessionTrackerSnapshot;
	manifest: PireSessionArtifactManifestSnapshot;
}): PireEvalEvidenceRef[] {
	const evidenceById = new Map(params.tracker.evidence.map((record) => [record.id, record]));
	const artifactsByPath = new Map(params.manifest.artifacts.map((artifact) => [artifact.path, artifact]));
	const refs: PireEvalEvidenceRef[] = [
		{
			kind: "finding",
			ref: params.finding.id,
			summary: params.finding.title,
		},
	];

	for (const evidenceId of params.finding.relatedEvidenceIds) {
		const evidence = evidenceById.get(evidenceId);
		if (!evidence) {
			continue;
		}
		if (evidence.commandId) {
			refs.push({
				kind: "command",
				ref: evidence.commandId,
				summary: evidence.summary,
			});
		}
		if (!evidence.commandId || evidence.artifactIds.length === 0) {
			refs.push({
				kind: "note",
				ref: evidence.id,
				summary: evidence.summary,
			});
		}
		for (const artifactId of evidence.artifactIds) {
			const path = artifactRefToPath(artifactId);
			const artifact = artifactsByPath.get(path);
			refs.push({
				kind: "artifact",
				ref: artifactId,
				summary: artifact ? `${artifact.type} ${artifact.path}` : path,
			});
		}
	}

	for (const artifactId of params.finding.relatedArtifactIds) {
		const path = artifactRefToPath(artifactId);
		const artifact = artifactsByPath.get(path);
		refs.push({
			kind: "artifact",
			ref: artifactId,
			summary: artifact ? `${artifact.type} ${artifact.path}` : path,
		});
	}

	return dedupeEvidenceRefs(refs);
}

export async function loadPireEvalTaskSuite(path: string): Promise<PireEvalTaskSuite> {
	return parsePireEvalTaskSuite(await readFile(path, "utf-8"));
}

export async function loadPireEvalRunBundle(path: string): Promise<PireEvalRunBundle> {
	return parsePireEvalRunBundle(await readFile(path, "utf-8"));
}

export function parsePireEvalSessionBindingFile(text: string): PireEvalSessionBindingFile {
	return JSON.parse(text) as PireEvalSessionBindingFile;
}

export async function loadPireEvalSessionBindingFile(path: string): Promise<PireEvalSessionBindingFile> {
	return parsePireEvalSessionBindingFile(await readFile(path, "utf-8"));
}

export async function loadPireSessionTracker(cwd: string): Promise<PireSessionTrackerSnapshot> {
	const path = join(cwd, ".pire", "session", "findings.json");
	if (!existsSync(path)) {
		return { findings: [], evidence: [] };
	}
	return parseJsonFile(await readFile(path, "utf-8"), {
		findings: [],
		evidence: [],
	} satisfies PireSessionTrackerSnapshot);
}

export async function loadPireSessionArtifactManifest(cwd: string): Promise<PireSessionArtifactManifestSnapshot> {
	const path = join(cwd, ".pire", "artifacts.json");
	if (!existsSync(path)) {
		return { artifacts: [] };
	}
	return parseJsonFile(await readFile(path, "utf-8"), { artifacts: [] } satisfies PireSessionArtifactManifestSnapshot);
}

export async function createPireEvalRunBundleFromSession(
	options: CreatePireEvalRunBundleFromSessionOptions,
): Promise<PireEvalRunBundle> {
	const [tracker, manifest] = await Promise.all([
		loadPireSessionTracker(options.cwd),
		loadPireSessionArtifactManifest(options.cwd),
	]);

	const submissions = options.bindings.flatMap((binding) => {
		const task = options.suite.tasks.find((entry) => entry.id === binding.taskId);
		if (!task) {
			return [];
		}
		const finding = findBoundFinding(tracker, binding);
		if (!finding) {
			return [];
		}
		const evidence = extractEvidenceRefs({ finding, tracker, manifest });
		return [
			{
				taskId: task.id,
				evidence,
				findingOutcome: finding.status,
				exploitability: binding.exploitability ?? "unknown",
				judgement: normalizeJudgement(createHeuristicJudgement(finding, evidence.length), binding.judgement),
				notes: [`extracted from finding ${finding.id}`, ...(binding.notes ?? [])],
			},
		];
	});

	return {
		version: 1,
		suiteId: options.suite.suiteId,
		runId: options.runId,
		model: options.model,
		startedAt: options.startedAt,
		finishedAt: options.finishedAt,
		submissions,
		notes: options.notes,
	};
}

export async function savePireEvalRunBundle(cwd: string, run: PireEvalRunBundle, outputPath?: string): Promise<string> {
	const targetPath = outputPath ?? join(cwd, ".pire", "session", "evals", `${run.runId}.json`);
	await mkdir(dirname(targetPath), { recursive: true });
	await writeFile(targetPath, stringifyPireEvalRunBundle(run), "utf-8");
	return targetPath;
}

export async function scorePireEvalRunFromFiles(paths: { suitePath: string; runPath: string }): Promise<{
	suite: PireEvalTaskSuite;
	run: PireEvalRunBundle;
	score: PireEvalRunScore;
}> {
	const [suite, run] = await Promise.all([
		loadPireEvalTaskSuite(paths.suitePath),
		loadPireEvalRunBundle(paths.runPath),
	]);
	return {
		suite,
		run,
		score: scorePireEvalRunBundle(suite, run),
	};
}

export function formatPireEvalRunScoreReport(score: PireEvalRunScore): string {
	const lines = summarizePireEvalRunScore(score);

	if (score.taskScores.length > 0) {
		lines.push("- task scores:");
		for (const taskScore of [...score.taskScores].sort((left, right) => left.taskId.localeCompare(right.taskId))) {
			lines.push(
				`  - ${taskScore.taskId}: ${taskScore.earned}/${taskScore.max} (${Math.round(taskScore.normalized * 100)}%)`,
			);
		}
	}

	return `${lines.join("\n")}\n`;
}
