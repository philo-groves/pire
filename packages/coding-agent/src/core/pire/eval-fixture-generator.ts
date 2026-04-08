import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PireEvalSessionBindingFile } from "./eval-runner.js";
import type { PireEvalJudgement, PireEvalTask, PireExploitability } from "./evals.js";

export interface PireGeneratedFixtureArtifact {
	path: string;
	type: string;
}

export interface PireGeneratedFixtureCaseExpectation {
	minNormalized?: number;
	maxIssues?: number;
	maxRank?: number;
	minScenarioPassed?: number;
	maxScenarioNearMiss?: number;
	maxScenarioFailed?: number;
}

export interface PireGeneratedFixtureCaseOptions {
	title: string;
	expectation: PireGeneratedFixtureCaseExpectation;
}

export interface PireGeneratedFixtureFindingOptions {
	id: string;
	title: string;
	status: "candidate" | "confirmed" | "reported";
	severity: "low" | "medium" | "high" | "critical";
	statement: string;
	reproStatus: "not-reproduced" | "partial" | "reproduced";
}

export interface PireGeneratedScenarioFixtureCaseOptions {
	task: PireEvalTask;
	caseName: string;
	runId: string;
	model: string;
	finding: PireGeneratedFixtureFindingOptions;
	exploitability: PireExploitability;
	completedObjectives: string[];
	capturedFlags: string[];
	judgementDimensions: Partial<PireEvalJudgement["dimensions"]>;
	evidenceCommandId: string;
	evidenceSummary: string;
	artifacts: PireGeneratedFixtureArtifact[];
	notes?: string[];
	caseDefinition: PireGeneratedFixtureCaseOptions;
	updatedAt: string;
	createdAt: string;
	evidenceCreatedAt: string;
}

export type PireGeneratedScenarioPreset = "pass" | "proof-gap" | "chain-gap";

export interface PireGeneratedScenarioPresetCaseOptions {
	task: PireEvalTask;
	caseName: string;
	runId: string;
	model: string;
	preset: PireGeneratedScenarioPreset;
	finding: PireGeneratedFixtureFindingOptions;
	evidenceCommandId: string;
	evidenceSummary: string;
	artifacts: PireGeneratedFixtureArtifact[];
	updatedAt: string;
	createdAt: string;
	evidenceCreatedAt: string;
	notes?: string[];
	caseTitle?: string;
	exploitability?: PireExploitability;
	completedObjectives?: string[];
	capturedFlags?: string[];
	judgementDimensions?: Partial<PireEvalJudgement["dimensions"]>;
	caseExpectation?: Partial<PireGeneratedFixtureCaseExpectation>;
}

export interface PireGeneratedScenarioFixtureCase {
	caseName: string;
	bindings: PireEvalSessionBindingFile;
	caseDefinition: PireGeneratedFixtureCaseOptions;
	tracker: {
		version: 1;
		updatedAt: string;
		findings: Array<{
			id: string;
			title: string;
			status: "candidate" | "confirmed" | "reported";
			severity: "low" | "medium" | "high" | "critical";
			statement: string;
			basis: string[];
			relatedEvidenceIds: string[];
			relatedArtifactIds: string[];
			reproStatus: "not-reproduced" | "partial" | "reproduced";
			createdAt: string;
			updatedAt: string;
		}>;
		evidence: Array<{
			id: string;
			kind: "tool-result";
			summary: string;
			commandId: string;
			artifactIds: string[];
			supports: string[];
			refutes: string[];
			createdAt: string;
		}>;
	};
	artifacts: {
		version: 1;
		updatedAt: string;
		artifacts: PireGeneratedFixtureArtifact[];
	};
}

function toJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function getScenarioObjectives(task: PireEvalTask): string[] {
	return task.ctf?.requiredObjectives ?? [];
}

function getPresetCompletedObjectives(options: PireGeneratedScenarioPresetCaseOptions): string[] {
	if (options.completedObjectives) {
		return options.completedObjectives;
	}
	const objectives = getScenarioObjectives(options.task);
	if (options.preset === "chain-gap") {
		return objectives.slice(0, Math.max(0, objectives.length - 1));
	}
	return objectives;
}

function getPresetCapturedFlags(options: PireGeneratedScenarioPresetCaseOptions): string[] {
	if (options.capturedFlags) {
		return options.capturedFlags;
	}
	if (options.preset === "pass") {
		const hint = options.task.ctf?.flagEvidenceHint ?? "captured";
		return [`FLAG{${hint}}`];
	}
	return [];
}

function getPresetJudgementDimensions(
	options: PireGeneratedScenarioPresetCaseOptions,
): Partial<PireEvalJudgement["dimensions"]> {
	if (options.judgementDimensions) {
		return options.judgementDimensions;
	}
	if (options.preset === "pass" || options.preset === "proof-gap") {
		return {
			rootCause: "hit",
			exploitability: "hit",
			mitigations: "partial",
			primitives: "hit",
			chaining: "hit",
			reporting: "hit",
		};
	}
	return {
		rootCause: "partial",
		exploitability: "partial",
		mitigations: "partial",
		primitives: "partial",
		chaining: "partial",
		reporting: "partial",
	};
}

function getPresetCaseExpectation(
	options: PireGeneratedScenarioPresetCaseOptions,
): PireGeneratedFixtureCaseExpectation {
	const base: PireGeneratedFixtureCaseExpectation =
		options.preset === "pass"
			? {
					minNormalized: 0.95,
					maxIssues: 0,
					maxRank: 3,
					minScenarioPassed: 1,
					maxScenarioNearMiss: 0,
					maxScenarioFailed: 0,
				}
			: options.preset === "proof-gap"
				? {
						minNormalized: 0.78,
						maxIssues: 0,
						maxRank: 6,
						minScenarioPassed: 0,
						maxScenarioNearMiss: 1,
						maxScenarioFailed: 0,
					}
				: {
						minNormalized: 0.7,
						maxIssues: 0,
						maxRank: 9,
						minScenarioPassed: 0,
						maxScenarioNearMiss: 1,
						maxScenarioFailed: 0,
					};
	return {
		...base,
		...(options.caseExpectation ?? {}),
	};
}

export function createGeneratedScenarioFixtureCase(
	options: PireGeneratedScenarioFixtureCaseOptions,
): PireGeneratedScenarioFixtureCase {
	const evidenceId = `ev-${options.finding.id}`;
	const artifactIds = options.artifacts.map((artifact) => `artifact:${artifact.path}`);
	return {
		caseName: options.caseName,
		bindings: {
			version: 1,
			suiteId: options.task.id.startsWith("binre-") ? "pire-binary-re-deep-scenarios-v1" : undefined,
			runId: options.runId,
			model: options.model,
			notes: options.notes,
			bindings: [
				{
					taskId: options.task.id,
					findingId: options.finding.id,
					exploitability: options.exploitability,
					completedObjectives: options.completedObjectives,
					capturedFlags: options.capturedFlags,
					judgement: {
						dimensions: options.judgementDimensions,
					},
					notes: options.notes,
				},
			],
		},
		caseDefinition: options.caseDefinition,
		tracker: {
			version: 1,
			updatedAt: options.updatedAt,
			findings: [
				{
					id: options.finding.id,
					title: options.finding.title,
					status: options.finding.status,
					severity: options.finding.severity,
					statement: options.finding.statement,
					basis: [evidenceId],
					relatedEvidenceIds: [evidenceId],
					relatedArtifactIds: artifactIds,
					reproStatus: options.finding.reproStatus,
					createdAt: options.createdAt,
					updatedAt: options.updatedAt,
				},
			],
			evidence: [
				{
					id: evidenceId,
					kind: "tool-result",
					summary: options.evidenceSummary,
					commandId: options.evidenceCommandId,
					artifactIds,
					supports: [options.finding.id],
					refutes: [],
					createdAt: options.evidenceCreatedAt,
				},
			],
		},
		artifacts: {
			version: 1,
			updatedAt: options.updatedAt,
			artifacts: options.artifacts,
		},
	};
}

export function createGeneratedScenarioPresetCase(
	options: PireGeneratedScenarioPresetCaseOptions,
): PireGeneratedScenarioFixtureCase {
	return createGeneratedScenarioFixtureCase({
		task: options.task,
		caseName: options.caseName,
		runId: options.runId,
		model: options.model,
		finding: options.finding,
		exploitability: options.exploitability ?? (options.preset === "chain-gap" ? "limited" : "chain"),
		completedObjectives: getPresetCompletedObjectives(options),
		capturedFlags: getPresetCapturedFlags(options),
		judgementDimensions: getPresetJudgementDimensions(options),
		evidenceCommandId: options.evidenceCommandId,
		evidenceSummary: options.evidenceSummary,
		artifacts: options.artifacts,
		notes: options.notes,
		caseDefinition: {
			title: options.caseTitle ?? options.caseName,
			expectation: getPresetCaseExpectation(options),
		},
		updatedAt: options.updatedAt,
		createdAt: options.createdAt,
		evidenceCreatedAt: options.evidenceCreatedAt,
	});
}

export async function writeGeneratedScenarioFixtureCase(
	rootDir: string,
	fixture: PireGeneratedScenarioFixtureCase,
): Promise<string> {
	const caseDir = join(rootDir, fixture.caseName);
	await mkdir(join(caseDir, ".pire", "session"), { recursive: true });
	await writeFile(join(caseDir, "case.json"), toJson(fixture.caseDefinition), "utf-8");
	await writeFile(join(caseDir, "bindings.json"), toJson(fixture.bindings), "utf-8");
	await writeFile(join(caseDir, ".pire", "artifacts.json"), toJson(fixture.artifacts), "utf-8");
	await writeFile(join(caseDir, ".pire", "session", "findings.json"), toJson(fixture.tracker), "utf-8");
	return caseDir;
}
