import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ArtifactRecord } from "./artifacts.js";
import type { FindingRecord, FindingsTracker } from "./findings.js";

export type CampaignFindingStatus = "lead" | "confirmed" | "submitted" | "de-escalated" | "blocked";
export type CampaignChainStatus = "active" | "parked" | "closed";

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

export interface CampaignChainRecord {
	id: string;
	title: string;
	summary: string;
	status: CampaignChainStatus;
	findingIds: string[];
	note?: string;
	createdAt: string;
	updatedAt: string;
}

export interface CampaignJournalEntry {
	id: string;
	timestamp: string;
	findingId?: string;
	chainId?: string;
	action: "create" | "sync" | "status" | "report" | "chain";
	summary: string;
	details?: string;
}

export interface CampaignLedger {
	version: 1;
	updatedAt: string;
	findings: CampaignFindingRecord[];
	chains: CampaignChainRecord[];
	nextIds: {
		journal: number;
		chain: number;
	};
}

export interface CampaignLedgerSummary {
	totalFindings: number;
	leadFindings: number;
	confirmedFindings: number;
	submittedFindings: number;
	deEscalatedFindings: number;
	blockedFindings: number;
	totalChains: number;
	activeChains: number;
	parkedChains: number;
	closedChains: number;
	recentFindings: string[];
	recentChains: string[];
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

export interface CampaignChainCreateInput {
	title: string;
	summary: string;
	status?: CampaignChainStatus;
	findingIds?: string[];
	note?: string;
	timestamp?: string;
}

export interface CampaignChainUpdateInput {
	id: string;
	title?: string;
	summary?: string;
	status?: CampaignChainStatus;
	findingIds?: string[];
	addFindingIds?: string[];
	removeFindingIds?: string[];
	note?: string;
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

function createChainId(value: number): string {
	return `chain-${String(value).padStart(3, "0")}`;
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

function normalizeCampaignChainStatus(value: unknown): CampaignChainStatus {
	return value === "parked" || value === "closed" ? value : "active";
}

function normalizeCampaignChain(value: unknown): CampaignChainRecord | undefined {
	if (!isPlainObject(value) || typeof value.id !== "string" || typeof value.title !== "string" || typeof value.summary !== "string") {
		return undefined;
	}

	return {
		id: value.id,
		title: value.title,
		summary: value.summary,
		status: normalizeCampaignChainStatus(value.status),
		findingIds: dedupe(toStringArray(value.findingIds)),
		note: typeof value.note === "string" ? value.note : undefined,
		createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
		updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
	};
}

function normalizeLedger(value: unknown): CampaignLedger {
	if (!isPlainObject(value)) {
		return createEmptyCampaignLedger();
	}

	const findings = Array.isArray(value.findings) ? value.findings.map(normalizeCampaignFinding).filter((entry): entry is CampaignFindingRecord => entry !== undefined) : [];
	const chains = Array.isArray(value.chains) ? value.chains.map(normalizeCampaignChain).filter((entry): entry is CampaignChainRecord => entry !== undefined) : [];
	const nextIds = isPlainObject(value.nextIds) ? value.nextIds : {};

	return {
		version: 1,
		updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
		findings,
		chains,
		nextIds: {
			journal: typeof nextIds.journal === "number" && nextIds.journal > 0 ? nextIds.journal : 1,
			chain: typeof nextIds.chain === "number" && nextIds.chain > 0 ? nextIds.chain : 1,
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
		chains: [],
		nextIds: {
			journal: 1,
			chain: 1,
		},
	};
}

export function mapFindingStatusToCampaignStatus(finding: FindingRecord): CampaignFindingStatus {
	switch (finding.status) {
		case "confirmed":
		case "report-candidate":
			return "confirmed";
		case "reported":
			return "submitted";
		case "de-escalated":
		case "closed":
			return "de-escalated";
		case "lead":
		case "active":
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
		chainId: entry.chainId,
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
		journalEntry.chainId ? `- chain: ${journalEntry.chainId}` : undefined,
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
	const activeChains = ledger.chains.filter((record) => record.status === "active");
	const parkedChains = ledger.chains.filter((record) => record.status === "parked");
	const closedChains = ledger.chains.filter((record) => record.status === "closed");

	return {
		totalFindings: ledger.findings.length,
		leadFindings: leadFindings.length,
		confirmedFindings: confirmedFindings.length,
		submittedFindings: submittedFindings.length,
		deEscalatedFindings: deEscalatedFindings.length,
		blockedFindings: blockedFindings.length,
		totalChains: ledger.chains.length,
		activeChains: activeChains.length,
		parkedChains: parkedChains.length,
		closedChains: closedChains.length,
		recentFindings: [...ledger.findings]
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
			.slice(0, 4)
			.map((record) => `${record.id} ${record.title}`),
		recentChains: [...ledger.chains]
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
	const chains = ledger.chains.filter((record) => {
		if (normalizedFilter.length === 0) {
			return true;
		}
		return (
			record.id.toLowerCase().includes(normalizedFilter) ||
			record.title.toLowerCase().includes(normalizedFilter) ||
			record.summary.toLowerCase().includes(normalizedFilter) ||
			(record.note ?? "").toLowerCase().includes(normalizedFilter) ||
			record.status.toLowerCase().includes(normalizedFilter) ||
			record.findingIds.some((findingId) => findingId.toLowerCase().includes(normalizedFilter))
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
		`- chains: ${summary.totalChains} (${summary.activeChains} active, ${summary.parkedChains} parked, ${summary.closedChains} closed)`,
	];

	if (normalizedFilter.length > 0) {
		lines.push(`- filter: ${normalizedFilter}`);
	}

	if (findings.length === 0 && chains.length === 0) {
		lines.push("- no matching campaign records");
		return lines.join("\n");
	}

	if (findings.length > 0) {
		lines.push("Findings:");
		for (const record of findings.slice(0, 8)) {
			lines.push(`- ${record.id} [${record.status}] ${record.title}`);
			if (record.note) {
				lines.push(`  note: ${record.note}`);
			}
		}
	}
	if (chains.length > 0) {
		lines.push("Chains:");
		for (const record of chains.slice(0, 6)) {
			lines.push(`- ${record.id} [${record.status}] ${record.title} (${record.findingIds.length} findings)`);
			if (record.note) {
				lines.push(`  note: ${record.note}`);
			}
		}
	}
	return lines.join("\n");
}

export function summarizeOpenCampaignLedger(ledger: CampaignLedger): string {
	const summary = buildCampaignLedgerSummary(ledger);
	const openFindings = ledger.findings
		.filter((record) => record.status === "lead" || record.status === "confirmed" || record.status === "submitted")
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	const activeChains = ledger.chains
		.filter((record) => record.status === "active" || record.status === "parked")
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	const lines = [
		"Pire Campaign Open Work",
		`- open findings: ${openFindings.length}`,
		`- active or parked chains: ${activeChains.length}`,
	];
	if (openFindings.length === 0 && activeChains.length === 0) {
		lines.push("- no open campaign work");
		return lines.join("\n");
	}
	if (openFindings.length > 0) {
		lines.push("Findings:");
		for (const record of openFindings.slice(0, 8)) {
			lines.push(`- ${record.id} [${record.status}] ${record.title}`);
		}
	}
	if (activeChains.length > 0) {
		lines.push("Chains:");
		for (const record of activeChains.slice(0, 6)) {
			lines.push(`- ${record.id} [${record.status}] ${record.title}`);
		}
	}
	return lines.join("\n");
}

export function summarizeRecentCampaignLedger(ledger: CampaignLedger): string {
	const recentFindings = [...ledger.findings].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 6);
	const recentChains = [...ledger.chains].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 4);
	const lines = ["Pire Campaign Recent Activity", `- updated: ${ledger.updatedAt}`];
	if (recentFindings.length === 0 && recentChains.length === 0) {
		lines.push("- no campaign records yet");
		return lines.join("\n");
	}
	if (recentFindings.length > 0) {
		lines.push("Recent Findings:");
		for (const record of recentFindings) {
			lines.push(`- ${record.id} [${record.status}] ${record.title}`);
		}
	}
	if (recentChains.length > 0) {
		lines.push("Recent Chains:");
		for (const record of recentChains) {
			lines.push(`- ${record.id} [${record.status}] ${record.title}`);
		}
	}
	return lines.join("\n");
}

export function summarizeCampaignChains(ledger: CampaignLedger, filterText?: string): string {
	const normalizedFilter = filterText?.trim().toLowerCase() ?? "";
	const chains = ledger.chains.filter((record) => {
		if (normalizedFilter.length === 0) {
			return true;
		}
		return (
			record.id.toLowerCase().includes(normalizedFilter) ||
			record.title.toLowerCase().includes(normalizedFilter) ||
			record.summary.toLowerCase().includes(normalizedFilter) ||
			(record.note ?? "").toLowerCase().includes(normalizedFilter) ||
			record.status.toLowerCase().includes(normalizedFilter) ||
			record.findingIds.some((findingId) => findingId.toLowerCase().includes(normalizedFilter))
		);
	});
	const lines = [
		"Pire Campaign Chains",
		`- updated: ${ledger.updatedAt}`,
		`- chains: ${ledger.chains.length}`,
	];
	if (normalizedFilter.length > 0) {
		lines.push(`- filter: ${normalizedFilter}`);
	}
	if (chains.length === 0) {
		lines.push("- no matching campaign chains");
		return lines.join("\n");
	}
	for (const record of chains.slice(0, 8)) {
		lines.push(`- ${record.id} [${record.status}] ${record.title} (${record.findingIds.length} findings)`);
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
	const chains = ledger.chains.filter((entry) => entry.findingIds.includes(record.id));
	if (chains.length > 0) {
		lines.push("Chains:");
		for (const chain of chains) {
			lines.push(`- ${chain.id} [${chain.status}] ${chain.title}`);
		}
	}
	return lines.join("\n");
}

export function renderCampaignChainDetail(ledger: CampaignLedger, id: string): string {
	const record = ledger.chains.find((entry) => entry.id === id);
	if (!record) {
		return `Pire Campaign Chain\n- unknown id: ${id}`;
	}

	const lines = [
		"Pire Campaign Chain",
		`- id: ${record.id}`,
		`- title: ${record.title}`,
		`- status: ${record.status}`,
		`- summary: ${record.summary}`,
		`- updated: ${record.updatedAt}`,
	];
	if (record.note) {
		lines.push(`- note: ${record.note}`);
	}
	if (record.findingIds.length > 0) {
		lines.push("Findings:");
		for (const findingId of record.findingIds) {
			const finding = ledger.findings.find((entry) => entry.id === findingId);
			lines.push(`- ${findingId}${finding ? ` [${finding.status}] ${finding.title}` : ""}`);
		}
	}
	return lines.join("\n");
}

export function buildCampaignPromptSummary(ledger: CampaignLedger): string | undefined {
	if (ledger.findings.length === 0 && ledger.chains.length === 0) {
		return undefined;
	}
	const summary = buildCampaignLedgerSummary(ledger);
	const lines = [
		"[PIRE CAMPAIGN]",
		`Campaign findings: ${summary.totalFindings}; lead: ${summary.leadFindings}; confirmed: ${summary.confirmedFindings}; submitted: ${summary.submittedFindings}; de-escalated: ${summary.deEscalatedFindings}; blocked: ${summary.blockedFindings}.`,
		`Campaign chains: ${summary.totalChains}; active: ${summary.activeChains}; parked: ${summary.parkedChains}; closed: ${summary.closedChains}.`,
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
	const activeChains = ledger.chains
		.filter((record) => record.status === "active" || record.status === "parked")
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
		.slice(0, 3);
	if (activeChains.length > 0) {
		lines.push("Current chains:");
		for (const record of activeChains) {
			lines.push(`- ${record.id} [${record.status}] ${record.title} (${record.findingIds.join(", ") || "no findings linked"})`);
		}
	}
	return lines.join("\n");
}

export function campaignStatusRequiresNote(status: CampaignFindingStatus): boolean {
	return status === "blocked" || status === "de-escalated";
}

export function validateCampaignStatusNote(status: CampaignFindingStatus, note?: string): string | undefined {
	if (campaignStatusRequiresNote(status) && !note?.trim()) {
		return `${status} transitions require a note`;
	}
	return undefined;
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
	record.note = input.note.trim() || record.note;
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

export function createCampaignChain(ledger: CampaignLedger, input: CampaignChainCreateInput): CampaignChainRecord {
	const timestamp = createTimestamp(input.timestamp);
	const record: CampaignChainRecord = {
		id: createChainId(ledger.nextIds.chain++),
		title: input.title.trim(),
		summary: input.summary.trim(),
		status: input.status ?? "active",
		findingIds: dedupe(input.findingIds ?? []),
		note: input.note?.trim() || undefined,
		createdAt: timestamp,
		updatedAt: timestamp,
	};
	ledger.chains.push(record);
	ledger.updatedAt = timestamp;
	return record;
}

export function updateCampaignChain(
	ledger: CampaignLedger,
	input: CampaignChainUpdateInput,
): CampaignChainRecord | undefined {
	const record = ledger.chains.find((entry) => entry.id === input.id);
	if (!record) {
		return undefined;
	}
	const timestamp = createTimestamp(input.timestamp);
	if (input.title?.trim()) {
		record.title = input.title.trim();
	}
	if (input.summary?.trim()) {
		record.summary = input.summary.trim();
	}
	if (input.status) {
		record.status = input.status;
	}
	if (input.findingIds) {
		record.findingIds = dedupe(input.findingIds);
	}
	if (input.addFindingIds || input.removeFindingIds) {
		record.findingIds = dedupe(
			record.findingIds
				.filter((findingId) => !input.removeFindingIds?.includes(findingId))
				.concat(input.addFindingIds ?? []),
		);
	}
	if (input.note !== undefined) {
		record.note = input.note.trim() || undefined;
	}
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
	lines.push("", "## Chains", "", "| ID | Title | Status | Findings | Note | Updated |", "|----|-------|--------|----------|------|---------|");
	const chains = [...ledger.chains].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	if (chains.length === 0) {
		lines.push("| - | - | - | No campaign chains yet | - | - |");
	} else {
		for (const record of chains) {
			lines.push(
				`| ${record.id} | ${record.title.replaceAll("|", "\\|")} | ${record.status} | ${record.findingIds.join(", ").replaceAll("|", "\\|")} | ${(record.note ?? "").replaceAll("|", "\\|")} | ${record.updatedAt} |`,
			);
		}
	}
	return `${lines.join("\n").trimEnd()}\n`;
}
