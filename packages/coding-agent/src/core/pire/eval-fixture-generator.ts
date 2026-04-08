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
