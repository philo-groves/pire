import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export type HypothesisStatus = "open" | "supported" | "refuted" | "needs-more-evidence";
export type FindingStatus = "lead" | "active" | "de-escalated" | "report-candidate" | "confirmed" | "reported" | "closed";

const VALID_FINDING_STATUSES = new Set<FindingStatus>(["lead", "active", "de-escalated", "report-candidate", "confirmed", "reported", "closed"]);

function normalizeFindingStatus(value: unknown): FindingStatus {
	if (typeof value === "string") {
		if (value === "candidate") return "lead";
		if (VALID_FINDING_STATUSES.has(value as FindingStatus)) return value as FindingStatus;
	}
	return "lead";
}
export type QuestionStatus = "open" | "answered" | "blocked";
export type Confidence = "low" | "medium" | "high";
export type Severity = "low" | "medium" | "high" | "critical";
export type ReproStatus = "not-reproduced" | "partial" | "reproduced";
export type EvidenceKind = "tool-result" | "observation" | "trace" | "artifact" | "note";

export interface HypothesisRecord {
	id: string;
	title: string;
	status: HypothesisStatus;
	claim: string;
	rationale?: string;
	relatedEvidenceIds: string[];
	relatedArtifactIds: string[];
	relatedQuestionIds: string[];
	confidence: Confidence;
	createdAt: string;
	updatedAt: string;
}

export interface FindingRecord {
	id: string;
	title: string;
	status: FindingStatus;
	severity: Severity;
	statement: string;
	basis: string[];
	relatedEvidenceIds: string[];
	relatedArtifactIds: string[];
	reproStatus: ReproStatus;
	createdAt: string;
	updatedAt: string;
	surface?: string;
	sourceRefs?: string[];
	reachability?: string;
	validationStatus?: string;
	nextStep?: string;
	keyArtifacts?: string[];
}

export interface QuestionRecord {
	id: string;
	prompt: string;
	status: QuestionStatus;
	owner?: string;
	relatedEvidenceIds: string[];
	blockedOn: string[];
	createdAt: string;
	updatedAt: string;
}

export interface EvidenceRecord {
	id: string;
	kind: EvidenceKind;
	summary: string;
	commandId?: string;
	artifactIds: string[];
	supports: string[];
	refutes: string[];
	createdAt: string;
}

export interface DeadEndRecord {
	id: string;
	summary: string;
	whyItFailed?: string;
	artifactsChecked: string[];
	doNotRepeatUntil?: string;
	createdAt: string;
}

export interface FindingsTracker {
	version: 1;
	updatedAt: string;
	hypotheses: HypothesisRecord[];
	findings: FindingRecord[];
	questions: QuestionRecord[];
	evidence: EvidenceRecord[];
	deadEnds: DeadEndRecord[];
	nextIds: {
		hypothesis: number;
		finding: number;
		question: number;
		evidence: number;
		deadEnd: number;
	};
}

export interface FindingsTrackerSummary {
	totalHypotheses: number;
	openHypotheses: number;
	supportedHypotheses: number;
	refutedHypotheses: number;
	totalFindings: number;
	/** @deprecated Use leadFindings instead */
	candidateFindings: number;
	leadFindings: number;
	activeFindings: number;
	deEscalatedFindings: number;
	reportCandidateFindings: number;
	confirmedFindings: number;
	closedFindings: number;
	totalQuestions: number;
	openQuestions: number;
	blockedQuestions: number;
	totalEvidence: number;
	totalDeadEnds: number;
	recentHypotheses: string[];
	recentFindings: string[];
	recentQuestions: string[];
}

export interface AddHypothesisInput {
	title: string;
	claim: string;
	rationale?: string;
	confidence?: Confidence;
	relatedEvidenceIds?: string[];
	relatedArtifactIds?: string[];
	relatedQuestionIds?: string[];
	timestamp?: string;
}

export interface UpdateHypothesisInput {
	id: string;
	title?: string;
	claim?: string;
	rationale?: string;
	status?: HypothesisStatus;
	confidence?: Confidence;
	addEvidenceIds?: string[];
	addArtifactIds?: string[];
	addQuestionIds?: string[];
	timestamp?: string;
}

export interface AddFindingInput {
	title: string;
	statement: string;
	severity?: Severity;
	status?: FindingStatus;
	basis?: string[];
	relatedEvidenceIds?: string[];
	relatedArtifactIds?: string[];
	reproStatus?: ReproStatus;
	timestamp?: string;
	surface?: string;
	sourceRefs?: string[];
	reachability?: string;
	validationStatus?: string;
	nextStep?: string;
	keyArtifacts?: string[];
}

export interface UpdateFindingInput {
	id: string;
	title?: string;
	statement?: string;
	severity?: Severity;
	status?: FindingStatus;
	reproStatus?: ReproStatus;
	addBasis?: string[];
	addEvidenceIds?: string[];
	addArtifactIds?: string[];
	timestamp?: string;
	surface?: string;
	sourceRefs?: string[];
	addSourceRefs?: string[];
	reachability?: string;
	validationStatus?: string;
	nextStep?: string;
	keyArtifacts?: string[];
	addKeyArtifacts?: string[];
}

export interface AddQuestionInput {
	prompt: string;
	status?: QuestionStatus;
	owner?: string;
	relatedEvidenceIds?: string[];
	blockedOn?: string[];
	timestamp?: string;
}

export interface UpdateQuestionInput {
	id: string;
	prompt?: string;
	status?: QuestionStatus;
	owner?: string;
	addEvidenceIds?: string[];
	addBlockedOn?: string[];
	timestamp?: string;
}

export interface AddEvidenceInput {
	kind?: EvidenceKind;
	summary: string;
	commandId?: string;
	artifactIds?: string[];
	supports?: string[];
	refutes?: string[];
	timestamp?: string;
}

export interface FindingsPromptSummaryOptions {
	activeHypothesisIds?: string[];
	activeFindingIds?: string[];
	activeQuestionIds?: string[];
}

export interface CandidateFindingQueueEntry {
	id: string;
	title: string;
	severity: Severity;
	reproStatus: ReproStatus;
	evidenceCount: number;
	artifactCount: number;
	basisCount: number;
	updatedAt: string;
	nextStep: string;
}

export interface AddDeadEndInput {
	summary: string;
	whyItFailed?: string;
	artifactsChecked?: string[];
	doNotRepeatUntil?: string;
	timestamp?: string;
}

const TRACKER_DIR = join(".pire", "session");
const TRACKER_JSON_FILE = "findings.json";
const TRACKER_MARKDOWN_FILE = "findings.md";

function dedupe(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
}

function createTimestamp(timestamp?: string): string {
	return timestamp ?? new Date().toISOString();
}

function createId(prefix: string, value: number): string {
	return `${prefix}-${String(value).padStart(3, "0")}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | undefined): value is T {
	return value !== undefined;
}

function toStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function createEmptyFindingsTracker(): FindingsTracker {
	return {
		version: 1,
		updatedAt: new Date().toISOString(),
		hypotheses: [],
		findings: [],
		questions: [],
		evidence: [],
		deadEnds: [],
		nextIds: {
			hypothesis: 1,
			finding: 1,
			question: 1,
			evidence: 1,
			deadEnd: 1,
		},
	};
}

function normalizeHypothesis(value: unknown): HypothesisRecord | undefined {
	if (!isPlainObject(value) || typeof value.id !== "string" || typeof value.title !== "string" || typeof value.claim !== "string") {
		return undefined;
	}

	return {
		id: value.id,
		title: value.title,
		status:
			value.status === "supported" || value.status === "refuted" || value.status === "needs-more-evidence"
				? value.status
				: "open",
		claim: value.claim,
		rationale: typeof value.rationale === "string" ? value.rationale : undefined,
		relatedEvidenceIds: dedupe(toStringArray(value.relatedEvidenceIds)),
		relatedArtifactIds: dedupe(toStringArray(value.relatedArtifactIds)),
		relatedQuestionIds: dedupe(toStringArray(value.relatedQuestionIds)),
		confidence: value.confidence === "low" || value.confidence === "high" ? value.confidence : "medium",
		createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
		updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
	};
}

function normalizeFinding(value: unknown): FindingRecord | undefined {
	if (!isPlainObject(value) || typeof value.id !== "string" || typeof value.title !== "string" || typeof value.statement !== "string") {
		return undefined;
	}

	return {
		id: value.id,
		title: value.title,
		status: normalizeFindingStatus(value.status),
		severity:
			value.severity === "low" || value.severity === "medium" || value.severity === "critical" ? value.severity : "high",
		statement: value.statement,
		basis: dedupe(toStringArray(value.basis)),
		relatedEvidenceIds: dedupe(toStringArray(value.relatedEvidenceIds)),
		relatedArtifactIds: dedupe(toStringArray(value.relatedArtifactIds)),
		reproStatus:
			value.reproStatus === "partial" || value.reproStatus === "reproduced" ? value.reproStatus : "not-reproduced",
		createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
		updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
		surface: typeof value.surface === "string" ? value.surface : undefined,
		sourceRefs: Array.isArray(value.sourceRefs) ? dedupe(toStringArray(value.sourceRefs)) : undefined,
		reachability: typeof value.reachability === "string" ? value.reachability : undefined,
		validationStatus: typeof value.validationStatus === "string" ? value.validationStatus : undefined,
		nextStep: typeof value.nextStep === "string" ? value.nextStep : undefined,
		keyArtifacts: Array.isArray(value.keyArtifacts) ? dedupe(toStringArray(value.keyArtifacts)) : undefined,
	};
}

function normalizeQuestion(value: unknown): QuestionRecord | undefined {
	if (!isPlainObject(value) || typeof value.id !== "string" || typeof value.prompt !== "string") {
		return undefined;
	}

	return {
		id: value.id,
		prompt: value.prompt,
		status: value.status === "answered" || value.status === "blocked" ? value.status : "open",
		owner: typeof value.owner === "string" ? value.owner : undefined,
		relatedEvidenceIds: dedupe(toStringArray(value.relatedEvidenceIds)),
		blockedOn: dedupe(toStringArray(value.blockedOn)),
		createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
		updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
	};
}

function normalizeEvidence(value: unknown): EvidenceRecord | undefined {
	if (!isPlainObject(value) || typeof value.id !== "string" || typeof value.summary !== "string") {
		return undefined;
	}

	return {
		id: value.id,
		kind:
			value.kind === "observation" || value.kind === "trace" || value.kind === "artifact" || value.kind === "note"
				? value.kind
				: "tool-result",
		summary: value.summary,
		commandId: typeof value.commandId === "string" ? value.commandId : undefined,
		artifactIds: dedupe(toStringArray(value.artifactIds)),
		supports: dedupe(toStringArray(value.supports)),
		refutes: dedupe(toStringArray(value.refutes)),
		createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
	};
}

function normalizeDeadEnd(value: unknown): DeadEndRecord | undefined {
	if (!isPlainObject(value) || typeof value.id !== "string" || typeof value.summary !== "string") {
		return undefined;
	}

	return {
		id: value.id,
		summary: value.summary,
		whyItFailed: typeof value.whyItFailed === "string" ? value.whyItFailed : undefined,
		artifactsChecked: dedupe(toStringArray(value.artifactsChecked)),
		doNotRepeatUntil: typeof value.doNotRepeatUntil === "string" ? value.doNotRepeatUntil : undefined,
		createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
	};
}

function inferNextId(records: Array<{ id: string }>, prefix: string): number {
	const prefixText = `${prefix}-`;
	let maxValue = 0;
	for (const record of records) {
		if (!record.id.startsWith(prefixText)) {
			continue;
		}
		const numeric = Number.parseInt(record.id.slice(prefixText.length), 10);
		if (Number.isFinite(numeric) && numeric > maxValue) {
			maxValue = numeric;
		}
	}
	return maxValue + 1;
}

function normalizeTracker(value: unknown): FindingsTracker {
	if (!isPlainObject(value)) {
		return createEmptyFindingsTracker();
	}

	const hypotheses = Array.isArray(value.hypotheses) ? value.hypotheses.map(normalizeHypothesis).filter(isDefined) : [];
	const findings = Array.isArray(value.findings) ? value.findings.map(normalizeFinding).filter(isDefined) : [];
	const questions = Array.isArray(value.questions) ? value.questions.map(normalizeQuestion).filter(isDefined) : [];
	const evidence = Array.isArray(value.evidence) ? value.evidence.map(normalizeEvidence).filter(isDefined) : [];
	const deadEnds = Array.isArray(value.deadEnds) ? value.deadEnds.map(normalizeDeadEnd).filter(isDefined) : [];
	const nextIds = isPlainObject(value.nextIds) ? value.nextIds : {};

	return {
		version: 1,
		updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
		hypotheses,
		findings,
		questions,
		evidence,
		deadEnds,
		nextIds: {
			hypothesis:
				typeof nextIds.hypothesis === "number" && nextIds.hypothesis > 0 ? nextIds.hypothesis : inferNextId(hypotheses, "hyp"),
			finding: typeof nextIds.finding === "number" && nextIds.finding > 0 ? nextIds.finding : inferNextId(findings, "find"),
			question:
				typeof nextIds.question === "number" && nextIds.question > 0 ? nextIds.question : inferNextId(questions, "q"),
			evidence:
				typeof nextIds.evidence === "number" && nextIds.evidence > 0 ? nextIds.evidence : inferNextId(evidence, "ev"),
			deadEnd:
				typeof nextIds.deadEnd === "number" && nextIds.deadEnd > 0 ? nextIds.deadEnd : inferNextId(deadEnds, "dead"),
		},
	};
}

function touchTracker(tracker: FindingsTracker, timestamp: string): FindingsTracker {
	tracker.updatedAt = timestamp;
	return tracker;
}

export interface FindingsTrackerLoadOptions {
	findingsMdPath?: string;
}

export interface FindingsTrackerSaveOptions {
	findingsMdPath?: string;
	findingsMdName?: string;
}

export async function loadFindingsTracker(cwd: string, options?: FindingsTrackerLoadOptions): Promise<FindingsTracker> {
	const trackerPath = join(cwd, TRACKER_DIR, TRACKER_JSON_FILE);
	let tracker: FindingsTracker;
	if (!existsSync(trackerPath)) {
		tracker = createEmptyFindingsTracker();
	} else {
		try {
			const raw = await readFile(trackerPath, "utf-8");
			tracker = normalizeTracker(JSON.parse(raw));
		} catch {
			tracker = createEmptyFindingsTracker();
		}
	}

	const mdPath = options?.findingsMdPath;
	if (mdPath && existsSync(mdPath)) {
		try {
			const { parseFindingsMd, mergeFindingsFromMd } = await import("./findings-md.js");
			const mdContent = await readFile(mdPath, "utf-8");
			const mdFindings = parseFindingsMd(mdContent);
			mergeFindingsFromMd(tracker, mdFindings);
		} catch {
			// FINDINGS.md parse failure is non-fatal; session JSON is still available
		}
	}

	return tracker;
}

export async function saveFindingsTracker(
	cwd: string,
	tracker: FindingsTracker,
	options?: FindingsTrackerSaveOptions,
): Promise<{ jsonPath: string; markdownPath: string }> {
	const trackerDir = join(cwd, TRACKER_DIR);
	const jsonPath = join(trackerDir, TRACKER_JSON_FILE);
	const markdownPath = join(trackerDir, TRACKER_MARKDOWN_FILE);
	await mkdir(trackerDir, { recursive: true });
	await writeFile(jsonPath, `${JSON.stringify(tracker, null, 2)}\n`, "utf-8");
	await writeFile(markdownPath, renderFindingsMarkdown(tracker), "utf-8");

	if (options?.findingsMdPath && tracker.findings.length > 0) {
		try {
			const { renderFindingsMd } = await import("./findings-md.js");
			const subsystemName = options.findingsMdName ?? basename(cwd);
			await writeFile(options.findingsMdPath, renderFindingsMd(subsystemName, tracker.findings), "utf-8");
		} catch {
			// FINDINGS.md write failure is non-fatal; session JSON is the primary store
		}
	}

	return { jsonPath, markdownPath };
}

export function buildArtifactRef(path: string): string {
	return `artifact:${path}`;
}

export function addHypothesis(tracker: FindingsTracker, input: AddHypothesisInput): HypothesisRecord {
	const timestamp = createTimestamp(input.timestamp);
	const record: HypothesisRecord = {
		id: createId("hyp", tracker.nextIds.hypothesis++),
		title: input.title.trim(),
		status: "open",
		claim: input.claim.trim(),
		rationale: input.rationale?.trim() || undefined,
		relatedEvidenceIds: dedupe(input.relatedEvidenceIds ?? []),
		relatedArtifactIds: dedupe(input.relatedArtifactIds ?? []),
		relatedQuestionIds: dedupe(input.relatedQuestionIds ?? []),
		confidence: input.confidence ?? "medium",
		createdAt: timestamp,
		updatedAt: timestamp,
	};
	tracker.hypotheses.push(record);
	touchTracker(tracker, timestamp);
	return record;
}

export function updateHypothesis(tracker: FindingsTracker, input: UpdateHypothesisInput): HypothesisRecord | undefined {
	const hypothesis = tracker.hypotheses.find((record) => record.id === input.id);
	if (!hypothesis) {
		return undefined;
	}

	const timestamp = createTimestamp(input.timestamp);
	if (input.title !== undefined) hypothesis.title = input.title.trim();
	if (input.claim !== undefined) hypothesis.claim = input.claim.trim();
	if (input.rationale !== undefined) hypothesis.rationale = input.rationale.trim() || undefined;
	if (input.status !== undefined) hypothesis.status = input.status;
	if (input.confidence !== undefined) hypothesis.confidence = input.confidence;
	hypothesis.relatedEvidenceIds = dedupe([...hypothesis.relatedEvidenceIds, ...(input.addEvidenceIds ?? [])]);
	hypothesis.relatedArtifactIds = dedupe([...hypothesis.relatedArtifactIds, ...(input.addArtifactIds ?? [])]);
	hypothesis.relatedQuestionIds = dedupe([...hypothesis.relatedQuestionIds, ...(input.addQuestionIds ?? [])]);
	hypothesis.updatedAt = timestamp;
	touchTracker(tracker, timestamp);
	return hypothesis;
}

export function addFinding(tracker: FindingsTracker, input: AddFindingInput): FindingRecord {
	const timestamp = createTimestamp(input.timestamp);
	const record: FindingRecord = {
		id: createId("find", tracker.nextIds.finding++),
		title: input.title.trim(),
		status: input.status ?? "lead",
		severity: input.severity ?? "medium",
		statement: input.statement.trim(),
		basis: dedupe(input.basis ?? []),
		relatedEvidenceIds: dedupe(input.relatedEvidenceIds ?? []),
		relatedArtifactIds: dedupe(input.relatedArtifactIds ?? []),
		reproStatus: input.reproStatus ?? "not-reproduced",
		createdAt: timestamp,
		updatedAt: timestamp,
		surface: input.surface?.trim() || undefined,
		sourceRefs: input.sourceRefs ? dedupe(input.sourceRefs) : undefined,
		reachability: input.reachability?.trim() || undefined,
		validationStatus: input.validationStatus?.trim() || undefined,
		nextStep: input.nextStep?.trim() || undefined,
		keyArtifacts: input.keyArtifacts ? dedupe(input.keyArtifacts) : undefined,
	};
	tracker.findings.push(record);
	touchTracker(tracker, timestamp);
	return record;
}

export function updateFinding(tracker: FindingsTracker, input: UpdateFindingInput): FindingRecord | undefined {
	const finding = tracker.findings.find((record) => record.id === input.id);
	if (!finding) {
		return undefined;
	}

	const timestamp = createTimestamp(input.timestamp);
	if (input.title !== undefined) finding.title = input.title.trim();
	if (input.statement !== undefined) finding.statement = input.statement.trim();
	if (input.severity !== undefined) finding.severity = input.severity;
	if (input.status !== undefined) finding.status = input.status;
	if (input.reproStatus !== undefined) finding.reproStatus = input.reproStatus;
	finding.basis = dedupe([...finding.basis, ...(input.addBasis ?? [])]);
	finding.relatedEvidenceIds = dedupe([...finding.relatedEvidenceIds, ...(input.addEvidenceIds ?? [])]);
	finding.relatedArtifactIds = dedupe([...finding.relatedArtifactIds, ...(input.addArtifactIds ?? [])]);
	if (input.surface !== undefined) finding.surface = input.surface.trim() || undefined;
	if (input.reachability !== undefined) finding.reachability = input.reachability.trim() || undefined;
	if (input.validationStatus !== undefined) finding.validationStatus = input.validationStatus.trim() || undefined;
	if (input.nextStep !== undefined) finding.nextStep = input.nextStep.trim() || undefined;
	if (input.sourceRefs !== undefined) finding.sourceRefs = dedupe(input.sourceRefs);
	if (input.addSourceRefs) finding.sourceRefs = dedupe([...(finding.sourceRefs ?? []), ...input.addSourceRefs]);
	if (input.keyArtifacts !== undefined) finding.keyArtifacts = dedupe(input.keyArtifacts);
	if (input.addKeyArtifacts) finding.keyArtifacts = dedupe([...(finding.keyArtifacts ?? []), ...input.addKeyArtifacts]);
	finding.updatedAt = timestamp;
	touchTracker(tracker, timestamp);
	return finding;
}

export function addQuestion(tracker: FindingsTracker, input: AddQuestionInput): QuestionRecord {
	const timestamp = createTimestamp(input.timestamp);
	const record: QuestionRecord = {
		id: createId("q", tracker.nextIds.question++),
		prompt: input.prompt.trim(),
		status: input.status ?? "open",
		owner: input.owner?.trim() || undefined,
		relatedEvidenceIds: dedupe(input.relatedEvidenceIds ?? []),
		blockedOn: dedupe(input.blockedOn ?? []),
		createdAt: timestamp,
		updatedAt: timestamp,
	};
	tracker.questions.push(record);
	touchTracker(tracker, timestamp);
	return record;
}

export function updateQuestion(tracker: FindingsTracker, input: UpdateQuestionInput): QuestionRecord | undefined {
	const question = tracker.questions.find((record) => record.id === input.id);
	if (!question) {
		return undefined;
	}

	const timestamp = createTimestamp(input.timestamp);
	if (input.prompt !== undefined) question.prompt = input.prompt.trim();
	if (input.status !== undefined) question.status = input.status;
	if (input.owner !== undefined) question.owner = input.owner.trim() || undefined;
	question.relatedEvidenceIds = dedupe([...question.relatedEvidenceIds, ...(input.addEvidenceIds ?? [])]);
	question.blockedOn = dedupe([...question.blockedOn, ...(input.addBlockedOn ?? [])]);
	question.updatedAt = timestamp;
	touchTracker(tracker, timestamp);
	return question;
}

export function addEvidence(tracker: FindingsTracker, input: AddEvidenceInput): EvidenceRecord {
	const timestamp = createTimestamp(input.timestamp);
	const record: EvidenceRecord = {
		id: createId("ev", tracker.nextIds.evidence++),
		kind: input.kind ?? "tool-result",
		summary: input.summary.trim(),
		commandId: input.commandId?.trim() || undefined,
		artifactIds: dedupe(input.artifactIds ?? []),
		supports: dedupe(input.supports ?? []),
		refutes: dedupe(input.refutes ?? []),
		createdAt: timestamp,
	};
	tracker.evidence.push(record);
	touchTracker(tracker, timestamp);
	return record;
}

export function addDeadEnd(tracker: FindingsTracker, input: AddDeadEndInput): DeadEndRecord {
	const timestamp = createTimestamp(input.timestamp);
	const record: DeadEndRecord = {
		id: createId("dead", tracker.nextIds.deadEnd++),
		summary: input.summary.trim(),
		whyItFailed: input.whyItFailed?.trim() || undefined,
		artifactsChecked: dedupe(input.artifactsChecked ?? []),
		doNotRepeatUntil: input.doNotRepeatUntil?.trim() || undefined,
		createdAt: timestamp,
	};
	tracker.deadEnds.push(record);
	touchTracker(tracker, timestamp);
	return record;
}

function matchesFilter(parts: string[], filterText: string): boolean {
	const normalizedFilter = filterText.trim().toLowerCase();
	if (normalizedFilter.length === 0) {
		return true;
	}
	return parts.some((part) => part.toLowerCase().includes(normalizedFilter));
}

function severityRank(severity: Severity): number {
	switch (severity) {
		case "critical":
			return 4;
		case "high":
			return 3;
		case "medium":
			return 2;
		case "low":
			return 1;
	}
}

function reproRank(reproStatus: ReproStatus): number {
	switch (reproStatus) {
		case "reproduced":
			return 3;
		case "partial":
			return 2;
		case "not-reproduced":
			return 1;
	}
}

function inferCandidateNextStep(record: FindingRecord): string {
	if (record.nextStep) {
		return record.nextStep;
	}
	const supportCount = record.relatedEvidenceIds.length + record.basis.length;
	if (supportCount === 0) {
		return "reason about reachability and controllability from source before building any probe";
	}
	if (record.reproStatus === "not-reproduced") {
		return "assess exploitability from source analysis; only build a targeted probe if runtime state is genuinely needed";
	}
	if (record.reproStatus === "partial") {
		return "close the proof gap or record why reproduction stalls";
	}
	return "promote only after one final adversarial check for alternate explanations";
}

export function getCandidateFindingQueue(tracker: FindingsTracker): CandidateFindingQueueEntry[] {
	return tracker.findings
		.filter((record) => record.status === "lead" || record.status === "active")
		.map((record) => ({
			id: record.id,
			title: record.title,
			severity: record.severity,
			reproStatus: record.reproStatus,
			evidenceCount: record.relatedEvidenceIds.length,
			artifactCount: record.relatedArtifactIds.length,
			basisCount: record.basis.length,
			updatedAt: record.updatedAt,
			nextStep: inferCandidateNextStep(record),
		}))
		.sort((left, right) => {
			const scoreDelta =
				severityRank(right.severity) * 100 +
				reproRank(right.reproStatus) * 10 +
				right.evidenceCount +
				right.basisCount -
				(severityRank(left.severity) * 100 +
					reproRank(left.reproStatus) * 10 +
					left.evidenceCount +
					left.basisCount);
			if (scoreDelta !== 0) {
				return scoreDelta;
			}
			return right.updatedAt.localeCompare(left.updatedAt);
		});
}

export function summarizeCandidateFindings(tracker: FindingsTracker, filterText?: string): string {
	const normalizedFilter = filterText?.trim().toLowerCase() ?? "";
	const queue = getCandidateFindingQueue(tracker).filter((record) =>
		normalizedFilter.length === 0
			? true
			: [record.id, record.title, record.severity, record.reproStatus, record.nextStep]
					.some((part) => part.toLowerCase().includes(normalizedFilter)),
	);
	const lines = ["Pire Lead Queue", `- leads: ${queue.length}`];
	if (normalizedFilter.length > 0) {
		lines.push(`- filter: ${normalizedFilter}`);
	}
	if (queue.length === 0) {
		lines.push("- no lead findings in queue");
		return lines.join("\n");
	}
	for (const record of queue.slice(0, 8)) {
		lines.push(
			`- ${record.id} [${record.severity}/${record.reproStatus}] ${record.title} (evidence:${record.evidenceCount}, basis:${record.basisCount}, artifacts:${record.artifactCount})`,
		);
		lines.push(`  next: ${record.nextStep}`);
	}
	return lines.join("\n");
}

export function buildFindingsTrackerSummary(tracker: FindingsTracker): FindingsTrackerSummary {
	const openHypotheses = tracker.hypotheses.filter((record) => record.status === "open" || record.status === "needs-more-evidence");
	const supportedHypotheses = tracker.hypotheses.filter((record) => record.status === "supported");
	const refutedHypotheses = tracker.hypotheses.filter((record) => record.status === "refuted");
	const leadFindings = tracker.findings.filter((record) => record.status === "lead").length;
	const activeFindings = tracker.findings.filter((record) => record.status === "active").length;
	const deEscalatedFindings = tracker.findings.filter((record) => record.status === "de-escalated").length;
	const reportCandidateFindings = tracker.findings.filter((record) => record.status === "report-candidate").length;
	const confirmedFindings = tracker.findings.filter((record) => record.status === "confirmed" || record.status === "reported");
	const closedFindings = tracker.findings.filter((record) => record.status === "closed").length;
	const openQuestions = tracker.questions.filter((record) => record.status === "open");
	const blockedQuestions = tracker.questions.filter((record) => record.status === "blocked");

	return {
		totalHypotheses: tracker.hypotheses.length,
		openHypotheses: openHypotheses.length,
		supportedHypotheses: supportedHypotheses.length,
		refutedHypotheses: refutedHypotheses.length,
		totalFindings: tracker.findings.length,
		candidateFindings: leadFindings,
		leadFindings,
		activeFindings,
		deEscalatedFindings,
		reportCandidateFindings,
		confirmedFindings: confirmedFindings.length,
		closedFindings,
		totalQuestions: tracker.questions.length,
		openQuestions: openQuestions.length,
		blockedQuestions: blockedQuestions.length,
		totalEvidence: tracker.evidence.length,
		totalDeadEnds: tracker.deadEnds.length,
		recentHypotheses: [...tracker.hypotheses].slice(-3).reverse().map((record) => `${record.id} ${record.title}`),
		recentFindings: [...tracker.findings].slice(-3).reverse().map((record) => `${record.id} ${record.title}`),
		recentQuestions: [...tracker.questions].slice(-3).reverse().map((record) => `${record.id} ${record.prompt}`),
	};
}

export function summarizeFindingsTracker(tracker: FindingsTracker, filterText?: string): string {
	const normalizedFilter = filterText?.trim() ?? "";
	const summary = buildFindingsTrackerSummary(tracker);
	const hypotheses = tracker.hypotheses.filter((record) =>
		matchesFilter([record.id, record.title, record.claim, record.rationale ?? ""], normalizedFilter),
	);
	const findings = tracker.findings.filter((record) =>
		matchesFilter([record.id, record.title, record.statement, record.severity, record.status], normalizedFilter),
	);
	const questions = tracker.questions.filter((record) =>
		matchesFilter([record.id, record.prompt, record.owner ?? "", record.status], normalizedFilter),
	);
	const evidence = tracker.evidence.filter((record) =>
		matchesFilter([record.id, record.summary, record.kind, record.commandId ?? "", ...record.artifactIds], normalizedFilter),
	);
	const deadEnds = tracker.deadEnds.filter((record) =>
		matchesFilter([record.id, record.summary, record.whyItFailed ?? "", ...record.artifactsChecked], normalizedFilter),
	);

	const lines = [
		"Pire Tracker",
		`- updated: ${tracker.updatedAt}`,
		`- hypotheses: ${summary.totalHypotheses} (${summary.openHypotheses} open, ${summary.supportedHypotheses} supported, ${summary.refutedHypotheses} refuted)`,
		`- findings: ${summary.totalFindings} (${summary.leadFindings} lead, ${summary.activeFindings} active, ${summary.deEscalatedFindings} de-escalated, ${summary.reportCandidateFindings} report-candidate, ${summary.confirmedFindings} confirmed/reported, ${summary.closedFindings} closed)`,
		`- questions: ${summary.totalQuestions} (${summary.openQuestions} open, ${summary.blockedQuestions} blocked)`,
		`- evidence: ${summary.totalEvidence}`,
		`- dead ends: ${summary.totalDeadEnds}`,
	];

	if (normalizedFilter.length > 0) {
		lines.push(`- filter: ${normalizedFilter}`);
	}

	if (hypotheses.length > 0) {
		lines.push("Hypotheses:");
		for (const record of hypotheses.slice(0, 5)) {
			lines.push(`- ${record.id} [${record.status}] ${record.title}`);
		}
	}

	if (findings.length > 0) {
		lines.push("Findings:");
		for (const record of findings.slice(0, 5)) {
			lines.push(`- ${record.id} [${record.status}/${record.severity}] ${record.title}`);
		}
	}

	if (questions.length > 0) {
		lines.push("Questions:");
		for (const record of questions.slice(0, 5)) {
			lines.push(`- ${record.id} [${record.status}] ${record.prompt}`);
		}
	}

	if (evidence.length > 0) {
		lines.push("Evidence:");
		for (const record of evidence.slice(-5).reverse()) {
			lines.push(`- ${record.id} [${record.kind}] ${record.summary}`);
		}
	}

	if (deadEnds.length > 0) {
		lines.push("Dead Ends:");
		for (const record of deadEnds.slice(-5).reverse()) {
			lines.push(`- ${record.id} ${record.summary}`);
		}
	}

	if (lines.length === 7 + (normalizedFilter.length > 0 ? 1 : 0)) {
		lines.push("- no matching tracker records");
	}

	return lines.join("\n");
}

export function buildFindingsWidgetLines(tracker: FindingsTracker): string[] {
	const summary = buildFindingsTrackerSummary(tracker);
	const lines = [
		"Pire Tracker",
		`- open hypotheses: ${summary.openHypotheses}`,
		`- leads: ${summary.leadFindings}, active: ${summary.activeFindings}, confirmed: ${summary.confirmedFindings}`,
		`- blocked questions: ${summary.blockedQuestions}`,
	];

	const recentHypothesis = summary.recentHypotheses[0];
	if (recentHypothesis) {
		lines.push(`- latest hypothesis: ${recentHypothesis}`);
	}

	const recentFinding = summary.recentFindings[0];
	if (recentFinding) {
		lines.push(`- latest finding: ${recentFinding}`);
	}

	const recentQuestion = summary.recentQuestions[0];
	if (recentQuestion) {
		lines.push(`- latest question: ${recentQuestion}`);
	}

	return lines;
}

export function buildFindingsPromptSummary(
	tracker: FindingsTracker,
	options: FindingsPromptSummaryOptions = {},
): string {
	const summary = buildFindingsTrackerSummary(tracker);
	const candidateQueue = getCandidateFindingQueue(tracker).slice(0, 3);
	const lines = [
		"[PIRE TRACKER]",
		`Open hypotheses: ${summary.openHypotheses}; leads: ${summary.leadFindings}; active: ${summary.activeFindings}; confirmed: ${summary.confirmedFindings}; de-escalated: ${summary.deEscalatedFindings}; blocked questions: ${summary.blockedQuestions}; evidence: ${summary.totalEvidence}.`,
	];
	const activeHypotheses = tracker.hypotheses.filter((record) => (options.activeHypothesisIds ?? []).includes(record.id));
	const activeFindings = tracker.findings.filter((record) => (options.activeFindingIds ?? []).includes(record.id));
	const activeQuestions = tracker.questions.filter((record) => (options.activeQuestionIds ?? []).includes(record.id));
	const focusEvidenceIds = new Set([
		...activeHypotheses.flatMap((record) => record.relatedEvidenceIds),
		...activeFindings.flatMap((record) => record.relatedEvidenceIds),
		...activeQuestions.flatMap((record) => record.relatedEvidenceIds),
	]);
	const focusEvidence = tracker.evidence
		.filter((record) => focusEvidenceIds.has(record.id))
		.slice(-3)
		.reverse();
	const contradictoryEvidence = tracker.evidence
		.filter((record) => record.refutes.length > 0)
		.slice(-2)
		.reverse();

	if (activeHypotheses.length > 0 || activeFindings.length > 0 || activeQuestions.length > 0) {
		lines.push("Active focus:");
		for (const record of activeHypotheses) {
			lines.push(`- hypothesis ${record.id}: ${record.title}`);
		}
		for (const record of activeFindings) {
			lines.push(`- finding ${record.id}: ${record.title}`);
		}
		for (const record of activeQuestions) {
			lines.push(`- question ${record.id}: ${record.prompt}`);
		}
	}

	const openHypotheses = tracker.hypotheses
		.filter((record) => record.status === "open" || record.status === "needs-more-evidence")
		.slice(-3)
		.reverse();
	if (openHypotheses.length > 0) {
		lines.push("Current hypotheses:");
		for (const record of openHypotheses) {
			lines.push(`- ${record.id}: ${record.title}`);
		}
	}

	const findings = tracker.findings.filter((record) => record.status === "confirmed" || record.status === "reported" || record.status === "report-candidate").slice(-3).reverse();
	if (findings.length > 0) {
		lines.push("Confirmed findings:");
		for (const record of findings) {
			lines.push(`- ${record.id}: ${record.title}`);
		}
	}

	if (candidateQueue.length > 0) {
		lines.push("Verification backlog:");
		for (const record of candidateQueue) {
			lines.push(
				`- ${record.id} [${record.severity}/${record.reproStatus}] ${record.title} -> ${record.nextStep}`,
			);
		}
	}

	const blockedQuestions = tracker.questions.filter((record) => record.status === "blocked").slice(-3).reverse();
	if (blockedQuestions.length > 0) {
		lines.push("Blocked questions:");
		for (const record of blockedQuestions) {
			lines.push(`- ${record.id}: ${record.prompt}`);
		}
	}

	if (focusEvidence.length > 0) {
		lines.push("Evidence linked to active focus:");
		for (const record of focusEvidence) {
			lines.push(`- ${record.id}: ${record.summary}`);
		}
	}

	if (contradictoryEvidence.length > 0) {
		lines.push("Contradictory evidence:");
		for (const record of contradictoryEvidence) {
			lines.push(`- ${record.id}: ${record.summary}`);
		}
	}

	return lines.join("\n");
}

export function renderFindingsMarkdown(tracker: FindingsTracker): string {
	const lines = ["# Pire Tracker", "", `Updated: ${tracker.updatedAt}`, ""];

	lines.push("## Hypotheses", "");
	if (tracker.hypotheses.length === 0) {
		lines.push("- None", "");
	} else {
		for (const record of tracker.hypotheses) {
			lines.push(`- ${record.id} [${record.status}] ${record.title}`);
			lines.push(`  Claim: ${record.claim}`);
			if (record.rationale) {
				lines.push(`  Rationale: ${record.rationale}`);
			}
			lines.push(`  Confidence: ${record.confidence}`);
		}
		lines.push("");
	}

	lines.push("## Findings", "");
	if (tracker.findings.length === 0) {
		lines.push("- None", "");
	} else {
		for (const record of tracker.findings) {
			lines.push(`### ${record.id} — ${record.title}`, "");
			lines.push(`- **State:** \`${record.status}\``);
			lines.push(`- **Severity:** ${record.severity}`);
			lines.push(`- **Statement:** ${record.statement}`);
			if (record.surface) lines.push(`- **Surface:** ${record.surface}`);
			if (record.sourceRefs && record.sourceRefs.length > 0) {
				lines.push("- **Source refs:**");
				for (const ref of record.sourceRefs) lines.push(`  - \`${ref}\``);
			}
			if (record.reachability) lines.push(`- **Current reachability:** ${record.reachability}`);
			if (record.keyArtifacts && record.keyArtifacts.length > 0) {
				lines.push("- **Key artifacts:**");
				for (const artifact of record.keyArtifacts) lines.push(`  - \`${artifact}\``);
			}
			if (record.validationStatus) lines.push(`- **Validation status:** ${record.validationStatus}`);
			lines.push(`- **Repro:** ${record.reproStatus}`);
			if (record.nextStep) lines.push(`- **Next step:** ${record.nextStep}`);
			lines.push("");
		}
	}

	lines.push("## Questions", "");
	if (tracker.questions.length === 0) {
		lines.push("- None", "");
	} else {
		for (const record of tracker.questions) {
			lines.push(`- ${record.id} [${record.status}] ${record.prompt}`);
		}
		lines.push("");
	}

	lines.push("## Evidence", "");
	if (tracker.evidence.length === 0) {
		lines.push("- None", "");
	} else {
		for (const record of tracker.evidence) {
			lines.push(`- ${record.id} [${record.kind}] ${record.summary}`);
		}
		lines.push("");
	}

	lines.push("## Dead Ends", "");
	if (tracker.deadEnds.length === 0) {
		lines.push("- None", "");
	} else {
		for (const record of tracker.deadEnds) {
			lines.push(`- ${record.id} ${record.summary}`);
			if (record.whyItFailed) {
				lines.push(`  Why: ${record.whyItFailed}`);
			}
		}
		lines.push("");
	}

	return `${lines.join("\n").trimEnd()}\n`;
}
