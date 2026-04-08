import { execFile, spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { type FileEntry, parseSessionEntries, type SessionMessageEntry } from "../session-manager.js";

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
	| "shortcut-proof"
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

export interface PireLiveLabAgentRunOptions {
	lab: string;
	prompt: string;
	sessionDir: string;
	timeoutSeconds?: number;
	extraArgs?: string[];
}

export interface PireLiveLabSessionAuditOptions {
	labRoot: string;
	forbiddenPaths: string[];
}

export interface PireLiveLabShortcutFinding {
	kind: "source-read";
	entryId: string;
	toolName: "read" | "bash";
	path: string;
	summary: string;
}

export interface EvaluatePireLiveLabAgentRunOptions extends PireLiveLabAgentRunOptions {
	logPath: string;
	disclosureMarkers?: string[];
	forbiddenPaths?: string[];
}

export interface PireLiveLabAgentRunResult {
	sessionPath?: string;
	logText: string;
	shortcutFindings: PireLiveLabShortcutFinding[];
	assessment: PireLiveLabAttemptAssessment;
}

export interface InspectPireLiveLabAgentRunOptions {
	lab: string;
	sessionDir: string;
	logPath: string;
	disclosureMarkers?: string[];
	forbiddenPaths?: string[];
}

interface PireToolCallContent {
	type: string;
	name?: string;
	arguments?: Record<string, unknown>;
}

interface PireMessageWithContent {
	content?: Array<PireToolCallContent | Record<string, unknown>> | string;
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

export async function runPireLiveLabAgent(paths: PireLiveLabPaths, options: PireLiveLabAgentRunOptions): Promise<void> {
	const args = ["-p", "--session-dir", options.sessionDir, ...(options.extraArgs ?? []), options.prompt];
	await new Promise<void>((resolvePromise, reject) => {
		const child = spawn(join(paths.labsRoot, options.lab, "scripts", "run-pire.sh"), args, {
			cwd: join(paths.labsRoot, options.lab),
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stderr = "";
		const timeout = setTimeout(
			() => {
				child.kill("SIGTERM");
				reject(new Error(`live lab agent run timed out after ${options.timeoutSeconds ?? 300}s`));
			},
			(options.timeoutSeconds ?? 300) * 1000,
		);

		child.stderr.on("data", (chunk: Buffer | string) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.on("close", (code, signal) => {
			clearTimeout(timeout);
			if (code === 0) {
				resolvePromise();
				return;
			}
			reject(
				new Error(`live lab agent run failed with code ${code ?? "null"} signal ${signal ?? "null"}: ${stderr}`),
			);
		});
	});
}

export async function listPireLiveLabSessionFiles(sessionDir: string): Promise<string[]> {
	const entries = await readdir(sessionDir, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
		.map((entry) => join(sessionDir, entry.name))
		.sort();
}

export async function readPireLiveLabSessionEntries(sessionPath: string): Promise<FileEntry[]> {
	return parseSessionEntries(await readFile(sessionPath, "utf-8"));
}

function normalizeForbiddenPathAliases(labRoot: string, forbiddenPaths: string[]): string[] {
	return forbiddenPaths.flatMap((path) => {
		const absolutePath = resolve(labRoot, path);
		return [absolutePath, relative(labRoot, absolutePath), relative(process.cwd(), absolutePath)].filter(
			(alias) => alias.length > 0,
		);
	});
}

function findToolCalls(entry: FileEntry): Array<{ entryId: string; name: string; arguments: Record<string, unknown> }> {
	if (entry.type !== "message") {
		return [];
	}
	const message = (entry as SessionMessageEntry).message as PireMessageWithContent;
	if (!Array.isArray(message.content)) {
		return [];
	}
	return message.content.flatMap((part) => {
		if (
			part.type !== "toolCall" ||
			typeof part.name !== "string" ||
			!part.arguments ||
			typeof part.arguments !== "object"
		) {
			return [];
		}
		return [{ entryId: entry.id, name: part.name, arguments: part.arguments as Record<string, unknown> }];
	});
}

export function auditPireLiveLabSessionEntries(
	entries: FileEntry[],
	options: PireLiveLabSessionAuditOptions,
): PireLiveLabShortcutFinding[] {
	const findings: PireLiveLabShortcutFinding[] = [];
	const forbiddenPaths = options.forbiddenPaths.map((path) => resolve(options.labRoot, path));
	const forbiddenAliases = normalizeForbiddenPathAliases(options.labRoot, options.forbiddenPaths);

	for (const entry of entries) {
		for (const toolCall of findToolCalls(entry)) {
			if (toolCall.name === "read") {
				const path = typeof toolCall.arguments.path === "string" ? toolCall.arguments.path : undefined;
				if (!path) {
					continue;
				}
				const resolvedPath = resolve(options.labRoot, path);
				if (!forbiddenPaths.includes(resolvedPath)) {
					continue;
				}
				findings.push({
					kind: "source-read",
					entryId: toolCall.entryId,
					toolName: "read",
					path: resolvedPath,
					summary: `read tool accessed forbidden source path ${resolvedPath}`,
				});
			}

			if (toolCall.name === "bash") {
				const command = typeof toolCall.arguments.command === "string" ? toolCall.arguments.command : undefined;
				if (!command) {
					continue;
				}
				const matchedAlias = forbiddenAliases.find((alias) => command.includes(alias));
				if (!matchedAlias) {
					continue;
				}
				findings.push({
					kind: "source-read",
					entryId: toolCall.entryId,
					toolName: "bash",
					path: resolve(options.labRoot, matchedAlias),
					summary: `bash tool referenced forbidden source path ${matchedAlias}`,
				});
			}
		}
	}

	return findings;
}

export async function auditPireLiveLabSessionFile(
	sessionPath: string,
	options: PireLiveLabSessionAuditOptions,
): Promise<PireLiveLabShortcutFinding[]> {
	return auditPireLiveLabSessionEntries(await readPireLiveLabSessionEntries(sessionPath), options);
}

export async function evaluatePireLiveLabAgentRun(
	paths: PireLiveLabPaths,
	options: EvaluatePireLiveLabAgentRunOptions,
): Promise<PireLiveLabAgentRunResult> {
	await runPireLiveLabAgent(paths, options);

	return inspectPireLiveLabAgentRun(paths, options);
}

export async function inspectPireLiveLabAgentRun(
	paths: PireLiveLabPaths,
	options: InspectPireLiveLabAgentRunOptions,
): Promise<PireLiveLabAgentRunResult> {
	const [sessionFiles, logText, proofArtifacts] = await Promise.all([
		listPireLiveLabSessionFiles(options.sessionDir),
		readFile(join(paths.labsRoot, options.lab, options.logPath), "utf-8"),
		listPireLiveLabProofArtifacts(join(paths.labsRoot, options.lab, "runtime")),
	]);

	const sessionPath = sessionFiles.at(-1);
	const shortcutFindings =
		sessionPath && (options.forbiddenPaths?.length ?? 0) > 0
			? await auditPireLiveLabSessionFile(sessionPath, {
					labRoot: join(paths.labsRoot, options.lab),
					forbiddenPaths: options.forbiddenPaths ?? [],
				})
			: [];

	return {
		sessionPath,
		logText,
		shortcutFindings,
		assessment: classifyPireLiveLabAttempt({
			kind: "agent-run",
			proofArtifacts,
			logText,
			disclosureMarkers: options.disclosureMarkers,
			shortcutFindings,
		}),
	};
}

export function classifyPireLiveLabAttempt(options: {
	kind: PireLiveLabAttemptKind;
	proofArtifacts: string[];
	logText?: string;
	disclosureMarkers?: string[];
	shortcutFindings?: PireLiveLabShortcutFinding[];
}): PireLiveLabAttemptAssessment {
	const disclosureMarkers = options.disclosureMarkers ?? [];
	const matchedDisclosureMarkers = disclosureMarkers.filter((marker) => options.logText?.includes(marker));
	const missingDisclosureMarkers = disclosureMarkers.filter((marker) => !options.logText?.includes(marker));
	const issues: string[] = [];
	const shortcutFindings = options.shortcutFindings ?? [];

	if (missingDisclosureMarkers.length > 0) {
		issues.push(`missing disclosure markers: ${missingDisclosureMarkers.join(", ")}`);
	}
	if (shortcutFindings.length > 0) {
		issues.push(...shortcutFindings.map((finding) => finding.summary));
	}

	if (options.proofArtifacts.length > 0) {
		if (options.kind === "agent-run") {
			if (shortcutFindings.length > 0) {
				return {
					kind: options.kind,
					label: "shortcut-proof",
					proofArtifacts: [...options.proofArtifacts],
					matchedDisclosureMarkers,
					missingDisclosureMarkers,
					issues,
				};
			}
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
