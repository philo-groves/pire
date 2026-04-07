import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { ArtifactManifest, ArtifactRecord, ArtifactType } from "./artifacts.js";
import type { CampaignLedger, CampaignLedgerSummary } from "./campaign.js";
import type { FindingsTracker, FindingRecord, FindingsTrackerSummary } from "./findings.js";
import type { EnvironmentInventory } from "./inventory.js";
import type { PireMode, PireRole, PireSessionType, PireToolActivity } from "./research-runtime.js";
import type { PireSafetyPosture } from "./safety.js";

export type NotebookFormat = "markdown" | "json" | "html";

export interface NotebookCommandEntry {
	command: string;
	source: "artifact" | "evidence";
	artifactPath?: string;
}

export interface NotebookDocument {
	version: 1;
	generatedAt: string;
	cwd: string;
	mode: PireMode;
	role?: PireRole;
	sessionType?: PireSessionType;
	safety: PireSafetyPosture;
	inventory?: EnvironmentInventory;
	campaign?: CampaignLedger;
	campaignSummary?: CampaignLedgerSummary;
	tracker: FindingsTracker;
	trackerSummary: FindingsTrackerSummary;
	manifest: ArtifactManifest;
	activities: PireToolActivity[];
	commandLog: NotebookCommandEntry[];
	scope: {
		safetyScope: PireSafetyPosture["scope"];
		safetyIntent: PireSafetyPosture["intent"];
		sessionType?: PireSessionType;
		role?: PireRole;
	};
	methodology: {
		inventoryCaptured: boolean;
		activityCount: number;
		commandCount: number;
		artifactCount: number;
	};
	openQuestions: FindingsTracker["questions"];
	deadEnds: FindingsTracker["deadEnds"];
	findingReports: FindingReportSection[];
	remediationDraft: string[];
}

export interface FindingReportSection {
	finding: FindingRecord;
	evidence: FindingsTracker["evidence"];
	artifacts: ArtifactRecord[];
	commands: string[];
	status: "confirmed" | "reported" | "candidate";
}

export interface NotebookExportResult {
	format: NotebookFormat;
	path: string;
}

export interface GenerateNotebookOptions {
	cwd: string;
	mode: PireMode;
	role?: PireRole;
	sessionType?: PireSessionType;
	safety: PireSafetyPosture;
	inventory?: EnvironmentInventory;
	campaign?: CampaignLedger;
	campaignSummary?: CampaignLedgerSummary;
	tracker: FindingsTracker;
	trackerSummary: FindingsTrackerSummary;
	manifest: ArtifactManifest;
	activities: PireToolActivity[];
}

export interface ReproBundleFile {
	sourcePath: string;
	bundledPath?: string;
	type: ArtifactType;
	status: "bundled" | "referenced" | "missing";
}

export type ReproBundleReadiness = "ready" | "partial" | "insufficient";

export interface ReproBundleAssessment {
	readiness: ReproBundleReadiness;
	issues: string[];
	evidenceCount: number;
	commandCount: number;
	artifactCount: number;
	bundledArtifactCount: number;
	missingArtifactCount: number;
	validationNotes: string[];
}

export interface ReproBundleResult {
	directory: string;
	readmePath: string;
	manifestPath: string;
	commandsPath: string;
	environmentPath: string;
	artifactsPath: string;
	files: ReproBundleFile[];
	assessment: ReproBundleAssessment;
}

export interface GenerateReproBundleOptions {
	cwd: string;
	mode: PireMode;
	role?: PireRole;
	sessionType?: PireSessionType;
	safety: PireSafetyPosture;
	inventory?: EnvironmentInventory;
	tracker: FindingsTracker;
	manifest: ArtifactManifest;
	finding: FindingRecord;
	slug?: string;
	allowIncomplete?: boolean;
}

export class ReproBundleAssessmentError extends Error {
	constructor(
		message: string,
		public readonly assessment: ReproBundleAssessment,
	) {
		super(message);
		this.name = "ReproBundleAssessmentError";
	}
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

function dedupe<T>(values: T[], key: (value: T) => string): T[] {
	const seen = new Set<string>();
	const result: T[] = [];
	for (const value of values) {
		const id = key(value);
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);
		result.push(value);
	}
	return result;
}

function collectCommandLog(tracker: FindingsTracker, manifest: ArtifactManifest): NotebookCommandEntry[] {
	const artifactCommands = manifest.artifacts.flatMap((artifact) =>
		artifact.relatedCommands.map((command) => ({ command, source: "artifact" as const, artifactPath: artifact.path })),
	);
	const evidenceCommands = tracker.evidence
		.filter((record) => record.commandId)
		.map((record) => ({ command: record.commandId!, source: "evidence" as const }));
	return dedupe(
		[...artifactCommands, ...evidenceCommands],
		(entry) => `${entry.source}:${entry.command}:${"artifactPath" in entry ? entry.artifactPath : ""}`,
	);
}

export function buildNotebookDocument(options: GenerateNotebookOptions): NotebookDocument {
	const commandLog = collectCommandLog(options.tracker, options.manifest);
	const findingReports = collectFindingReportSections(options.tracker, options.manifest);
	return {
		version: 1,
		generatedAt: new Date().toISOString(),
		cwd: options.cwd,
		mode: options.mode,
		role: options.role,
		sessionType: options.sessionType,
		safety: options.safety,
		inventory: options.inventory,
		campaign: options.campaign,
		campaignSummary: options.campaignSummary,
		tracker: options.tracker,
		trackerSummary: options.trackerSummary,
		manifest: options.manifest,
		activities: options.activities,
		commandLog,
		scope: {
			safetyScope: options.safety.scope,
			safetyIntent: options.safety.intent,
			sessionType: options.sessionType,
			role: options.role,
		},
		methodology: {
			inventoryCaptured: options.inventory !== undefined,
			activityCount: options.activities.length,
			commandCount: commandLog.length,
			artifactCount: options.manifest.artifacts.length,
		},
		openQuestions: options.tracker.questions.filter((question) => question.status === "open" || question.status === "blocked"),
		deadEnds: options.tracker.deadEnds,
		findingReports,
		remediationDraft: buildRemediationDraft(options.tracker),
	};
}

function renderInventorySummary(inventory?: EnvironmentInventory): string[] {
	if (!inventory) {
		return ["- Inventory not captured"];
	}
	const availableTools = inventory.tools.filter((tool) => tool.available).map((tool) => tool.name);
	return [
		`- Platform: ${inventory.platform}/${inventory.arch}`,
		`- Network posture: ${inventory.networkPosture}`,
		`- Sandbox posture: ${inventory.sandboxPosture}`,
		`- Writable dirs: ${inventory.writableDirs.join(", ") || "none"}`,
		`- Available tools: ${availableTools.join(", ") || "none"}`,
	];
}

function renderFindingsDraft(tracker: FindingsTracker): string[] {
	const findings = tracker.findings.filter((record) => record.status === "confirmed" || record.status === "reported");
	if (findings.length === 0) {
		return ["No confirmed findings yet. Keep this section as a report scaffold until evidence matures."];
	}
	return findings.flatMap((finding) => [
		`Finding ${finding.id}: ${finding.title}`,
		`Severity: ${finding.severity}`,
		`Statement: ${finding.statement}`,
		`Reproduction: ${finding.reproStatus}`,
		`Evidence: ${finding.relatedEvidenceIds.join(", ") || "none linked"}`,
		"",
	]);
}

function collectFindingReportSections(tracker: FindingsTracker, manifest: ArtifactManifest): FindingReportSection[] {
	return tracker.findings.map((finding) => {
		const evidence = collectEvidenceForFinding(tracker, finding);
		const artifacts = collectArtifactsForFinding(tracker, manifest, finding);
		const commands = collectCommandsForFinding(finding, artifacts, evidence);
		return {
			finding,
			evidence,
			artifacts,
			commands,
			status: finding.status,
		};
	});
}

function buildRemediationDraft(tracker: FindingsTracker): string[] {
	const confirmed = tracker.findings.filter((finding) => finding.status === "confirmed" || finding.status === "reported");
	if (confirmed.length === 0) {
		return ["No confirmed findings yet. Use this section to capture mitigations once findings are confirmed."];
	}
	return confirmed.map(
		(finding) =>
			`${finding.id}: Validate the root cause behind "${finding.title}", add a guard or invariant for the triggering condition, and attach regression coverage for the reproduced path.`,
	);
}

export function renderNotebookMarkdown(doc: NotebookDocument): string {
	const lines = [
		"# Pire Research Notebook",
		"",
		`Generated: ${doc.generatedAt}`,
		`Cwd: ${doc.cwd}`,
		`Mode: ${doc.mode}`,
		`Role: ${doc.role ?? "unset"}`,
		`Session Type: ${doc.sessionType ?? "unset"}`,
		`Safety Scope: ${doc.safety.scope}`,
		`Safety Intent: ${doc.safety.intent}`,
		"",
		"## Scope",
		"",
		`- Safety scope: ${doc.scope.safetyScope}`,
		`- Safety intent: ${doc.scope.safetyIntent}`,
		`- Session type: ${doc.scope.sessionType ?? "unset"}`,
		`- Role: ${doc.scope.role ?? "unset"}`,
		"",
		"## Methodology",
		"",
		`- Inventory captured: ${doc.methodology.inventoryCaptured ? "yes" : "no"}`,
		`- Activity entries: ${doc.methodology.activityCount}`,
		`- Commands recorded: ${doc.methodology.commandCount}`,
		`- Artifacts recorded: ${doc.methodology.artifactCount}`,
		"",
		"## Campaign",
		"",
		"## Timeline of Actions",
		"",
	];

	if (!doc.campaignSummary) {
		lines.splice(lines.length - 2, 0, "- Campaign ledger not captured", "");
	} else {
		const campaignLines = [
			`- Findings: ${doc.campaignSummary.totalFindings}`,
			`- Lead: ${doc.campaignSummary.leadFindings}`,
			`- Confirmed: ${doc.campaignSummary.confirmedFindings}`,
			`- Submitted: ${doc.campaignSummary.submittedFindings}`,
			`- De-escalated: ${doc.campaignSummary.deEscalatedFindings}`,
			`- Blocked: ${doc.campaignSummary.blockedFindings}`,
		];
		if ((doc.campaign?.findings.length ?? 0) > 0) {
			campaignLines.push("- Campaign findings:");
			for (const record of doc.campaign!.findings.slice(0, 6)) {
				campaignLines.push(`  - ${record.id} [${record.status}] ${record.title}`);
			}
		}
		lines.splice(lines.length - 2, 0, ...campaignLines, "");
	}

	if (doc.activities.length === 0) {
		lines.push("- No recorded activity");
	} else {
		for (const activity of doc.activities) {
			lines.push(`- ${activity.recordedAt}: ${activity.tool} ${activity.target} :: ${activity.summary}`);
		}
	}

	lines.push("", "## Command Log", "");
	if (doc.commandLog.length === 0) {
		lines.push("- No commands recorded");
	} else {
		for (const entry of doc.commandLog) {
			lines.push(`- ${entry.command}${entry.artifactPath ? ` (${entry.artifactPath})` : ""}`);
		}
	}

	lines.push("", "## Artifact Manifest", "");
	if (doc.manifest.artifacts.length === 0) {
		lines.push("- No artifacts recorded");
	} else {
		for (const artifact of doc.manifest.artifacts) {
			lines.push(`- ${artifact.path} [${artifact.type}]`);
		}
	}

	lines.push(
		"",
		"## Findings Summary",
		"",
		`- Hypotheses: ${doc.trackerSummary.totalHypotheses}`,
		`- Confirmed findings: ${doc.trackerSummary.confirmedFindings}`,
		`- Open questions: ${doc.trackerSummary.openQuestions}`,
		`- Evidence records: ${doc.trackerSummary.totalEvidence}`,
		"",
		"## Environment Notes",
		"",
		...renderInventorySummary(doc.inventory),
		"",
		"## Findings",
		"",
	);

	if (doc.findingReports.length === 0) {
		lines.push("- No findings recorded");
	} else {
		for (const section of doc.findingReports) {
			lines.push(`### ${section.finding.id} ${section.finding.title}`);
			lines.push(`- Status: ${section.finding.status}`);
			lines.push(`- Severity: ${section.finding.severity}`);
			lines.push(`- Statement: ${section.finding.statement}`);
			lines.push(`- Reproduction: ${section.finding.reproStatus}`);
			if (section.evidence.length > 0) {
				lines.push("- Evidence:");
				for (const evidence of section.evidence) {
					lines.push(`  - ${evidence.id}: ${evidence.summary}`);
				}
			}
			if (section.commands.length > 0) {
				lines.push("- Commands:");
				for (const command of section.commands) {
					lines.push(`  - ${command}`);
				}
			}
			if (section.artifacts.length > 0) {
				lines.push("- Artifacts:");
				for (const artifact of section.artifacts) {
					lines.push(`  - ${artifact.path} [${artifact.type}]`);
				}
			}
			lines.push("");
		}
	}

	lines.push("## Open Questions", "");
	if (doc.openQuestions.length === 0) {
		lines.push("- None");
	} else {
		for (const question of doc.openQuestions) {
			lines.push(`- ${question.id} [${question.status}] ${question.prompt}`);
		}
	}

	lines.push("", "## Dead Ends", "");
	if (doc.deadEnds.length === 0) {
		lines.push("- None");
	} else {
		for (const deadEnd of doc.deadEnds) {
			lines.push(`- ${deadEnd.id}: ${deadEnd.summary}`);
		}
	}

	lines.push("", "## Remediation Draft", "", ...doc.remediationDraft);

	return `${lines.join("\n").trimEnd()}\n`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export function renderNotebookHtml(doc: NotebookDocument): string {
	const commandItems = doc.commandLog
		.map((entry) => `<li><code>${escapeHtml(entry.command)}</code></li>`)
		.join("");
	const activityItems = doc.activities
		.map(
			(activity) =>
				`<li><strong>${escapeHtml(activity.recordedAt)}</strong> ${escapeHtml(activity.tool)} ${escapeHtml(activity.target)}<br>${escapeHtml(activity.summary)}</li>`,
		)
		.join("");
	const artifactItems = doc.manifest.artifacts
		.map(
			(artifact) =>
				`<li><code>${escapeHtml(artifact.path)}</code> <span>[${escapeHtml(artifact.type)}]</span></li>`,
		)
		.join("");
	const findingDetails = doc.findingReports
		.map((section) => {
			const evidenceItems =
				section.evidence.length > 0
					? `<ul>${section.evidence.map((record) => `<li><strong>${escapeHtml(record.id)}</strong> ${escapeHtml(record.summary)}</li>`).join("")}</ul>`
					: "<p>No linked evidence</p>";
			const commandItemsForFinding =
				section.commands.length > 0
					? `<ul>${section.commands.map((command) => `<li><code>${escapeHtml(command)}</code></li>`).join("")}</ul>`
					: "<p>No recorded commands</p>";
			const artifactItemsForFinding =
				section.artifacts.length > 0
					? `<ul>${section.artifacts.map((artifact) => `<li><code>${escapeHtml(artifact.path)}</code> [${escapeHtml(artifact.type)}]</li>`).join("")}</ul>`
					: "<p>No linked artifacts</p>";
			return `<details>
<summary>${escapeHtml(section.finding.id)} ${escapeHtml(section.finding.title)}</summary>
<p>${escapeHtml(section.finding.statement)}</p>
<p>Severity: ${escapeHtml(section.finding.severity)} | Status: ${escapeHtml(section.finding.status)} | Repro: ${escapeHtml(section.finding.reproStatus)}</p>
<h3>Evidence</h3>
${evidenceItems}
<h3>Commands</h3>
${commandItemsForFinding}
<h3>Artifacts</h3>
${artifactItemsForFinding}
</details>`;
		})
		.join("");
	const questionItems = doc.openQuestions
		.map((question) => `<li>${escapeHtml(question.id)} [${escapeHtml(question.status)}] ${escapeHtml(question.prompt)}</li>`)
		.join("");
	const deadEndItems = doc.deadEnds.map((deadEnd) => `<li>${escapeHtml(deadEnd.id)} ${escapeHtml(deadEnd.summary)}</li>`).join("");
	const remediationItems = doc.remediationDraft.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
	const campaignSummaryItems = doc.campaignSummary
		? [
				`<li>Findings: ${doc.campaignSummary.totalFindings}</li>`,
				`<li>Lead: ${doc.campaignSummary.leadFindings}</li>`,
				`<li>Confirmed: ${doc.campaignSummary.confirmedFindings}</li>`,
				`<li>Submitted: ${doc.campaignSummary.submittedFindings}</li>`,
				`<li>De-escalated: ${doc.campaignSummary.deEscalatedFindings}</li>`,
				`<li>Blocked: ${doc.campaignSummary.blockedFindings}</li>`,
			].join("")
		: "<li>Campaign ledger not captured</li>";
	const campaignItems =
		doc.campaign && doc.campaign.findings.length > 0
			? doc.campaign.findings
					.map(
						(record) =>
							`<li><strong>${escapeHtml(record.id)}</strong> [${escapeHtml(record.status)}] ${escapeHtml(record.title)}${
								record.note ? `<br>${escapeHtml(record.note)}` : ""
							}</li>`,
					)
					.join("")
			: "<li>No campaign findings recorded</li>";

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pire Research Notebook</title>
<style>
body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 2rem; line-height: 1.5; background: #f5f2ea; color: #1f2933; }
section { margin-bottom: 2rem; }
code { background: #e7dfd1; padding: 0.1rem 0.25rem; }
details { margin: 0.5rem 0; padding: 0.5rem; background: #fffdf8; border: 1px solid #d7c8ac; }
</style>
</head>
<body>
<h1>Pire Research Notebook</h1>
<section>
<p>Generated: ${escapeHtml(doc.generatedAt)}</p>
<p>Mode: ${escapeHtml(doc.mode)} | Role: ${escapeHtml(doc.role ?? "unset")} | Session: ${escapeHtml(doc.sessionType ?? "unset")}</p>
<p>Safety: ${escapeHtml(doc.safety.scope)} / ${escapeHtml(doc.safety.intent)}</p>
</section>
<section>
<h2>Campaign</h2>
<ul>${campaignSummaryItems}</ul>
<ul>${campaignItems}</ul>
</section>
<section>
<h2>Timeline of Actions</h2>
<ul>${activityItems || "<li>No recorded activity</li>"}</ul>
</section>
<section>
<h2>Command Log</h2>
<ul>${commandItems || "<li>No commands recorded</li>"}</ul>
</section>
<section>
<h2>Artifact Manifest</h2>
<ul>${artifactItems || "<li>No artifacts recorded</li>"}</ul>
</section>
<section>
<h2>Findings</h2>
${findingDetails || "<p>No findings recorded</p>"}
</section>
<section>
<h2>Open Questions</h2>
<ul>${questionItems || "<li>No open questions</li>"}</ul>
</section>
<section>
<h2>Dead Ends</h2>
<ul>${deadEndItems || "<li>No dead ends recorded</li>"}</ul>
</section>
<section>
<h2>Remediation Draft</h2>
<ul>${remediationItems || "<li>No remediation draft yet</li>"}</ul>
</section>
</body>
</html>
`;
}

export async function writeNotebookExport(cwd: string, doc: NotebookDocument, format: NotebookFormat, outputPath?: string): Promise<NotebookExportResult> {
	const exportDir = join(cwd, ".pire", "session", "exports");
	await mkdir(exportDir, { recursive: true });
	const stamp = doc.generatedAt.replaceAll(":", "-");
	const path =
		outputPath ??
		join(exportDir, `research-notebook-${stamp}.${format === "markdown" ? "md" : format === "json" ? "json" : "html"}`);
	const content =
		format === "markdown"
			? renderNotebookMarkdown(doc)
			: format === "json"
				? `${JSON.stringify(doc, null, 2)}\n`
				: renderNotebookHtml(doc);
	await writeFile(path, content, "utf-8");
	return { format, path };
}

function collectArtifactsForFinding(tracker: FindingsTracker, manifest: ArtifactManifest, finding: FindingRecord): ArtifactRecord[] {
	const artifactPaths = new Set<string>();
	for (const artifactId of finding.relatedArtifactIds) {
		if (artifactId.startsWith("artifact:")) {
			artifactPaths.add(artifactId.slice("artifact:".length));
		}
	}
	for (const evidenceId of finding.relatedEvidenceIds) {
		const evidence = tracker.evidence.find((record) => record.id === evidenceId);
		if (!evidence) {
			continue;
		}
		for (const artifactId of evidence.artifactIds) {
			if (artifactId.startsWith("artifact:")) {
				artifactPaths.add(artifactId.slice("artifact:".length));
			}
		}
	}
	return manifest.artifacts.filter((artifact) => artifactPaths.has(artifact.path));
}

function collectEvidenceForFinding(tracker: FindingsTracker, finding: FindingRecord) {
	return tracker.evidence.filter((record) => finding.relatedEvidenceIds.includes(record.id));
}

function collectCommandsForFinding(finding: FindingRecord, artifacts: ArtifactRecord[], evidence: FindingsTracker["evidence"]): string[] {
	const artifactCommands = artifacts.flatMap((artifact) => artifact.relatedCommands);
	const evidenceCommands = evidence
		.map((record) => record.commandId)
		.filter((commandId): commandId is string => typeof commandId === "string" && commandId.trim().length > 0);
	return dedupe([...artifactCommands, ...evidenceCommands], (command) => command);
}

export function assessReproBundle(options: Pick<GenerateReproBundleOptions, "tracker" | "manifest" | "finding">): ReproBundleAssessment {
	const artifacts = collectArtifactsForFinding(options.tracker, options.manifest, options.finding);
	const evidence = collectEvidenceForFinding(options.tracker, options.finding);
	const commands = collectCommandsForFinding(options.finding, artifacts, evidence);
	const issues: string[] = [];
	const validationNotes: string[] = [];

	if (options.finding.status !== "confirmed" && options.finding.status !== "reported") {
		issues.push(`finding ${options.finding.id} is ${options.finding.status}; repro bundles require confirmed or reported findings`);
	}
	if (evidence.length === 0) {
		issues.push(`finding ${options.finding.id} has no linked evidence records`);
	}
	if (artifacts.length === 0) {
		issues.push(`finding ${options.finding.id} has no linked artifacts`);
	}
	if (commands.length === 0) {
		issues.push(`finding ${options.finding.id} has no recorded commands`);
	}
	if (options.finding.reproStatus === "not-reproduced") {
		issues.push(`finding ${options.finding.id} is marked not-reproduced`);
	}
	if (evidence.length > 0) {
		validationNotes.push(`${evidence.length} linked evidence record(s) available`);
	}
	if (commands.length > 0) {
		validationNotes.push(`${commands.length} command reference(s) available`);
	}
	if (artifacts.length > 0) {
		validationNotes.push(`${artifacts.length} linked artifact(s) available`);
	}

	const readiness: ReproBundleReadiness =
		issues.length === 0
			? "ready"
			: options.finding.status !== "confirmed" && options.finding.status !== "reported"
				? "insufficient"
				: evidence.length === 0 || (artifacts.length === 0 && commands.length === 0)
					? "insufficient"
					: "partial";

	return {
		readiness,
		issues,
		evidenceCount: evidence.length,
		commandCount: commands.length,
		artifactCount: artifacts.length,
		bundledArtifactCount: 0,
		missingArtifactCount: 0,
		validationNotes,
	};
}

export async function generateReproBundle(options: GenerateReproBundleOptions): Promise<ReproBundleResult> {
	const relevantArtifacts = collectArtifactsForFinding(options.tracker, options.manifest, options.finding);
	const relevantEvidence = collectEvidenceForFinding(options.tracker, options.finding);
	const commands = collectCommandsForFinding(options.finding, relevantArtifacts, relevantEvidence);
	const initialAssessment = assessReproBundle(options);
	if (initialAssessment.readiness === "insufficient" && options.allowIncomplete !== true) {
		throw new ReproBundleAssessmentError(
			`Refusing repro bundle for ${options.finding.id}: ${initialAssessment.issues.join("; ")}`,
			initialAssessment,
		);
	}

	const directory = join(
		options.cwd,
		".pire",
		"session",
		"repro",
		`${options.finding.id}-${slugify(options.slug ?? options.finding.title ?? options.finding.id)}`,
	);
	await mkdir(directory, { recursive: true });
	const inputsDir = join(directory, "inputs");
	await mkdir(inputsDir, { recursive: true });

	const copiedFiles: ReproBundleFile[] = [];
	for (const artifact of relevantArtifacts) {
		let bundledPath: string | undefined;
		let status: ReproBundleFile["status"] = "referenced";
		try {
			const artifactStat = await stat(artifact.path);
			if (artifactStat.isFile() && artifactStat.size <= 1_000_000) {
				bundledPath = join(inputsDir, basename(artifact.path));
				await copyFile(artifact.path, bundledPath);
				status = "bundled";
			}
		} catch {
			status = "missing";
		}
		copiedFiles.push({
			sourcePath: artifact.path,
			bundledPath,
			type: artifact.type,
			status,
		});
	}

	const bundledArtifactCount = copiedFiles.filter((file) => file.status === "bundled").length;
	const missingArtifactCount = copiedFiles.filter((file) => file.status === "missing").length;
	const assessment: ReproBundleAssessment = {
		...initialAssessment,
		bundledArtifactCount,
		missingArtifactCount,
		readiness:
			initialAssessment.readiness === "insufficient"
				? "insufficient"
				: initialAssessment.issues.length === 0 && missingArtifactCount === 0
					? "ready"
					: "partial",
		issues:
			missingArtifactCount > 0
				? [...initialAssessment.issues, `${missingArtifactCount} linked artifact(s) were missing at bundle time`]
				: initialAssessment.issues,
		validationNotes:
			bundledArtifactCount > 0
				? [...initialAssessment.validationNotes, `${bundledArtifactCount} artifact(s) copied into the bundle`]
				: initialAssessment.validationNotes,
	};
	if (assessment.readiness === "insufficient" && options.allowIncomplete !== true) {
		throw new ReproBundleAssessmentError(
			`Refusing repro bundle for ${options.finding.id}: ${assessment.issues.join("; ")}`,
			assessment,
		);
	}

	const manifestPath = join(directory, "manifest.json");
	const readmePath = join(directory, "README.md");
	const commandsPath = join(directory, "commands.sh");
	const environmentPath = join(directory, "environment.json");
	const artifactsPath = join(directory, "artifacts.json");

	const bundleManifest = {
		generatedAt: new Date().toISOString(),
		mode: options.mode,
		role: options.role,
		sessionType: options.sessionType,
		safety: options.safety,
		finding: options.finding,
		commands,
		files: copiedFiles,
		assessment,
		evidence: relevantEvidence,
		expectedOutcome: options.finding.statement,
		prerequisites: options.inventory
			? {
					platform: options.inventory.platform,
					arch: options.inventory.arch,
					availableTools: options.inventory.tools.filter((tool) => tool.available).map((tool) => tool.name),
				}
			: undefined,
	};
	await writeFile(manifestPath, `${JSON.stringify(bundleManifest, null, 2)}\n`, "utf-8");
	await writeFile(environmentPath, `${JSON.stringify(options.inventory ?? null, null, 2)}\n`, "utf-8");
	await writeFile(artifactsPath, `${JSON.stringify(relevantArtifacts, null, 2)}\n`, "utf-8");
	await writeFile(
		commandsPath,
		`#!/usr/bin/env bash
set -eu

# Reproduction commands for ${options.finding.id} ${options.finding.title}
${commands.length > 0 ? commands.join("\n") : "# No exact commands were captured for this finding yet."}
`,
		"utf-8",
	);
	await writeFile(
		readmePath,
		`# Repro Bundle: ${options.finding.id} ${options.finding.title}

Statement: ${options.finding.statement}
Severity: ${options.finding.severity}
Status: ${options.finding.status}
Reproduction: ${options.finding.reproStatus}

Readiness: ${assessment.readiness}

## Expected Outcome

Reproduce or validate the behavior described above with the referenced commands and artifacts.

## Completeness

${assessment.issues.map((issue) => `- ${issue}`).join("\n") || "- bundle is ready"}

## Validation Notes

${assessment.validationNotes.map((note) => `- ${note}`).join("\n") || "- no validation notes"}

## Evidence

${options.finding.relatedEvidenceIds.map((id) => `- ${id}`).join("\n") || "- none linked"}

## Commands

${commands.map((command) => `- \`${command}\``).join("\n") || "- none captured"}

## Referenced Artifacts

${copiedFiles.map((file) => `- ${file.sourcePath} [${file.status}]${file.bundledPath ? ` -> ${file.bundledPath}` : ""}`).join("\n") || "- none linked"}
`,
		"utf-8",
	);

	return {
		directory,
		readmePath,
		manifestPath,
		commandsPath,
		environmentPath,
		artifactsPath,
		files: copiedFiles,
		assessment,
	};
}

export function inferArtifactTypeFromExportPath(path: string): ArtifactType {
	const extension = extname(path).toLowerCase();
	if (extension === ".html" || extension === ".md") {
		return "report";
	}
	if (extension === ".json") {
		return "json";
	}
	return "text";
}
