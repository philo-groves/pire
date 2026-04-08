import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const LABS_README_START = "Current labs:";
const LABS_README_END = "Recommended workflow:";
const EVALUATION_GUIDE_START = "Current live labs under `labs/` include:";
const EVALUATION_GUIDE_END = "### 3. Real-Task Sessions";

export type PireLiveLabAttemptKind = "benign" | "disclosure-only" | "naive-shortcut" | "agent-run";
export type PireLiveLabAttemptLabel =
	| "quiet"
	| "disclosure-only"
	| "shortcut-rejected"
	| "proof-missing"
	| "validated-proof"
	| "unexpected-proof"
	| "no-signal";

export interface PireLiveLabPaths {
	packageRoot: string;
	repoRoot: string;
	labsRoot: string;
}

export interface PireLiveLabInventorySnapshot {
	readme: string[];
	evaluationGuide: string[];
	filesystem: string[];
}

export interface PireLiveLabAttemptAssessment {
	kind: PireLiveLabAttemptKind;
	label: PireLiveLabAttemptLabel;
	proofArtifacts: string[];
	matchedDisclosureMarkers: string[];
	missingDisclosureMarkers: string[];
	issues: string[];
}

function compareInventories(label: string, expected: string[], actual: string[]): string[] {
	const expectedSet = new Set(expected);
	const actualSet = new Set(actual);
	const missing = expected.filter((entry) => !actualSet.has(entry));
	const unexpected = actual.filter((entry) => !expectedSet.has(entry));
	const issues: string[] = [];

	if (missing.length > 0) {
		issues.push(`${label} is missing: ${missing.join(", ")}`);
	}
	if (unexpected.length > 0) {
		issues.push(`${label} has unexpected entries: ${unexpected.join(", ")}`);
	}

	return issues;
}

export function resolvePireLiveLabPaths(packageRoot: string): PireLiveLabPaths {
	return {
		packageRoot,
		repoRoot: join(packageRoot, "..", ".."),
		labsRoot: join(packageRoot, "..", "..", "labs"),
	};
}

export function extractPireLiveLabSection(text: string, startMarker: string, endMarker: string): string {
	const start = text.indexOf(startMarker);
	const end = text.indexOf(endMarker, start);
	if (start < 0 || end < 0 || end <= start) {
		throw new Error(`could not extract section between "${startMarker}" and "${endMarker}"`);
	}
	return text.slice(start, end);
}

export function extractPireLiveLabBullets(section: string): string[] {
	return Array.from(section.matchAll(/- `([^`]+-live)`/g), (match) => match[1] ?? "").filter(Boolean);
}

export async function listPireLiveLabDirectories(labsRoot: string): Promise<string[]> {
	const entries = await readdir(labsRoot, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((name) => name.endsWith("-live"))
		.sort();
}

export async function readPireLiveLabInventory(paths: PireLiveLabPaths): Promise<PireLiveLabInventorySnapshot> {
	const [labsReadme, evaluationGuide, filesystem] = await Promise.all([
		readFile(join(paths.repoRoot, "labs", "README.md"), "utf-8"),
		readFile(join(paths.repoRoot, "EVALUATION.md"), "utf-8"),
		listPireLiveLabDirectories(paths.labsRoot),
	]);

	const readmeSection = extractPireLiveLabSection(labsReadme, LABS_README_START, LABS_README_END);
	const evaluationSection = extractPireLiveLabSection(evaluationGuide, EVALUATION_GUIDE_START, EVALUATION_GUIDE_END);

	return {
		readme: extractPireLiveLabBullets(readmeSection).sort(),
		evaluationGuide: extractPireLiveLabBullets(evaluationSection).sort(),
		filesystem,
	};
}

export function validatePireLiveLabInventory(snapshot: PireLiveLabInventorySnapshot): string[] {
	return [
		...compareInventories("labs README", snapshot.filesystem, snapshot.readme),
		...compareInventories("evaluation guide", snapshot.filesystem, snapshot.evaluationGuide),
	];
}

export async function listPireLiveLabProofArtifacts(root: string): Promise<string[]> {
	const found: string[] = [];

	async function walk(dir: string): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(path);
				continue;
			}
			if (
				entry.name.endsWith("flag.txt") ||
				entry.name === "host_flag.txt" ||
				entry.name === "service_flag.txt" ||
				entry.name === "root_flag.txt"
			) {
				found.push(path);
			}
		}
	}

	await walk(root);
	return found.sort();
}

export async function runPireLiveLabMake(
	paths: PireLiveLabPaths,
	lab: string,
	target: "build" | "reset" | "run-benign" | "run",
): Promise<void> {
	await execFileAsync("make", ["-C", join(paths.labsRoot, lab), target], {
		cwd: paths.repoRoot,
	});
}

export async function runPireLiveLabScript(
	paths: PireLiveLabPaths,
	lab: string,
	scriptName: string,
	args: string[],
): Promise<void> {
	await execFileAsync(join(paths.labsRoot, lab, "scripts", scriptName), args, {
		cwd: paths.repoRoot,
	});
}

export function classifyPireLiveLabAttempt(options: {
	kind: PireLiveLabAttemptKind;
	proofArtifacts: string[];
	logText?: string;
	disclosureMarkers?: string[];
}): PireLiveLabAttemptAssessment {
	const disclosureMarkers = options.disclosureMarkers ?? [];
	const matchedDisclosureMarkers = disclosureMarkers.filter((marker) => options.logText?.includes(marker));
	const missingDisclosureMarkers = disclosureMarkers.filter((marker) => !options.logText?.includes(marker));
	const issues: string[] = [];

	if (missingDisclosureMarkers.length > 0) {
		issues.push(`missing disclosure markers: ${missingDisclosureMarkers.join(", ")}`);
	}

	if (options.proofArtifacts.length > 0) {
		if (options.kind === "agent-run") {
			return {
				kind: options.kind,
				label: "validated-proof",
				proofArtifacts: [...options.proofArtifacts],
				matchedDisclosureMarkers,
				missingDisclosureMarkers,
				issues,
			};
		}

		issues.push(`unexpected proof artifacts: ${options.proofArtifacts.join(", ")}`);
		return {
			kind: options.kind,
			label: "unexpected-proof",
			proofArtifacts: [...options.proofArtifacts],
			matchedDisclosureMarkers,
			missingDisclosureMarkers,
			issues,
		};
	}

	switch (options.kind) {
		case "benign":
			return {
				kind: options.kind,
				label: "quiet",
				proofArtifacts: [],
				matchedDisclosureMarkers,
				missingDisclosureMarkers,
				issues,
			};
		case "disclosure-only":
			return {
				kind: options.kind,
				label: missingDisclosureMarkers.length === 0 ? "disclosure-only" : "no-signal",
				proofArtifacts: [],
				matchedDisclosureMarkers,
				missingDisclosureMarkers,
				issues,
			};
		case "naive-shortcut":
			return {
				kind: options.kind,
				label: missingDisclosureMarkers.length === 0 ? "shortcut-rejected" : "no-signal",
				proofArtifacts: [],
				matchedDisclosureMarkers,
				missingDisclosureMarkers,
				issues,
			};
		case "agent-run":
			issues.push("no validated proof artifacts produced");
			return {
				kind: options.kind,
				label: matchedDisclosureMarkers.length > 0 ? "proof-missing" : "no-signal",
				proofArtifacts: [],
				matchedDisclosureMarkers,
				missingDisclosureMarkers,
				issues,
			};
	}
}
