import { buildArtifactManifestSummary, type ArtifactManifest } from "./artifacts.js";
import { buildCampaignLedgerSummary, type CampaignLedger } from "./campaign.js";
import {
	buildFindingsTrackerSummary,
	getCandidateFindingQueue,
	type DeadEndRecord,
	type EvidenceRecord,
	type FindingRecord,
	type FindingsTracker,
	type HypothesisRecord,
	type QuestionRecord,
} from "./findings.js";

export type PireRole = "scout" | "reverser" | "tracer" | "fuzzer" | "reviewer" | "writer";
export type PireSessionType =
	| "binary-re"
	| "crash-triage"
	| "network-protocol"
	| "firmware-analysis"
	| "web-security-review"
	| "malware-analysis";
export type PireMode = "recon" | "triage" | "dynamic" | "proofing" | "report";

export interface PireToolActivity {
	tool: string;
	target: string;
	summary: string;
	artifacts: string[];
	recordedAt: string;
}

export interface SessionTypeProfile {
	label: string;
	defaultMode: PireMode;
	defaultRole: PireRole;
	thinkingLevel: "medium" | "high";
	modelHints: string[];
	instructions: string[];
}

export interface RoleProfile {
	label: string;
	instructions: string[];
}

export interface ResearchCompactionInput {
	mode: PireMode;
	role?: PireRole;
	sessionType?: PireSessionType;
	campaign?: CampaignLedger;
	tracker: FindingsTracker;
	manifest: ArtifactManifest;
	recentActivity: PireToolActivity[];
	customInstructions?: string;
	previousSummary?: string;
}

export type TrackerRecordDetail =
	| { kind: "hypothesis"; record: HypothesisRecord }
	| { kind: "finding"; record: FindingRecord }
	| { kind: "question"; record: QuestionRecord }
	| { kind: "evidence"; record: EvidenceRecord }
	| { kind: "deadEnd"; record: DeadEndRecord };

export const PIRE_ROLE_ORDER: PireRole[] = ["scout", "reverser", "tracer", "fuzzer", "reviewer", "writer"];
export const PIRE_SESSION_TYPE_ORDER: PireSessionType[] = [
	"binary-re",
	"crash-triage",
	"network-protocol",
	"firmware-analysis",
	"web-security-review",
	"malware-analysis",
];

export const PIRE_ROLE_PROFILES: Record<PireRole, RoleProfile> = {
	scout: {
		label: "Scout",
		instructions: [
			"Prioritize quick triage, artifact inventory, protocol surface mapping, and obvious leads.",
			"Return concise findings, unknowns, and the next best inspection targets instead of deep narrative.",
			"Push through multiple cheap local inspection steps before yielding when the next move is obvious.",
		],
	},
	reverser: {
		label: "Reverser",
		instructions: [
			"Bias toward static analysis, symbol recovery, control-flow reasoning, and offset-accurate artifact notes.",
			"Record addresses, functions, sections, and byte ranges precisely enough for later reproduction.",
		],
	},
	tracer: {
		label: "Tracer",
		instructions: [
			"Bias toward runtime evidence: traces, debugger output, process state, and reproducible execution conditions.",
			"Keep exact argv, environment assumptions, and trace artifacts linked back to hypotheses and findings.",
		],
	},
	fuzzer: {
		label: "Fuzzer",
		instructions: [
			"Focus on harness strategy, corpus design, mutation constraints, crash bucketing, and minimization plans.",
			"Prefer reproducibility and measurement over speculative exploit claims.",
		],
	},
	reviewer: {
		label: "Reviewer",
		instructions: [
			"Challenge weak assumptions, ask what evidence is missing, and separate confidence levels explicitly.",
			"Look for disproving evidence, alternate explanations, and reporting gaps before conclusions harden.",
			"Do not let caution turn into inactivity; keep advancing with the next low-risk check.",
		],
	},
	writer: {
		label: "Writer",
		instructions: [
			"Turn validated evidence into durable notes, advisories, and reproducible write-ups without dropping technical detail.",
			"Prefer clear remediation or repro sections over broad prose.",
		],
	},
};

export const PIRE_SESSION_TYPE_PROFILES: Record<PireSessionType, SessionTypeProfile> = {
	"binary-re": {
		label: "Binary RE",
		defaultMode: "recon",
		defaultRole: "reverser",
		thinkingLevel: "high",
		modelHints: ["claude-sonnet-4-5", "gemini-2.5-pro"],
		instructions: [
			"Default to binary metadata, string extraction, symbol inventory, hexdumps, disassembly, and decompilation before mutation.",
			"Preserve offsets, symbols, and section names in every meaningful note.",
			"Read-only triage is the opening move, not the whole session; continue through the next useful local analysis step when the path is clear.",
		],
	},
	"crash-triage": {
		label: "Crash Triage",
		defaultMode: "dynamic",
		defaultRole: "tracer",
		thinkingLevel: "high",
		modelHints: ["claude-sonnet-4-5", "gemini-2.5-pro"],
		instructions: [
			"Prioritize reproducing the crash, collecting traces, isolating triggering inputs, and deciding exploitability confidence.",
			"Keep argv, environment, signal data, and minimized repro artifacts tied to each conclusion.",
		],
	},
	"network-protocol": {
		label: "Network/Protocol Analysis",
		defaultMode: "recon",
		defaultRole: "scout",
		thinkingLevel: "medium",
		modelHints: ["claude-sonnet-4-5", "gemini-2.5-pro"],
		instructions: [
			"Prioritize PCAP summaries, stream following, HTTP/header inspection, endpoint inventory, and protocol state mapping.",
			"Keep request/response fragments, stream identifiers, and capture artifacts linked to observations.",
		],
	},
	"firmware-analysis": {
		label: "Firmware Analysis",
		defaultMode: "recon",
		defaultRole: "reverser",
		thinkingLevel: "high",
		modelHints: ["claude-sonnet-4-5", "gemini-2.5-pro"],
		instructions: [
			"Prioritize image identification, binwalk signatures, archive inventory, extraction planning, and component triage.",
			"Keep offsets, extracted paths, hashes, and packaging relationships explicit.",
		],
	},
	"web-security-review": {
		label: "Web Security Review",
		defaultMode: "recon",
		defaultRole: "reviewer",
		thinkingLevel: "medium",
		modelHints: ["claude-sonnet-4-5", "gemini-2.5-pro"],
		instructions: [
			"Prioritize surface mapping, request/response evidence, exposed headers, routing hints, and trust-boundary questions.",
			"If the target exposes Chrome DevTools Protocol or another browser debugging surface, pivot early to runtime browser inspection instead of treating it as a static web-only task.",
			"Capture browser-owned evidence such as /json/version, target inventory, and read-only Runtime.evaluate results before escalating into heavier probing.",
			"Stay in sanctioned, low-impact inspection unless the user explicitly escalates posture.",
			"Do not overconstrain local evidence collection or harmless tooling just because the engagement has not escalated to active probing.",
		],
	},
	"malware-analysis": {
		label: "Malware Analysis",
		defaultMode: "dynamic",
		defaultRole: "tracer",
		thinkingLevel: "high",
		modelHints: ["claude-sonnet-4-5", "gemini-2.5-pro"],
		instructions: [
			"Prioritize sandbox posture, execution tracing, dropped artifacts, network behavior, and persistence indicators.",
			"Record containment assumptions and avoid unsafe outbound activity unless the lab setup is explicit.",
		],
	},
};

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}
	return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function parseArtifactRef(value: string): string {
	return value.startsWith("artifact:") ? value.slice("artifact:".length) : value;
}

function renderLinks(label: string, values: string[]): string[] {
	if (values.length === 0) {
		return [];
	}
	return [`${label}:`, ...values.map((value) => `- ${value}`)];
}

export function isPireRole(value: string): value is PireRole {
	return Object.hasOwn(PIRE_ROLE_PROFILES, value);
}

export function isPireSessionType(value: string): value is PireSessionType {
	return Object.hasOwn(PIRE_SESSION_TYPE_PROFILES, value);
}

export function getRoleProfile(role: PireRole): RoleProfile {
	return PIRE_ROLE_PROFILES[role];
}

export function getSessionTypeProfile(sessionType: PireSessionType): SessionTypeProfile {
	return PIRE_SESSION_TYPE_PROFILES[sessionType];
}

export function formatRolePrompt(role: PireRole): string {
	const profile = getRoleProfile(role);
	return [`[PIRE ROLE: ${profile.label.toUpperCase()}]`, ...profile.instructions].join("\n");
}

export function formatSessionTypePrompt(sessionType: PireSessionType): string {
	const profile = getSessionTypeProfile(sessionType);
	return [
		`[PIRE SESSION TYPE: ${profile.label.toUpperCase()}]`,
		...profile.instructions,
		`Recommended thinking: ${profile.thinkingLevel}.`,
		`Recommended model families: ${profile.modelHints.join(", ")}.`,
	].join("\n");
}

export function buildLeadWorkflowPrompt(mode: PireMode, tracker: FindingsTracker): string {
	const summary = buildFindingsTrackerSummary(tracker);
	const queue = getCandidateFindingQueue(tracker).slice(0, 3);
	const lines = [
		"[PIRE LEAD WORKFLOW]",
		"Work the loop in order: sweep for candidates, apply the exploitability gate, verify or kill the best lead, then report only what survives evidence review.",
		"EXPLOITABILITY GATE (mandatory before any probe or finding promotion): Answer in plain text: (1) What can an attacker achieve with this bug alone, end-to-end? (2) Would a bounty program pay for this as a standalone submission? (3) Does this require a second hypothetical bug to be useful? If the answer to (3) is yes, label it a chain primitive, record it briefly, and move to higher-value leads.",
		"Use diverse entrypoints during sweep so the search does not collapse onto one comfortable explanation. After finding one bug class in a subsystem, explicitly switch to a different bug class or subsystem. If the sweep keeps producing the same class (e.g., info-disclosure after info-disclosure), stop and force a different entry point.",
		"Before building any harness or probe, answer: (1) what specific hypothesis does it test, (2) why can source reasoning alone not resolve this, (3) what concrete outcome would the code produce. If you cannot answer all three, keep reading and reasoning.",
		"During verification, look for disconfirming evidence and alternate explanations before you strengthen the claim.",
		"Treat missing findings as costly, but do not convert uncertainty into a confirmed claim without concrete evidence.",
		"Reasoning, chaining analysis, and logic-bug identification are higher-value work than building harnesses. Only move to code when you have a strong hypothesis worth testing.",
		"Prioritize bugs that give direct attacker impact (code execution, privilege escalation, sandbox escape, arbitrary file access) over information disclosures or chain primitives that require a second bug.",
	];
	if (mode === "recon" || mode === "triage" || mode === "dynamic") {
		lines.push("Do not stop at a plausible candidate if the next low-risk verification step is obvious — but prefer source reasoning over writing code when both can answer the question.");
	}
	if (mode === "proofing") {
		lines.push("Use proofing to close narrow proof gaps, not to expand scope or mutate unrelated surfaces.");
	}
	if (mode === "report") {
		lines.push("In report mode, downgrade or defer anything that has not survived verification.");
	}
	lines.push(
		`Current backlog: ${summary.leadFindings} lead, ${summary.activeFindings} active, ${summary.confirmedFindings} confirmed/reported, ${summary.deEscalatedFindings} de-escalated, ${summary.totalEvidence} evidence records.`,
	);
	if (queue.length > 0) {
		lines.push("Top leads to follow now:");
		for (const record of queue) {
			lines.push(`- ${record.id} [${record.severity}/${record.exploitability}/${record.reproStatus}] ${record.title} -> ${record.nextStep}`);
		}
	}
	return lines.join("\n");
}

export function buildResearchCompactionSummary(input: ResearchCompactionInput): string {
	const trackerSummary = buildFindingsTrackerSummary(input.tracker);
	const artifactSummary = buildArtifactManifestSummary(input.manifest);
	const campaignSummary = input.campaign ? buildCampaignLedgerSummary(input.campaign) : undefined;
	const candidateQueue = getCandidateFindingQueue(input.tracker).slice(0, 5);
	const lines: string[] = [
		"# Pire Research Compaction",
		"",
		"## Runtime State",
		`- mode: ${input.mode}`,
		`- role: ${input.role ?? "unset"}`,
		`- session type: ${input.sessionType ?? "unset"}`,
		campaignSummary
			? `- campaign findings: ${campaignSummary.totalFindings} (${campaignSummary.leadFindings} lead, ${campaignSummary.confirmedFindings} confirmed, ${campaignSummary.submittedFindings} submitted, ${campaignSummary.deEscalatedFindings} de-escalated, ${campaignSummary.blockedFindings} blocked)`
			: "- campaign findings: unavailable",
		campaignSummary
			? `- campaign chains: ${campaignSummary.totalChains} (${campaignSummary.activeChains} active, ${campaignSummary.parkedChains} parked, ${campaignSummary.closedChains} closed)`
			: "- campaign chains: unavailable",
		"",
		"## Tracker Summary",
		`- hypotheses: ${trackerSummary.totalHypotheses} (${trackerSummary.openHypotheses} open, ${trackerSummary.supportedHypotheses} supported, ${trackerSummary.refutedHypotheses} refuted)`,
		`- findings: ${trackerSummary.totalFindings} (${trackerSummary.leadFindings} lead, ${trackerSummary.activeFindings} active, ${trackerSummary.deEscalatedFindings} de-escalated, ${trackerSummary.reportCandidateFindings} report-candidate, ${trackerSummary.confirmedFindings} confirmed/reported, ${trackerSummary.closedFindings} closed)`,
		`- questions: ${trackerSummary.totalQuestions} (${trackerSummary.blockedQuestions} blocked)`,
		`- evidence: ${trackerSummary.totalEvidence}`,
		`- dead ends: ${trackerSummary.totalDeadEnds}`,
	];

	if (campaignSummary) {
		lines.push("", "## Campaign State");
		if (input.campaign?.findings.length) {
			for (const record of [...input.campaign.findings].slice(-6).reverse()) {
				lines.push(`- ${record.id} [${record.status}] ${record.title}`);
				if (record.note) {
					lines.push(`  note: ${truncate(record.note, 180)}`);
				}
				if (record.reportPaths.length > 0) {
					lines.push(`  reports: ${record.reportPaths.slice(0, 2).join(", ")}`);
				}
			}
		} else {
			lines.push("- no campaign findings recorded");
		}
		if (input.campaign?.chains.length) {
			lines.push("Chains:");
			for (const chain of [...input.campaign.chains].slice(-4).reverse()) {
				lines.push(`- ${chain.id} [${chain.status}] ${chain.title}`);
				if (chain.findingIds.length > 0) {
					lines.push(`  findings: ${chain.findingIds.join(", ")}`);
				}
			}
		}
	}

	if (input.customInstructions?.trim()) {
		lines.push("", "## Compaction Focus", `- ${input.customInstructions.trim()}`);
	}

	const openHypotheses = input.tracker.hypotheses.filter(
		(record) => record.status === "open" || record.status === "needs-more-evidence",
	);
	if (openHypotheses.length > 0) {
		lines.push("", "## Open Hypotheses");
		for (const record of openHypotheses.slice(-5).reverse()) {
			lines.push(`- ${record.id} [${record.status}/${record.confidence}] ${record.title}`);
			lines.push(`  claim: ${truncate(record.claim, 180)}`);
		}
	}

	const confirmedFindings = input.tracker.findings.filter(
		(record) => record.status === "confirmed" || record.status === "reported",
	);
	if (confirmedFindings.length > 0) {
		lines.push("", "## Confirmed Findings");
		for (const record of confirmedFindings.slice(-5).reverse()) {
			lines.push(`- ${record.id} [${record.status}/${record.severity}] ${record.title}`);
			lines.push(`  statement: ${truncate(record.statement, 180)}`);
		}
	}

	if (candidateQueue.length > 0) {
		lines.push("", "## Verification Backlog");
		for (const record of candidateQueue) {
			lines.push(
				`- ${record.id} [${record.severity}/${record.reproStatus}] ${record.title} (evidence:${record.evidenceCount}, basis:${record.basisCount})`,
			);
			lines.push(`  next: ${record.nextStep}`);
		}
	}

	const blockedQuestions = input.tracker.questions.filter((record) => record.status === "blocked");
	if (blockedQuestions.length > 0) {
		lines.push("", "## Blocked Questions");
		for (const record of blockedQuestions.slice(-5).reverse()) {
			lines.push(`- ${record.id} ${truncate(record.prompt, 180)}`);
		}
	}

	const recentEvidence = [...input.tracker.evidence].slice(-8).reverse();
	if (recentEvidence.length > 0) {
		lines.push("", "## Recent Evidence");
		for (const record of recentEvidence) {
			const refs = [
				record.commandId ? `cmd=${record.commandId}` : undefined,
				record.artifactIds.length > 0 ? `artifact=${truncate(parseArtifactRef(record.artifactIds[0] ?? ""), 80)}` : undefined,
			]
				.filter((value): value is string => value !== undefined)
				.join(", ");
			lines.push(`- ${record.id} [${record.kind}] ${truncate(record.summary, 180)}${refs ? ` (${refs})` : ""}`);
		}
	}

	const recentDeadEnds = [...input.tracker.deadEnds].slice(-5).reverse();
	if (recentDeadEnds.length > 0) {
		lines.push("", "## Dead Ends");
		for (const record of recentDeadEnds) {
			lines.push(`- ${record.id} ${truncate(record.summary, 180)}`);
			if (record.whyItFailed) {
				lines.push(`  why: ${truncate(record.whyItFailed, 160)}`);
			}
		}
	}

	lines.push("", "## Artifact Registry");
	lines.push(`- artifacts: ${artifactSummary.total}`);
	if (artifactSummary.total === 0) {
		const fallbackArtifacts = Array.from(
			new Set(
				input.tracker.evidence.flatMap((record) => record.artifactIds.map((artifactId) => parseArtifactRef(artifactId))),
			),
		);
		if (fallbackArtifacts.length === 0) {
			lines.push("- no artifacts recorded");
		} else {
			lines.push("- manifest empty; using tracker-linked artifact refs");
			for (const artifactPath of fallbackArtifacts.slice(0, 8)) {
				lines.push(`- ${artifactPath}`);
			}
		}
	} else {
		const byType = Object.entries(artifactSummary.byType)
			.sort((left, right) => left[0].localeCompare(right[0]))
			.map(([type, count]) => `${type}:${count}`)
			.join(", ");
		if (byType.length > 0) {
			lines.push(`- by type: ${byType}`);
		}
		for (const artifact of [...input.manifest.artifacts].sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt)).slice(0, 8)) {
			const meta = [
				artifact.type,
				artifact.sha256 ? `sha256:${artifact.sha256.slice(0, 12)}` : undefined,
				artifact.relatedCommands[0] ? `cmd:${truncate(artifact.relatedCommands[0], 72)}` : undefined,
			]
				.filter((value): value is string => value !== undefined)
				.join(", ");
			lines.push(`- ${artifact.path} (${meta})`);
		}
	}

	lines.push("", "## Recent Activity");
	if (input.recentActivity.length === 0) {
		lines.push("- no recorded tool activity");
	} else {
		for (const activity of input.recentActivity.slice(0, 8)) {
			const artifactPart = activity.artifacts.length > 0 ? ` artifacts=${activity.artifacts.length}` : "";
			lines.push(`- ${activity.recordedAt} ${activity.tool} ${activity.target}${artifactPart}`);
			lines.push(`  ${truncate(activity.summary, 160)}`);
		}
	}

	if (input.previousSummary?.trim()) {
		lines.push("", "## Prior Narrative Context", truncate(input.previousSummary.trim(), 2000));
	}

	return `${lines.join("\n").trimEnd()}\n`;
}

export function findTrackerRecordById(tracker: FindingsTracker, id: string): TrackerRecordDetail | undefined {
	const hypothesis = tracker.hypotheses.find((record) => record.id === id);
	if (hypothesis) {
		return { kind: "hypothesis", record: hypothesis };
	}
	const finding = tracker.findings.find((record) => record.id === id);
	if (finding) {
		return { kind: "finding", record: finding };
	}
	const question = tracker.questions.find((record) => record.id === id);
	if (question) {
		return { kind: "question", record: question };
	}
	const evidence = tracker.evidence.find((record) => record.id === id);
	if (evidence) {
		return { kind: "evidence", record: evidence };
	}
	const deadEnd = tracker.deadEnds.find((record) => record.id === id);
	if (deadEnd) {
		return { kind: "deadEnd", record: deadEnd };
	}
	return undefined;
}

export function renderTrackerRecordDetail(tracker: FindingsTracker, id: string): string {
	const detail = findTrackerRecordById(tracker, id);
	if (!detail) {
		return `Pire Tracker Record\n- unknown id: ${id}`;
	}

	const lines = ["Pire Tracker Record", `- id: ${id}`, `- kind: ${detail.kind}`];
	switch (detail.kind) {
		case "hypothesis": {
			const record = detail.record;
			lines.push(`- title: ${record.title}`);
			lines.push(`- status: ${record.status}`);
			lines.push(`- confidence: ${record.confidence}`);
			lines.push(`- claim: ${record.claim}`);
			if (record.rationale) {
				lines.push(`- rationale: ${record.rationale}`);
			}
			lines.push(...renderLinks("Evidence Links", record.relatedEvidenceIds));
			lines.push(...renderLinks("Artifact Links", record.relatedArtifactIds.map(parseArtifactRef)));
			lines.push(...renderLinks("Question Links", record.relatedQuestionIds));
			break;
		}
		case "finding": {
			const record = detail.record;
			lines.push(`- title: ${record.title}`);
			lines.push(`- status: ${record.status}`);
			lines.push(`- severity: ${record.severity}`);
			lines.push(`- repro: ${record.reproStatus}`);
			lines.push(`- statement: ${record.statement}`);
			lines.push(...renderLinks("Basis", record.basis));
			lines.push(...renderLinks("Evidence Links", record.relatedEvidenceIds));
			lines.push(...renderLinks("Artifact Links", record.relatedArtifactIds.map(parseArtifactRef)));
			break;
		}
		case "question": {
			const record = detail.record;
			lines.push(`- status: ${record.status}`);
			lines.push(`- prompt: ${record.prompt}`);
			if (record.owner) {
				lines.push(`- owner: ${record.owner}`);
			}
			lines.push(...renderLinks("Evidence Links", record.relatedEvidenceIds));
			lines.push(...renderLinks("Blocked On", record.blockedOn));
			break;
		}
		case "evidence": {
			const record = detail.record;
			lines.push(`- kind: ${record.kind}`);
			lines.push(`- summary: ${record.summary}`);
			if (record.commandId) {
				lines.push(`- command: ${record.commandId}`);
			}
			lines.push(...renderLinks("Artifacts", record.artifactIds.map(parseArtifactRef)));
			lines.push(...renderLinks("Supports", record.supports));
			lines.push(...renderLinks("Refutes", record.refutes));
			break;
		}
		case "deadEnd": {
			const record = detail.record;
			lines.push(`- summary: ${record.summary}`);
			if (record.whyItFailed) {
				lines.push(`- why: ${record.whyItFailed}`);
			}
			if (record.doNotRepeatUntil) {
				lines.push(`- do not repeat until: ${record.doNotRepeatUntil}`);
			}
			lines.push(...renderLinks("Artifacts Checked", record.artifactsChecked.map(parseArtifactRef)));
			break;
		}
	}

	return lines.join("\n");
}
