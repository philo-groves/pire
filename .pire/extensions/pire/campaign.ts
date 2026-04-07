import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ArtifactRecord } from "./artifacts.js";
import type { FindingRecord, FindingsTracker } from "./findings.js";

export type CampaignFindingStatus = "lead" | "confirmed" | "submitted" | "de-escalated" | "blocked";

export interface CampaignFindingRecord {
	id: string;
	title: string;
	status: CampaignFindingStatus;
	summary: string;
	note?: string;
	reportPaths: string[];
	linkedSessionFindingIds: string[];
	relatedEvidenceIds: string[];
	relatedArtifactIds: string[];
	createdAt: string;
	updatedAt: string;
	lastSyncedAt?: string;
}

export interface CampaignJournalEntry {
	id: string;
	timestamp: string;
	findingId?: string;
	action: "create" | "sync" | "status" | "report";
	summary: string;
	details?: string;
}

export interface CampaignLedger {
	version: 1;
	updatedAt: string;
	findings: CampaignFindingRecord[];
	nextIds: {
		journal: number;
	};
}

export interface CampaignLedgerSummary {
	totalFindings: number;
	leadFindings: number;
	confirmedFindings: number;
	submittedFindings: number;
	deEscalatedFindings: number;
	blockedFindings: number;
	recentFindings: string[];
}

export interface CampaignSyncInput {
	finding: FindingRecord;
	tracker: FindingsTracker;
	artifacts?: ArtifactRecord[];
	timestamp?: string;
}

export interface CampaignStatusUpdateInput {
	id: string;
	status: CampaignFindingStatus;
	note: string;
	timestamp?: string;
}

export interface CampaignReportPathInput {
	id: string;
	path: string;
	timestamp?: string;
}

const CAMPAIGN_DIR = ".pire";
const CAMPAIGN_JSON_FILE = "campaign.json";
const CAMPAIGN_STATUS_FILE = "STATUS.md";
const CAMPAIGN_JOURNAL_DIR = "journal";

function dedupe(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
}

function createTimestamp(timestamp?: string): string {
	return timestamp ?? new Date().toISOString();
}

function createJournalId(value: number): string {
	return `journal-${String(value).padStart(4, "0")}`;
}

function statusRank(status: CampaignFindingStatus): number {
	switch (status) {
		case "lead":
			return 1;
		case "confirmed":
			return 2;
		case "submitted":
			return 3;
		case "de-escalated":
		case "blocked":
			return 99;
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function normalizeCampaignFindingStatus(value: unknown): CampaignFindingStatus {
	return value === "confirmed" ||
		value === "submitted" ||
		value === "de-escalated" ||
		value === "blocked"
		? value
		: "lead";
}

function normalizeCampaignFinding(value: unknown): CampaignFindingRecord | undefined {
	if (!isPlainObject(value) || typeof value.id !== "string" || typeof value.title !== "string" || typeof value.summary !== "string") {
		return undefined;
	}

	return {
		id: value.id,
		title: value.title,
		status: normalizeCampaignFindingStatus(value.status),
		summary: value.summary,
		note: typeof value.note === "string" ? value.note : undefined,
		reportPaths: dedupe(toStringArray(value.reportPaths)),
		linkedSessionFindingIds: dedupe(toStringArray(value.linkedSessionFindingIds)),
		relatedEvidenceIds: dedupe(toStringArray(value.relatedEvidenceIds)),
		relatedArtifactIds: dedupe(toStringArray(value.relatedArtifactIds)),
		createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
		updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
		lastSyncedAt: typeof value.lastSyncedAt === "string" ? value.lastSyncedAt : undefined,
	};
}

function normalizeLedger(value: unknown): CampaignLedger {
	if (!isPlainObject(value)) {
		return createEmptyCampaignLedger();
	}

	const findings = Array.isArray(value.findings) ? value.findings.map(normalizeCampaignFinding).filter((entry): entry is CampaignFindingRecord => entry !== undefined) : [];
	const nextIds = isPlainObject(value.nextIds) ? value.nextIds : {};

	return {
		version: 1,
		updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
		findings,
		nextIds: {
			journal: typeof nextIds.journal === "number" && nextIds.journal > 0 ? nextIds.journal : 1,
		},
	};
}

function findArtifactsForFinding(tracker: FindingsTracker, artifacts: ArtifactRecord[], finding: FindingRecord): string[] {
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
	return dedupe([...artifactPaths, ...artifacts.filter((artifact) => artifact.relatedFindings.includes(finding.id)).map((artifact) => artifact.path)]);
}

export function createEmptyCampaignLedger(): CampaignLedger {
	return {
		version: 1,
		updatedAt: new Date().toISOString(),
		findings: [],
		nextIds: {
			journal: 1,
		},
	};
}

export function mapFindingStatusToCampaignStatus(finding: FindingRecord): CampaignFindingStatus {
	switch (finding.status) {
		case "confirmed":
			return "confirmed";
		case "reported":
			return "submitted";
		default:
			return "lead";
	}
}

export async function loadCampaignLedger(cwd: string): Promise<CampaignLedger> {
	const ledgerPath = join(cwd, CAMPAIGN_DIR, CAMPAIGN_JSON_FILE);
	if (!existsSync(ledgerPath)) {
		return createEmptyCampaignLedger();
	}

	try {
		const raw = await readFile(ledgerPath, "utf-8");
		return normalizeLedger(JSON.parse(raw));
	} catch {
		return createEmptyCampaignLedger();
	}
}

export async function saveCampaignLedger(
	cwd: string,
	ledger: CampaignLedger,
): Promise<{ jsonPath: string; statusPath: string }> {
	const campaignDir = join(cwd, CAMPAIGN_DIR);
	const jsonPath = join(campaignDir, CAMPAIGN_JSON_FILE);
	const statusPath = join(campaignDir, CAMPAIGN_STATUS_FILE);
	await mkdir(campaignDir, { recursive: true });
	await writeFile(jsonPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf-8");
	await writeFile(statusPath, renderCampaignStatusMarkdown(ledger), "utf-8");
	return { jsonPath, statusPath };
}

export async function appendCampaignJournalEntry(
	cwd: string,
	ledger: CampaignLedger,
	entry: Omit<CampaignJournalEntry, "id" | "timestamp"> & { timestamp?: string },
): Promise<{ path: string; entry: CampaignJournalEntry }> {
	const timestamp = createTimestamp(entry.timestamp);
	const journalEntry: CampaignJournalEntry = {
		id: createJournalId(ledger.nextIds.journal++),
		timestamp,
		findingId: entry.findingId,
		action: entry.action,
		summary: entry.summary.trim(),
		details: entry.details?.trim() || undefined,
	};
	const journalDir = join(cwd, CAMPAIGN_DIR, CAMPAIGN_JOURNAL_DIR);
	const date = timestamp.slice(0, 10);
	const path = join(journalDir, `${date}.md`);
	await mkdir(journalDir, { recursive: true });
	const previous = existsSync(path) ? await readFile(path, "utf-8") : "";
	const lines = [
		`## ${journalEntry.timestamp} ${journalEntry.id}`,
		`- action: ${journalEntry.action}`,
		journalEntry.findingId ? `- finding: ${journalEntry.findingId}` : undefined,
		`- summary: ${journalEntry.summary}`,
		journalEntry.details ? `- details: ${journalEntry.details}` : undefined,
		"",
	].filter((line): line is string => line !== undefined);
	const content = previous.length > 0 ? `${previous.trimEnd()}\n\n${lines.join("\n")}\n` : `# Pire Campaign Journal\n\n${lines.join("\n")}\n`;
	await writeFile(path, content, "utf-8");
	return { path, entry: journalEntry };
}

export function buildCampaignLedgerSummary(ledger: CampaignLedger): CampaignLedgerSummary {
	const leadFindings = ledger.findings.filter((record) => record.status === "lead");
	const confirmedFindings = ledger.findings.filter((record) => record.status === "confirmed");
	const submittedFindings = ledger.findings.filter((record) => record.status === "submitted");
	const deEscalatedFindings = ledger.findings.filter((record) => record.status === "de-escalated");
	const blockedFindings = ledger.findings.filter((record) => record.status === "blocked");

	return {
		totalFindings: ledger.findings.length,
		leadFindings: leadFindings.length,
		confirmedFindings: confirmedFindings.length,
		submittedFindings: submittedFindings.length,
		deEscalatedFindings: deEscalatedFindings.length,
		blockedFindings: blockedFindings.length,
		recentFindings: [...ledger.findings]
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
			.slice(0, 4)
			.map((record) => `${record.id} ${record.title}`),
	};
}

export function summarizeCampaignLedger(ledger: CampaignLedger, filterText?: string): string {
	const normalizedFilter = filterText?.trim().toLowerCase() ?? "";
	const summary = buildCampaignLedgerSummary(ledger);
	const findings = ledger.findings.filter((record) => {
		if (normalizedFilter.length === 0) {
			return true;
		}
		return (
			record.id.toLowerCase().includes(normalizedFilter) ||
			record.title.toLowerCase().includes(normalizedFilter) ||
			record.summary.toLowerCase().includes(normalizedFilter) ||
			(record.note ?? "").toLowerCase().includes(normalizedFilter) ||
			record.status.toLowerCase().includes(normalizedFilter)
		);
	});

	const lines = [
		"Pire Campaign Ledger",
		`- updated: ${ledger.updatedAt}`,
		`- findings: ${summary.totalFindings}`,
		`- lead: ${summary.leadFindings}`,
		`- confirmed: ${summary.confirmedFindings}`,
		`- submitted: ${summary.submittedFindings}`,
		`- de-escalated: ${summary.deEscalatedFindings}`,
		`- blocked: ${summary.blockedFindings}`,
	];

	if (normalizedFilter.length > 0) {
		lines.push(`- filter: ${normalizedFilter}`);
	}

	if (findings.length === 0) {
		lines.push("- no matching campaign findings");
		return lines.join("\n");
	}

	lines.push("Findings:");
	for (const record of findings.slice(0, 8)) {
		lines.push(`- ${record.id} [${record.status}] ${record.title}`);
		if (record.note) {
			lines.push(`  note: ${record.note}`);
		}
	}
	return lines.join("\n");
}

export function renderCampaignDetail(ledger: CampaignLedger, id: string): string {
	const record = ledger.findings.find((entry) => entry.id === id);
	if (!record) {
		return `Pire Campaign Record\n- unknown id: ${id}`;
	}

	const lines = [
		"Pire Campaign Record",
		`- id: ${record.id}`,
		`- title: ${record.title}`,
		`- status: ${record.status}`,
		`- summary: ${record.summary}`,
		`- updated: ${record.updatedAt}`,
	];
	if (record.note) {
		lines.push(`- note: ${record.note}`);
	}
	if (record.reportPaths.length > 0) {
		lines.push("Report Paths:");
		for (const path of record.reportPaths) {
			lines.push(`- ${path}`);
		}
	}
	if (record.linkedSessionFindingIds.length > 0) {
		lines.push("Linked Session Findings:");
		for (const linkedId of record.linkedSessionFindingIds) {
			lines.push(`- ${linkedId}`);
		}
	}
	if (record.relatedEvidenceIds.length > 0) {
		lines.push("Evidence:");
		for (const evidenceId of record.relatedEvidenceIds) {
			lines.push(`- ${evidenceId}`);
		}
	}
	if (record.relatedArtifactIds.length > 0) {
		lines.push("Artifacts:");
		for (const artifactId of record.relatedArtifactIds) {
			lines.push(`- ${artifactId}`);
		}
	}
	return lines.join("\n");
}

export function buildCampaignPromptSummary(ledger: CampaignLedger): string | undefined {
	if (ledger.findings.length === 0) {
		return undefined;
	}
	const summary = buildCampaignLedgerSummary(ledger);
	const lines = [
		"[PIRE CAMPAIGN]",
		`Campaign findings: ${summary.totalFindings}; lead: ${summary.leadFindings}; confirmed: ${summary.confirmedFindings}; submitted: ${summary.submittedFindings}; de-escalated: ${summary.deEscalatedFindings}; blocked: ${summary.blockedFindings}.`,
	];
	const activeClosed = ledger.findings
		.filter((record) => record.status === "de-escalated" || record.status === "blocked")
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
		.slice(0, 2);
	if (activeClosed.length > 0) {
		lines.push("Do not reopen without new evidence:");
		for (const record of activeClosed) {
			lines.push(`- ${record.id} [${record.status}] ${record.title}${record.note ? ` :: ${record.note}` : ""}`);
		}
	}
	const activeOpen = ledger.findings
		.filter((record) => record.status === "lead" || record.status === "confirmed")
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
		.slice(0, 3);
	if (activeOpen.length > 0) {
		lines.push("Current campaign leads:");
		for (const record of activeOpen) {
			lines.push(`- ${record.id} [${record.status}] ${record.title}`);
		}
	}
	return lines.join("\n");
}

export function upsertCampaignFinding(
	ledger: CampaignLedger,
	input: CampaignSyncInput,
): { record: CampaignFindingRecord; created: boolean; statusChanged: boolean } {
	const timestamp = createTimestamp(input.timestamp);
	const nextStatus = mapFindingStatusToCampaignStatus(input.finding);
	const relatedArtifactIds = findArtifactsForFinding(input.tracker, input.artifacts ?? [], input.finding);
	const existing = ledger.findings.find((record) => record.id === input.finding.id);
	if (!existing) {
		const record: CampaignFindingRecord = {
			id: input.finding.id,
			title: input.finding.title,
			status: nextStatus,
			summary: input.finding.statement,
			reportPaths: [],
			linkedSessionFindingIds: [input.finding.id],
			relatedEvidenceIds: dedupe(input.finding.relatedEvidenceIds),
			relatedArtifactIds,
			createdAt: timestamp,
			updatedAt: timestamp,
			lastSyncedAt: timestamp,
		};
		ledger.findings.push(record);
		ledger.updatedAt = timestamp;
		return { record, created: true, statusChanged: false };
	}

	const previousStatus = existing.status;
	existing.title = input.finding.title;
	existing.summary = input.finding.statement;
	existing.linkedSessionFindingIds = dedupe([...existing.linkedSessionFindingIds, input.finding.id]);
	existing.relatedEvidenceIds = dedupe([...existing.relatedEvidenceIds, ...input.finding.relatedEvidenceIds]);
	existing.relatedArtifactIds = dedupe([...existing.relatedArtifactIds, ...relatedArtifactIds]);
	existing.lastSyncedAt = timestamp;
	if (
		existing.status !== "de-escalated" &&
		existing.status !== "blocked" &&
		statusRank(nextStatus) >= statusRank(existing.status)
	) {
		existing.status = nextStatus;
	}
	existing.updatedAt = timestamp;
	ledger.updatedAt = timestamp;
	return { record: existing, created: false, statusChanged: existing.status !== previousStatus };
}

export function updateCampaignFindingStatus(
	ledger: CampaignLedger,
	input: CampaignStatusUpdateInput,
): CampaignFindingRecord | undefined {
	const record = ledger.findings.find((entry) => entry.id === input.id);
	if (!record) {
		return undefined;
	}
	const timestamp = createTimestamp(input.timestamp);
	record.status = input.status;
	record.note = input.note.trim();
	record.updatedAt = timestamp;
	ledger.updatedAt = timestamp;
	return record;
}

export function addCampaignReportPath(
	ledger: CampaignLedger,
	input: CampaignReportPathInput,
): CampaignFindingRecord | undefined {
	const record = ledger.findings.find((entry) => entry.id === input.id);
	if (!record) {
		return undefined;
	}
	const timestamp = createTimestamp(input.timestamp);
	record.reportPaths = dedupe([...record.reportPaths, input.path]);
	record.updatedAt = timestamp;
	ledger.updatedAt = timestamp;
	return record;
}

export function renderCampaignStatusMarkdown(ledger: CampaignLedger): string {
	const lines = [
		"# Pire Campaign Status",
		"",
		"Mutable canonical state for long-lived research findings. Journal entries live under `.pire/journal/`.",
		"",
		"| ID | Title | Status | Summary | Note | Reports | Updated |",
		"|----|-------|--------|---------|------|---------|---------|",
	];

	const findings = [...ledger.findings].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	if (findings.length === 0) {
		lines.push("| - | - | - | No campaign findings yet | - | - | - |");
	} else {
		for (const record of findings) {
			lines.push(
				`| ${record.id} | ${record.title.replaceAll("|", "\\|")} | ${record.status} | ${record.summary.replaceAll("|", "\\|")} | ${(record.note ?? "").replaceAll("|", "\\|")} | ${record.reportPaths
					.map((path) => basename(path))
					.join(", ")
					.replaceAll("|", "\\|")} | ${record.updatedAt} |`,
			);
		}
	}
	return `${lines.join("\n").trimEnd()}\n`;
}
