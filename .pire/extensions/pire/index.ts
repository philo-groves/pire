import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	runBinaryFile,
	runBinaryHexdump,
	runBinaryNm,
	runBinaryObjdump,
	runBinaryReadelf,
	runBinaryStrings,
	type BinaryArtifactObservation,
	type BinaryToolDetails,
} from "./binary.js";
import {
	runDebugGdb,
	runDebugLldb,
	runDebugLtrace,
	runDebugStrace,
	type DebugArtifactObservation,
	type DebugToolDetails,
} from "./debug.js";
import {
	runDecompGhidraDecompile,
	runDecompGhidraFunctions,
	type DecompArtifactObservation,
	type DecompToolDetails,
} from "./decomp.js";
import {
	runDisasmRadare2Disassembly,
	runDisasmRizinFunctions,
	runDisasmRizinInfo,
	type DisasmArtifactObservation,
	type DisasmToolDetails,
} from "./disasm.js";
import {
	runNetCurlHead,
	runNetTsharkFollow,
	runNetTsharkSummary,
	type NetArtifactObservation,
	type NetToolDetails,
} from "./net.js";
import {
	runUnpackArchiveList,
	runUnpackBinwalkExtract,
	runUnpackBinwalkScan,
	type UnpackArtifactObservation,
	type UnpackToolDetails,
} from "./unpack.js";
import {
	buildArtifactManifestSummary,
	loadArtifactManifest,
	recordArtifact,
	resolveArtifactPath,
	saveArtifactManifest,
	summarizeArtifactManifest,
	type ArtifactManifest,
	type ArtifactType,
} from "./artifacts.js";
import {
	addDeadEnd,
	addEvidence,
	addFinding,
	addHypothesis,
	addQuestion,
	buildArtifactRef,
	buildFindingsPromptSummary,
	buildFindingsTrackerSummary,
	buildFindingsWidgetLines,
	loadFindingsTracker,
	saveFindingsTracker,
	summarizeFindingsTracker,
	updateFinding,
	updateHypothesis,
	updateQuestion,
	type FindingsTracker,
	type EvidenceKind,
	type FindingStatus,
	type HypothesisStatus,
	type QuestionStatus,
	type ReproStatus,
	type Severity,
} from "./findings.js";
import { collectEnvironmentInventory, formatInventorySummary, type EnvironmentInventory } from "./inventory.js";

type PireMode = "recon" | "dynamic" | "proofing" | "report";

interface PersistedModeState {
	mode: PireMode;
}

interface PireToolActivity {
	tool: string;
	target: string;
	summary: string;
	artifacts: string[];
	recordedAt: string;
}

const MODE_ENTRY_TYPE = "pire-mode";
const ARTIFACT_ENTRY_TYPE = "pire-artifacts";
const TRACKER_ENTRY_TYPE = "pire-findings-tracker";
const TOOL_ACTIVITY_ENTRY_TYPE = "pire-tool-activity";
const MODE_FLAG = "pire-mode";
const MODE_TOOLS: Record<PireMode, string[]> = {
	recon: [
		"research_tracker",
		"read",
		"bash",
		"grep",
		"find",
		"ls",
		"environment_inventory",
		"binary_file",
		"binary_strings",
		"binary_readelf",
		"binary_objdump",
		"binary_nm",
		"binary_xxd",
		"disasm_rizin_info",
		"disasm_rizin_functions",
		"disasm_radare2_disassembly",
		"decomp_ghidra_functions",
		"decomp_ghidra_decompile",
		"net_curl_head",
		"net_tshark_summary",
		"net_tshark_follow",
		"unpack_binwalk_scan",
		"unpack_archive_list",
	],
	dynamic: [
		"research_tracker",
		"read",
		"bash",
		"grep",
		"find",
		"ls",
		"environment_inventory",
		"binary_file",
		"binary_strings",
		"binary_readelf",
		"binary_objdump",
		"binary_nm",
		"binary_xxd",
		"disasm_rizin_info",
		"disasm_rizin_functions",
		"disasm_radare2_disassembly",
		"decomp_ghidra_functions",
		"decomp_ghidra_decompile",
		"net_curl_head",
		"net_tshark_summary",
		"net_tshark_follow",
		"unpack_binwalk_scan",
		"unpack_archive_list",
		"unpack_binwalk_extract",
		"debug_gdb",
		"debug_lldb",
		"debug_strace",
		"debug_ltrace",
	],
	proofing: [
		"research_tracker",
		"read",
		"bash",
		"edit",
		"write",
		"grep",
		"find",
		"ls",
		"environment_inventory",
		"binary_file",
		"binary_strings",
		"binary_readelf",
		"binary_objdump",
		"binary_nm",
		"binary_xxd",
		"disasm_rizin_info",
		"disasm_rizin_functions",
		"disasm_radare2_disassembly",
		"decomp_ghidra_functions",
		"decomp_ghidra_decompile",
		"net_curl_head",
		"net_tshark_summary",
		"net_tshark_follow",
		"unpack_binwalk_scan",
		"unpack_archive_list",
		"unpack_binwalk_extract",
		"debug_gdb",
		"debug_lldb",
		"debug_strace",
		"debug_ltrace",
	],
	report: [
		"research_tracker",
		"read",
		"bash",
		"edit",
		"write",
		"grep",
		"find",
		"ls",
		"environment_inventory",
		"binary_file",
		"binary_strings",
		"binary_readelf",
		"binary_objdump",
		"binary_nm",
		"binary_xxd",
		"disasm_rizin_info",
		"disasm_rizin_functions",
		"disasm_radare2_disassembly",
		"decomp_ghidra_functions",
		"decomp_ghidra_decompile",
		"net_curl_head",
		"net_tshark_summary",
		"net_tshark_follow",
		"unpack_binwalk_scan",
		"unpack_archive_list",
		"unpack_binwalk_extract",
	],
};

const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\btee\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|stash|clone)/i,
	/\bnpm\s+(install|uninstall|update|ci|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill(all)?\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
];

const ACTIVE_PROBING_PATTERNS = [/\bnmap\b/i, /\bmasscan\b/i, /\bzmap\b/i, /\bgobuster\b/i, /\bffuf\b/i, /\bwfuzz\b/i, /\bnikto\b/i, /\bsqlmap\b/i];

const SAFE_READ_ONLY_PATTERNS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*bat\b/,
	/^\s*exa\b/,
	/^\s*strings\b/,
	/^\s*readelf\b/,
	/^\s*objdump\b/,
	/^\s*nm\b/,
	/^\s*xxd\b/,
	/^\s*sha(1|224|256|384|512)sum\b/,
	/^\s*md5(sum)?\b/,
	/^\s*rizin\b/,
	/^\s*radare2\b/,
	/^\s*curl\b/,
	/^\s*tcpdump\b/,
	/^\s*tshark\b/,
];

const DYNAMIC_PATTERNS = [
	/^\s*gdb\b/,
	/^\s*lldb\b/,
	/^\s*rr\b/,
	/^\s*strace\b/,
	/^\s*ltrace\b/,
	/^\s*perf\b/,
	/^\s*bpftrace\b/,
	/^\s*qemu(-system-x86_64|-aarch64)?\b/,
];

function isPireMode(value: string): value is PireMode {
	return value === "recon" || value === "dynamic" || value === "proofing" || value === "report";
}

function isAllowedResearchCommand(command: string, mode: PireMode): boolean {
	if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command))) {
		return false;
	}

	if (mode !== "proofing" && ACTIVE_PROBING_PATTERNS.some((pattern) => pattern.test(command))) {
		return false;
	}

	if (mode === "proofing") {
		return true;
	}

	if (SAFE_READ_ONLY_PATTERNS.some((pattern) => pattern.test(command))) {
		return true;
	}

	return mode === "dynamic" && DYNAMIC_PATTERNS.some((pattern) => pattern.test(command));
}

function formatModePrompt(mode: PireMode): string {
	const lines = [
		`[PIRE MODE: ${mode.toUpperCase()}]`,
		"Operate as a security-research harness, not a generic coding assistant.",
		"Distinguish facts, inferences, and assumptions explicitly.",
		"Preserve exact commands, hashes, offsets, addresses, symbols, and crash signatures.",
	];

	if (mode === "recon") {
		lines.push("Recon mode is read-only. Prefer inventory, environment validation, and hypothesis generation before action.");
		lines.push("Do not edit or write files. Avoid active probing or destructive commands.");
	} else if (mode === "dynamic") {
		lines.push("Dynamic mode allows runtime observation and tracing, but still avoids mutation and active external probing by default.");
		lines.push("Do not edit or write files unless the user explicitly switches to proofing or report mode.");
	} else if (mode === "proofing") {
		lines.push("Proofing mode is explicitly authorized for mutation, reproduction harnesses, and tightly scoped proof-of-concept work.");
		lines.push("Keep modifications narrow and evidence-driven.");
	} else {
		lines.push("Report mode focuses on synthesizing evidence into durable notes, advisories, and reproducible write-ups.");
		lines.push("Preserve technical specificity and label uncertainty clearly.");
	}

	return lines.join("\n");
}

function updateStatus(ctx: ExtensionContext, mode: PireMode): void {
	ctx.ui.setStatus("pire-mode", ctx.ui.theme.fg("accent", `mode:${mode}`));
}

function updateArtifactStatus(ctx: ExtensionContext, manifest: ArtifactManifest): void {
	const summary = buildArtifactManifestSummary(manifest);
	const typeParts = Object.entries(summary.byType)
		.sort((left, right) => (right[1] ?? 0) - (left[1] ?? 0))
		.slice(0, 2)
		.map(([type, count]) => `${type}:${count}`)
		.join(",");
	const text = summary.total === 0 ? "artifacts:0" : typeParts.length > 0 ? `artifacts:${summary.total} ${typeParts}` : `artifacts:${summary.total}`;
	ctx.ui.setStatus("pire-artifacts", ctx.ui.theme.fg("accent", text));
}

function updateActivityStatus(ctx: ExtensionContext, activity?: PireToolActivity): void {
	if (!activity) {
		ctx.ui.setStatus("pire-activity", undefined);
		return;
	}
	ctx.ui.setStatus("pire-activity", ctx.ui.theme.fg("accent", `last:${activity.tool}`));
}

function updateTrackerStatus(ctx: ExtensionContext, tracker: FindingsTracker): void {
	const summary = buildFindingsTrackerSummary(tracker);
	ctx.ui.setStatus(
		"pire-tracker",
		ctx.ui.theme.fg("accent", `tracker:h${summary.openHypotheses}/f${summary.confirmedFindings}/q${summary.blockedQuestions}`),
	);
	ctx.ui.setWidget("pire-tracker", buildFindingsWidgetLines(tracker), { placement: "belowEditor" });
}

function summarizeToolResult(event: {
	toolName: string;
	content: Array<{ type: string; text?: string }>;
}): string {
	const firstLine = event.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.flatMap((part) => part.text.split("\n"))
		.map((line) => line.trim())
		.find((line) => line.length > 0);
	return firstLine ?? `${event.toolName} completed`;
}

function getBinaryToolDetails(eventDetails: unknown): BinaryToolDetails | undefined {
	if (!eventDetails || typeof eventDetails !== "object" || !("artifacts" in eventDetails)) {
		return undefined;
	}
	return eventDetails as BinaryToolDetails;
}

function getDebugToolDetails(eventDetails: unknown): DebugToolDetails | undefined {
	if (!eventDetails || typeof eventDetails !== "object" || !("artifacts" in eventDetails)) {
		return undefined;
	}
	return eventDetails as DebugToolDetails;
}

function getDecompToolDetails(eventDetails: unknown): DecompToolDetails | undefined {
	if (!eventDetails || typeof eventDetails !== "object" || !("artifacts" in eventDetails)) {
		return undefined;
	}
	return eventDetails as DecompToolDetails;
}

function getDisasmToolDetails(eventDetails: unknown): DisasmToolDetails | undefined {
	if (!eventDetails || typeof eventDetails !== "object" || !("artifacts" in eventDetails)) {
		return undefined;
	}
	return eventDetails as DisasmToolDetails;
}

function getNetToolDetails(eventDetails: unknown): NetToolDetails | undefined {
	if (!eventDetails || typeof eventDetails !== "object" || !("artifacts" in eventDetails)) {
		return undefined;
	}
	return eventDetails as NetToolDetails;
}

function getUnpackToolDetails(eventDetails: unknown): UnpackToolDetails | undefined {
	if (!eventDetails || typeof eventDetails !== "object" || !("artifacts" in eventDetails)) {
		return undefined;
	}
	return eventDetails as UnpackToolDetails;
}

export default function pireExtension(pi: ExtensionAPI): void {
	let currentMode: PireMode = "recon";
	let currentCwd = process.cwd();
	let artifactManifest: ArtifactManifest = { version: 1, updatedAt: new Date().toISOString(), artifacts: [] };
	let findingsTracker: FindingsTracker = {
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
	let lastActivity: PireToolActivity | undefined;

	const persistMode = (): void => {
		pi.appendEntry<PersistedModeState>(MODE_ENTRY_TYPE, { mode: currentMode });
	};

	const persistArtifacts = async (): Promise<void> => {
		const manifestPath = await saveArtifactManifest(currentCwd, artifactManifest);
		const summary = buildArtifactManifestSummary(artifactManifest);
		pi.appendEntry(ARTIFACT_ENTRY_TYPE, {
			updatedAt: artifactManifest.updatedAt,
			count: artifactManifest.artifacts.length,
			manifestPath,
			byType: summary.byType,
			recentPaths: summary.recentPaths,
			});
	};

	const persistTracker = async (): Promise<void> => {
		const paths = await saveFindingsTracker(currentCwd, findingsTracker);
		const summary = buildFindingsTrackerSummary(findingsTracker);
		pi.appendEntry(TRACKER_ENTRY_TYPE, {
			updatedAt: findingsTracker.updatedAt,
			jsonPath: paths.jsonPath,
			markdownPath: paths.markdownPath,
			summary,
			tracker: findingsTracker,
		});
	};

	const applyMode = (ctx: ExtensionContext, mode: PireMode, options?: { notify?: boolean }): void => {
		currentMode = mode;
		pi.setActiveTools(MODE_TOOLS[mode]);
		updateStatus(ctx, mode);
		updateArtifactStatus(ctx, artifactManifest);
		updateTrackerStatus(ctx, findingsTracker);
		updateActivityStatus(ctx, lastActivity);
		persistMode();
		if (options?.notify !== false) {
			ctx.ui.notify(`pire mode: ${mode}`, "info");
		}
	};

	const showInventory = async (ctx: ExtensionContext): Promise<void> => {
		const inventory = await collectEnvironmentInventory(ctx.cwd, (command, args) => pi.exec(command, args, { cwd: ctx.cwd }));
		pi.sendMessage<EnvironmentInventory>(
			{
				customType: "pire-env-inventory",
				content: formatInventorySummary(inventory),
				display: true,
				details: inventory,
				},
				{ triggerTurn: false },
			);
		};

	const showTracker = (filterText?: string): void => {
		pi.sendMessage(
			{
				customType: "pire-tracker",
				content: summarizeFindingsTracker(findingsTracker, filterText),
				display: true,
				details: {
					filter: filterText,
					summary: buildFindingsTrackerSummary(findingsTracker),
					tracker: findingsTracker,
				},
			},
			{ triggerTurn: false },
		);
	};

	const showArtifacts = (filterText?: string): void => {
		pi.sendMessage(
			{
				customType: "pire-artifact-manifest",
				content: summarizeArtifactManifest(artifactManifest, filterText),
				display: true,
				details: {
					manifest: artifactManifest,
					summary: buildArtifactManifestSummary(artifactManifest),
					filter: filterText,
				},
			},
			{ triggerTurn: false },
		);
	};

	const observeArtifact = async (
		ctx: ExtensionContext,
		path: string,
		provenance: string,
		options?: { type?: ArtifactType; command?: string; finding?: string },
	): Promise<void> => {
		artifactManifest = await recordArtifact(artifactManifest, {
			path: resolveArtifactPath(ctx.cwd, path),
			type: options?.type,
			provenance,
			command: options?.command,
			finding: options?.finding,
		});
		await persistArtifacts();
	};

	const recordToolActivity = (
		ctx: ExtensionContext,
		activity: Omit<PireToolActivity, "recordedAt"> & { recordedAt?: string },
	): void => {
		lastActivity = {
			...activity,
			recordedAt: activity.recordedAt ?? new Date().toISOString(),
		};
		pi.appendEntry<PireToolActivity>(TOOL_ACTIVITY_ENTRY_TYPE, lastActivity);
			updateActivityStatus(ctx, lastActivity);
		};

	const syncTrackerUI = (ctx: ExtensionContext): void => {
		updateTrackerStatus(ctx, findingsTracker);
	};

	const showActivity = (ctx: ExtensionContext, filterText?: string): void => {
		const normalizedFilter = filterText?.trim().toLowerCase() ?? "";
		const activities = ctx.sessionManager
			.getEntries()
			.flatMap((entry) => {
				if (entry.type !== "custom" || entry.customType !== TOOL_ACTIVITY_ENTRY_TYPE || entry.data === undefined) {
					return [];
				}
				return [entry.data as PireToolActivity];
			})
			.filter((entry) => {
				if (normalizedFilter.length === 0) {
					return true;
				}
				return (
					entry.tool.toLowerCase().includes(normalizedFilter) ||
					entry.target.toLowerCase().includes(normalizedFilter) ||
					entry.summary.toLowerCase().includes(normalizedFilter)
				);
			})
			.slice(-8)
			.reverse();

		const lines =
			activities.length === 0
				? [`Pire Activity`, normalizedFilter.length > 0 ? `- filter: ${normalizedFilter}` : "- no recorded tool activity yet"]
				: [
						"Pire Activity",
						...(normalizedFilter.length > 0 ? [`- filter: ${normalizedFilter}`] : []),
						...activities.map((entry) => `- ${entry.tool} ${entry.target} (${entry.artifacts.length} artifacts)`),
				  ];

		pi.sendMessage(
			{
				customType: "pire-tool-activity",
				content: lines.join("\n"),
				display: true,
				details: {
					filter: normalizedFilter.length > 0 ? normalizedFilter : undefined,
					activities,
				},
			},
			{ triggerTurn: false },
		);
	};

	pi.registerFlag(MODE_FLAG, {
		description: "Start pire in a specific mode: recon, dynamic, proofing, report",
		type: "string",
	});

	pi.registerTool({
		name: "research_tracker",
		label: "Research Tracker",
		description: "Update the structured hypothesis, findings, questions, evidence, and dead-end tracker for this pire session.",
		promptSnippet: "Use research_tracker to persist hypotheses, findings, evidence, open questions, and dead ends as structured state.",
		promptGuidelines: [
			"Record new evidence immediately after meaningful tool output instead of relying on the transcript alone.",
			"Promote findings only when you can cite evidence IDs or concrete basis statements.",
		],
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("list"),
				Type.Literal("add_hypothesis"),
				Type.Literal("update_hypothesis"),
				Type.Literal("add_finding"),
				Type.Literal("update_finding"),
				Type.Literal("add_question"),
				Type.Literal("update_question"),
				Type.Literal("add_evidence"),
				Type.Literal("add_dead_end"),
			]),
			filter: Type.Optional(Type.String()),
			id: Type.Optional(Type.String()),
			title: Type.Optional(Type.String()),
			claim: Type.Optional(Type.String()),
			rationale: Type.Optional(Type.String()),
			statement: Type.Optional(Type.String()),
			prompt: Type.Optional(Type.String()),
			summary: Type.Optional(Type.String()),
			whyItFailed: Type.Optional(Type.String()),
			owner: Type.Optional(Type.String()),
			status: Type.Optional(Type.String()),
			confidence: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
			severity: Type.Optional(
				Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("critical")]),
			),
			reproStatus: Type.Optional(
				Type.Union([Type.Literal("not-reproduced"), Type.Literal("partial"), Type.Literal("reproduced")]),
			),
			kind: Type.Optional(
				Type.Union([
					Type.Literal("tool-result"),
					Type.Literal("observation"),
					Type.Literal("trace"),
					Type.Literal("artifact"),
					Type.Literal("note"),
				]),
			),
			relatedEvidenceIds: Type.Optional(Type.Array(Type.String())),
			relatedArtifactIds: Type.Optional(Type.Array(Type.String())),
			relatedQuestionIds: Type.Optional(Type.Array(Type.String())),
			addEvidenceIds: Type.Optional(Type.Array(Type.String())),
			addArtifactIds: Type.Optional(Type.Array(Type.String())),
			addQuestionIds: Type.Optional(Type.Array(Type.String())),
			basis: Type.Optional(Type.Array(Type.String())),
			addBasis: Type.Optional(Type.Array(Type.String())),
			blockedOn: Type.Optional(Type.Array(Type.String())),
			addBlockedOn: Type.Optional(Type.Array(Type.String())),
			commandId: Type.Optional(Type.String()),
			artifactIds: Type.Optional(Type.Array(Type.String())),
			supports: Type.Optional(Type.Array(Type.String())),
			refutes: Type.Optional(Type.Array(Type.String())),
			artifactsChecked: Type.Optional(Type.Array(Type.String())),
			doNotRepeatUntil: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			let resultText = "";

			switch (params.action) {
				case "list": {
					resultText = summarizeFindingsTracker(findingsTracker, params.filter);
					break;
				}
				case "add_hypothesis": {
					if (!params.title || !params.claim) {
						resultText = "research_tracker add_hypothesis requires title and claim.";
						break;
					}
					const record = addHypothesis(findingsTracker, {
						title: params.title,
						claim: params.claim,
						rationale: params.rationale,
						confidence: params.confidence,
						relatedEvidenceIds: params.relatedEvidenceIds,
						relatedArtifactIds: params.relatedArtifactIds,
						relatedQuestionIds: params.relatedQuestionIds,
					});
					await persistTracker();
					syncTrackerUI(ctx);
					resultText = `Added hypothesis ${record.id}: ${record.title}`;
					break;
				}
				case "update_hypothesis": {
					if (!params.id) {
						resultText = "research_tracker update_hypothesis requires id.";
						break;
					}
					const status =
						params.status === "open" || params.status === "supported" || params.status === "refuted" || params.status === "needs-more-evidence"
							? (params.status as HypothesisStatus)
							: undefined;
					const record = updateHypothesis(findingsTracker, {
						id: params.id,
						title: params.title,
						claim: params.claim,
						rationale: params.rationale,
						status,
						confidence: params.confidence,
						addEvidenceIds: params.addEvidenceIds,
						addArtifactIds: params.addArtifactIds,
						addQuestionIds: params.addQuestionIds,
					});
					if (!record) {
						resultText = `Unknown hypothesis: ${params.id}`;
						break;
					}
					await persistTracker();
					syncTrackerUI(ctx);
					resultText = `Updated hypothesis ${record.id}: ${record.status}`;
					break;
				}
				case "add_finding": {
					if (!params.title || !params.statement) {
						resultText = "research_tracker add_finding requires title and statement.";
						break;
					}
					const status =
						params.status === "candidate" || params.status === "confirmed" || params.status === "reported"
							? (params.status as FindingStatus)
							: undefined;
					const record = addFinding(findingsTracker, {
						title: params.title,
						statement: params.statement,
						severity: params.severity,
						status,
						basis: params.basis,
						relatedEvidenceIds: params.relatedEvidenceIds,
						relatedArtifactIds: params.relatedArtifactIds,
						reproStatus: params.reproStatus,
					});
					await persistTracker();
					syncTrackerUI(ctx);
					resultText = `Added finding ${record.id}: ${record.title}`;
					break;
				}
				case "update_finding": {
					if (!params.id) {
						resultText = "research_tracker update_finding requires id.";
						break;
					}
					const status =
						params.status === "candidate" || params.status === "confirmed" || params.status === "reported"
							? (params.status as FindingStatus)
							: undefined;
					const record = updateFinding(findingsTracker, {
						id: params.id,
						title: params.title,
						statement: params.statement,
						severity: params.severity,
						status,
						reproStatus: params.reproStatus as ReproStatus | undefined,
						addBasis: params.addBasis,
						addEvidenceIds: params.addEvidenceIds,
						addArtifactIds: params.addArtifactIds,
					});
					if (!record) {
						resultText = `Unknown finding: ${params.id}`;
						break;
					}
					await persistTracker();
					syncTrackerUI(ctx);
					resultText = `Updated finding ${record.id}: ${record.status}`;
					break;
				}
				case "add_question": {
					if (!params.prompt) {
						resultText = "research_tracker add_question requires prompt.";
						break;
					}
					const status =
						params.status === "open" || params.status === "answered" || params.status === "blocked"
							? (params.status as QuestionStatus)
							: undefined;
					const record = addQuestion(findingsTracker, {
						prompt: params.prompt,
						status,
						owner: params.owner,
						blockedOn: params.blockedOn,
					});
					await persistTracker();
					syncTrackerUI(ctx);
					resultText = `Added question ${record.id}: ${record.prompt}`;
					break;
				}
				case "update_question": {
					if (!params.id) {
						resultText = "research_tracker update_question requires id.";
						break;
					}
					const status =
						params.status === "open" || params.status === "answered" || params.status === "blocked"
							? (params.status as QuestionStatus)
							: undefined;
					const record = updateQuestion(findingsTracker, {
						id: params.id,
						prompt: params.prompt,
						status,
						owner: params.owner,
						addBlockedOn: params.addBlockedOn,
					});
					if (!record) {
						resultText = `Unknown question: ${params.id}`;
						break;
					}
					await persistTracker();
					syncTrackerUI(ctx);
					resultText = `Updated question ${record.id}: ${record.status}`;
					break;
				}
				case "add_evidence": {
					if (!params.summary) {
						resultText = "research_tracker add_evidence requires summary.";
						break;
					}
					const record = addEvidence(findingsTracker, {
						kind: params.kind as EvidenceKind | undefined,
						summary: params.summary,
						commandId: params.commandId,
						artifactIds: params.artifactIds,
						supports: params.supports,
						refutes: params.refutes,
					});
					await persistTracker();
					syncTrackerUI(ctx);
					resultText = `Added evidence ${record.id}: ${record.summary}`;
					break;
				}
				case "add_dead_end": {
					if (!params.summary) {
						resultText = "research_tracker add_dead_end requires summary.";
						break;
					}
					const record = addDeadEnd(findingsTracker, {
						summary: params.summary,
						whyItFailed: params.whyItFailed,
						artifactsChecked: params.artifactsChecked,
						doNotRepeatUntil: params.doNotRepeatUntil,
					});
					await persistTracker();
					syncTrackerUI(ctx);
					resultText = `Added dead end ${record.id}: ${record.summary}`;
					break;
				}
			}

			return {
				content: [{ type: "text", text: resultText }],
				details: {
					action: params.action,
					summary: buildFindingsTrackerSummary(findingsTracker),
					tracker: findingsTracker,
				},
			};
		},
	});

	pi.registerTool({
		name: "environment_inventory",
		label: "Environment Inventory",
		description: "Inspect local analysis environment, installed RE tools, writable directories, and runtime posture.",
		promptSnippet: "Inspect the local analysis environment and installed research tooling.",
		promptGuidelines: ["Run environment_inventory early in security-research sessions to verify available tools and writable scratch locations."],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const inventory = await collectEnvironmentInventory(ctx.cwd, (command, args) => pi.exec(command, args, { cwd: ctx.cwd }));
			return {
				content: [{ type: "text", text: formatInventorySummary(inventory) }],
				details: inventory,
			};
		},
	});

	pi.registerTool({
		name: "binary_file",
		label: "Binary File",
		description: "Inspect binary metadata with file(1) and capture the target as a first-class artifact.",
		promptSnippet: "Use binary_file to identify a binary before deeper analysis.",
		promptGuidelines: ["Use binary_file early to normalize binary metadata and avoid ad-hoc shell parsing."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the binary or object file to inspect." }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runBinaryFile((command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }), path, signal);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "binary_strings",
		label: "Binary Strings",
		description: "Extract a bounded preview of printable strings from a binary.",
		promptSnippet: "Use binary_strings to extract bounded strings evidence from a binary.",
		promptGuidelines: ["Prefer binary_strings over raw bash when triaging embedded text, URLs, or error messages."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the binary or object file to inspect." }),
			minLength: Type.Optional(Type.Integer({ minimum: 1, maximum: 32, default: 4 })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 40 })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runBinaryStrings(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				path,
				{ minLength: params.minLength ?? 4, limit: params.limit ?? 40 },
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "binary_readelf",
		label: "Binary Readelf",
		description: "Inspect ELF headers, sections, symbols, or dynamic metadata with structured command details.",
		promptSnippet: "Use binary_readelf for ELF metadata instead of ad-hoc shell invocations.",
		promptGuidelines: ["Use binary_readelf to inspect headers, sections, program headers, symbols, or dynamic entries."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the ELF binary to inspect." }),
			view: Type.Optional(
				Type.Union([
					Type.Literal("file-header"),
					Type.Literal("sections"),
					Type.Literal("program-headers"),
					Type.Literal("symbols"),
					Type.Literal("dynamic"),
				]),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runBinaryReadelf(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				path,
				params.view ?? "file-header",
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "binary_objdump",
		label: "Binary Objdump",
		description: "Disassemble a binary with bounded preview output and normalized command metadata.",
		promptSnippet: "Use binary_objdump when you need a bounded disassembly preview.",
		promptGuidelines: ["Keep disassembly bounded. Use sections when possible to avoid massive output."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the binary or object file to disassemble." }),
			section: Type.Optional(Type.String({ description: "Optional section name, for example .text" })),
			lineLimit: Type.Optional(Type.Integer({ minimum: 5, maximum: 200, default: 80 })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runBinaryObjdump(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				path,
				{ section: params.section, lineLimit: params.lineLimit ?? 80 },
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "binary_nm",
		label: "Binary Nm",
		description: "List symbols from a binary with normalized command metadata.",
		promptSnippet: "Use binary_nm to enumerate symbols from a binary or object file.",
		promptGuidelines: ["Use binary_nm when symbol presence matters; keep previews bounded."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the binary or object file to inspect." }),
			demangle: Type.Optional(Type.Boolean({ default: true })),
			definedOnly: Type.Optional(Type.Boolean({ default: false })),
			lineLimit: Type.Optional(Type.Integer({ minimum: 5, maximum: 200, default: 80 })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runBinaryNm(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				path,
				{
					demangle: params.demangle ?? true,
					definedOnly: params.definedOnly ?? false,
					lineLimit: params.lineLimit ?? 80,
				},
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "binary_xxd",
		label: "Binary Hexdump",
		description: "Read a bounded hexdump preview from a binary.",
		promptSnippet: "Use binary_xxd for bounded byte-level inspection of a binary.",
		promptGuidelines: ["Prefer binary_xxd over shelling out manually when you need offsets and byte previews."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the binary or object file to inspect." }),
			offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
			length: Type.Optional(Type.Integer({ minimum: 1, maximum: 4096, default: 256 })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runBinaryHexdump(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				path,
				{ offset: params.offset ?? 0, length: params.length ?? 256 },
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "disasm_rizin_info",
		label: "Disasm Rizin Info",
		description: "Run a bounded rizin info summary and persist the analysis log as an artifact.",
		promptSnippet: "Use disasm_rizin_info for structured binary metadata and section summaries.",
		promptGuidelines: ["Use disasm_rizin_info to capture binary and section summaries without raw shell parsing."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the binary to inspect." }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runDisasmRizinInfo(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				path,
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "disasm_rizin_functions",
		label: "Disasm Rizin Functions",
		description: "Run bounded rizin analysis to list discovered functions and persist the listing as an artifact.",
		promptSnippet: "Use disasm_rizin_functions to inventory analyzed functions from a binary.",
		promptGuidelines: ["Use disasm_rizin_functions when you need a function inventory before deeper reversing."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the binary to inspect." }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runDisasmRizinFunctions(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				path,
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "disasm_radare2_disassembly",
		label: "Disasm Radare2",
		description: "Run bounded radare2 disassembly and persist the resulting disassembly log as an artifact.",
		promptSnippet: "Use disasm_radare2_disassembly for bounded static disassembly previews.",
		promptGuidelines: ["Use disasm_radare2_disassembly when you want a bounded function or entry-point disassembly preview."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the binary to inspect." }),
			functionName: Type.Optional(Type.String({ description: "Optional function or symbol to seek before disassembly." })),
			lineCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 256, default: 64 })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runDisasmRadare2Disassembly(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				path,
				{
					functionName: params.functionName,
					lineCount: params.lineCount ?? 64,
				},
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "decomp_ghidra_functions",
		label: "Decomp Ghidra Functions",
		description: "Run Ghidra headless analysis to export a function list into a durable artifact.",
		promptSnippet: "Use decomp_ghidra_functions for Ghidra-based function inventory.",
		promptGuidelines: ["Use decomp_ghidra_functions when you want a durable function inventory from Ghidra headless analysis."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the binary to analyze with Ghidra." }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runDecompGhidraFunctions(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				path,
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "decomp_ghidra_decompile",
		label: "Decomp Ghidra Decompile",
		description: "Run Ghidra headless analysis to export bounded decompiled output into a durable artifact.",
		promptSnippet: "Use decomp_ghidra_decompile for Ghidra-based decompilation output.",
		promptGuidelines: ["Use decomp_ghidra_decompile when you want durable decompiled output for a target function or entry point."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the binary to analyze with Ghidra." }),
			functionName: Type.Optional(Type.String({ description: "Optional function name to decompile." })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runDecompGhidraDecompile(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				path,
				{
					functionName: params.functionName,
				},
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "debug_gdb",
		label: "Debug GDB",
		description: "Run bounded batch-mode GDB inspection commands against a target binary.",
		promptSnippet: "Use debug_gdb for structured debugger inspection in dynamic analysis sessions.",
		promptGuidelines: ["Use debug_gdb for read-only inspection such as info file or shared libraries."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the binary to inspect with gdb." }),
			view: Type.Optional(
				Type.Union([
					Type.Literal("info-file"),
					Type.Literal("info-functions"),
					Type.Literal("info-sharedlibrary"),
				]),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runDebugGdb(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				path,
				params.view ?? "info-file",
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "debug_lldb",
		label: "Debug LLDB",
		description: "Run bounded batch-mode LLDB inspection commands against a target binary.",
		promptSnippet: "Use debug_lldb for structured LLDB inspection in dynamic analysis sessions.",
		promptGuidelines: ["Use debug_lldb for read-only target inspection when LLDB is the available debugger."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the binary to inspect with lldb." }),
			view: Type.Optional(
				Type.Union([
					Type.Literal("image-list"),
					Type.Literal("target-modules"),
					Type.Literal("breakpoint-list"),
				]),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runDebugLldb(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				path,
				params.view ?? "image-list",
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "debug_strace",
		label: "Debug Strace",
		description: "Trace a target execution with strace and register the resulting trace log as an artifact.",
		promptSnippet: "Use debug_strace to capture syscall traces into durable artifacts.",
		promptGuidelines: ["Use debug_strace in dynamic mode when syscall-level evidence matters."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the executable to trace." }),
			argv: Type.Optional(Type.Array(Type.String())),
			followForks: Type.Optional(Type.Boolean({ default: true })),
			stringLimit: Type.Optional(Type.Integer({ minimum: 32, maximum: 8192, default: 256 })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runDebugStrace(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				path,
				{
					argv: params.argv ?? [],
					followForks: params.followForks ?? true,
					stringLimit: params.stringLimit ?? 256,
				},
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "debug_ltrace",
		label: "Debug Ltrace",
		description: "Trace library calls with ltrace and register the resulting trace log as an artifact.",
		promptSnippet: "Use debug_ltrace to capture library-call traces into durable artifacts.",
		promptGuidelines: ["Use debug_ltrace in dynamic mode when libc or PLT call behavior matters."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the executable to trace." }),
			argv: Type.Optional(Type.Array(Type.String())),
			followForks: Type.Optional(Type.Boolean({ default: true })),
			stringLimit: Type.Optional(Type.Integer({ minimum: 32, maximum: 8192, default: 256 })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runDebugLtrace(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				path,
				{
					argv: params.argv ?? [],
					followForks: params.followForks ?? true,
					stringLimit: params.stringLimit ?? 256,
				},
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "net_curl_head",
		label: "Net Curl Head",
		description: "Fetch bounded HTTP response headers and persist the capture as an artifact log.",
		promptSnippet: "Use net_curl_head for bounded HTTP header inspection.",
		promptGuidelines: ["Use net_curl_head for sanctioned HTTP inspection without falling back to raw bash."],
		parameters: Type.Object({
			url: Type.String({ description: "URL to inspect." }),
			followRedirects: Type.Optional(Type.Boolean({ default: true })),
			maxTimeSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 60, default: 10 })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const details = await runNetCurlHead(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				params.url,
				{
					followRedirects: params.followRedirects ?? true,
					maxTimeSeconds: params.maxTimeSeconds ?? 10,
				},
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "net_tshark_summary",
		label: "Net Tshark Summary",
		description: "Summarize a PCAP with tshark and persist the resulting summary log as an artifact.",
		promptSnippet: "Use net_tshark_summary for structured PCAP summaries.",
		promptGuidelines: ["Use net_tshark_summary for protocol hierarchy, endpoint, or conversation summaries from a PCAP."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the PCAP to inspect." }),
			view: Type.Optional(
				Type.Union([
					Type.Literal("protocol-hierarchy"),
					Type.Literal("endpoints-ip"),
					Type.Literal("conversations-ip"),
				]),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runNetTsharkSummary(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				path,
				{ view: params.view ?? "protocol-hierarchy" },
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "net_tshark_follow",
		label: "Net Tshark Follow",
		description: "Follow a stream from a PCAP with tshark and persist the decoded stream as an artifact log.",
		promptSnippet: "Use net_tshark_follow to decode a specific stream from a PCAP.",
		promptGuidelines: ["Use net_tshark_follow when you need a bounded stream transcript from a PCAP."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the PCAP to inspect." }),
			streamIndex: Type.Integer({ minimum: 0 }),
			protocol: Type.Optional(Type.Union([Type.Literal("tcp"), Type.Literal("udp"), Type.Literal("http")])),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runNetTsharkFollow(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				path,
				{
					streamIndex: params.streamIndex,
					protocol: params.protocol ?? "tcp",
				},
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "unpack_binwalk_scan",
		label: "Unpack Binwalk Scan",
		description: "Run binwalk in scan mode and persist the scan log as an artifact.",
		promptSnippet: "Use unpack_binwalk_scan to triage firmware images before extraction.",
		promptGuidelines: ["Use unpack_binwalk_scan before extraction to capture offsets and signatures."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the firmware image or blob to inspect." }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runUnpackBinwalkScan(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				path,
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "unpack_binwalk_extract",
		label: "Unpack Binwalk Extract",
		description: "Run binwalk extraction into a controlled artifact directory and register the results.",
		promptSnippet: "Use unpack_binwalk_extract when controlled firmware extraction is explicitly desired.",
		promptGuidelines: ["Use unpack_binwalk_extract in dynamic or proofing contexts when extraction is intentional."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the firmware image or blob to extract." }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runUnpackBinwalkExtract(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				path,
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "unpack_archive_list",
		label: "Unpack Archive List",
		description: "List the contents of a firmware-related tar or zip archive and persist the listing as an artifact.",
		promptSnippet: "Use unpack_archive_list for bounded archive inventory before extraction.",
		promptGuidelines: ["Use unpack_archive_list to inventory tar or zip archives before mutating or expanding them."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the archive to inspect." }),
			format: Type.Optional(Type.Union([Type.Literal("tar"), Type.Literal("zip")])),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runUnpackArchiveList(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				path,
				params.format ?? "tar",
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerCommand("mode", {
		description: "Show or change pire mode: /mode [recon|dynamic|proofing|report]",
		handler: async (args, ctx) => {
			const requested = args.trim().toLowerCase();
			if (!requested) {
				const choice = ctx.hasUI
					? await ctx.ui.select("Select pire mode", ["recon", "dynamic", "proofing", "report"])
					: undefined;
				if (!choice) {
					ctx.ui.notify(`current pire mode: ${currentMode}`, "info");
					return;
				}
				applyMode(ctx, choice as PireMode);
				return;
			}

			if (!isPireMode(requested)) {
				ctx.ui.notify(`unknown mode: ${requested}`, "error");
				return;
			}

			applyMode(ctx, requested);
		},
	});

	for (const mode of ["recon", "dynamic", "proofing", "report"] as const) {
		pi.registerCommand(mode, {
			description: `Switch pire to ${mode} mode`,
			handler: async (_args, ctx) => applyMode(ctx, mode),
		});
	}

	pi.registerCommand("env-inventory", {
		description: "Capture and display a structured environment inventory",
		handler: async (_args, ctx) => {
			await showInventory(ctx);
		},
	});

	pi.registerCommand("artifacts", {
		description: "Show the current pire artifact manifest summary, optionally filtered by type or substring",
		handler: async (args) => {
			const filterText = args.trim();
			showArtifacts(filterText.length > 0 ? filterText : undefined);
		},
	});

	pi.registerCommand("activity", {
		description: "Show recent pire tool-pack activity, optionally filtered by tool or target substring",
		handler: async (args, ctx) => {
			const filterText = args.trim();
			showActivity(ctx, filterText.length > 0 ? filterText : undefined);
		},
	});

	pi.registerCommand("tracker", {
		description: "Show the current pire hypothesis/findings tracker, optionally filtered by substring",
		handler: async (args) => {
			const filterText = args.trim();
			showTracker(filterText.length > 0 ? filterText : undefined);
		},
	});

	pi.registerCommand("findings", {
		description: "Alias for /tracker",
		handler: async (args) => {
			const filterText = args.trim();
			showTracker(filterText.length > 0 ? filterText : undefined);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		currentCwd = ctx.cwd;
		const flagValue = pi.getFlag(MODE_FLAG);
		const entries = ctx.sessionManager.getEntries();
		const persisted = entries
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === MODE_ENTRY_TYPE)
			.pop() as { data?: PersistedModeState } | undefined;

		const persistedMode = persisted?.data?.mode;
		const latestActivityEntry = entries
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === TOOL_ACTIVITY_ENTRY_TYPE)
			.pop() as { data?: PireToolActivity } | undefined;
		const latestTrackerEntry = ctx.sessionManager
			.getBranch()
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === TRACKER_ENTRY_TYPE)
			.pop() as { data?: { tracker?: FindingsTracker } } | undefined;
		const flagMode = typeof flagValue === "string" && isPireMode(flagValue) ? flagValue : undefined;
		artifactManifest = await loadArtifactManifest(ctx.cwd);
		findingsTracker = latestTrackerEntry?.data?.tracker ?? (await loadFindingsTracker(ctx.cwd));
		lastActivity = latestActivityEntry?.data;
		applyMode(ctx, flagMode ?? persistedMode ?? "recon", { notify: false });
	});

	pi.on("session_tree", async (_event, ctx) => {
		const latestTrackerEntry = ctx.sessionManager
			.getBranch()
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === TRACKER_ENTRY_TYPE)
			.pop() as { data?: { tracker?: FindingsTracker } } | undefined;
		findingsTracker = latestTrackerEntry?.data?.tracker ?? findingsTracker;
		syncTrackerUI(ctx);
	});

	pi.on("before_agent_start", async () => ({
		message: {
			customType: "pire-mode-context",
			content: `${formatModePrompt(currentMode)}\n\n${buildFindingsPromptSummary(findingsTracker)}`,
			display: false,
		},
	}));

	pi.on("tool_call", async (event) => {
		if (currentMode === "proofing") {
			return;
		}

		if ((event.toolName === "edit" || event.toolName === "write") && (currentMode === "recon" || currentMode === "dynamic")) {
			return {
				block: true,
				reason: `pire ${currentMode} mode blocks file mutation. Switch to /proofing or /report first if mutation is intentional.`,
			};
		}

		if (event.toolName === "bash") {
			const command = typeof event.input.command === "string" ? event.input.command : "";
			if (!isAllowedResearchCommand(command, currentMode)) {
				return {
					block: true,
					reason: `pire ${currentMode} mode blocked this command as destructive or outside the current posture.\nCommand: ${command}`,
				};
			}
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.isError) {
			return;
		}

		if (event.toolName !== "research_tracker") {
			const artifactIds: string[] = [];
			const observedArtifactPaths: string[] = [];
			const firstLine = summarizeToolResult(event);
			if (event.toolName === "read" || event.toolName === "write" || event.toolName === "edit") {
				const rawPath = typeof event.input.path === "string" ? event.input.path : undefined;
				if (rawPath) {
					const resolvedPath = resolveArtifactPath(ctx.cwd, rawPath);
					artifactIds.push(buildArtifactRef(resolvedPath));
					observedArtifactPaths.push(resolvedPath);
				}
			}

			const eventDetails = event.details;
			if (eventDetails && typeof eventDetails === "object" && "artifacts" in eventDetails && Array.isArray(eventDetails.artifacts)) {
				for (const artifact of eventDetails.artifacts) {
					if (
						artifact &&
						typeof artifact === "object" &&
						"path" in artifact &&
						typeof artifact.path === "string"
					) {
						const resolvedPath = resolveArtifactPath(ctx.cwd, artifact.path);
						artifactIds.push(buildArtifactRef(resolvedPath));
						observedArtifactPaths.push(resolvedPath);
					}
				}
			}

			addEvidence(findingsTracker, {
				kind: event.toolName === "debug_strace" || event.toolName === "debug_ltrace" ? "trace" : "tool-result",
				summary: `${event.toolName}: ${firstLine}`,
				commandId: `tool:${event.toolName}:${event.toolCallId}`,
				artifactIds,
			});
			await persistTracker();
			syncTrackerUI(ctx);
			if (event.toolName !== "read" && event.toolName !== "write" && event.toolName !== "edit" && event.toolName !== "bash") {
				for (const artifactPath of observedArtifactPaths) {
					artifactManifest = await recordArtifact(artifactManifest, {
						path: artifactPath,
						provenance: `tool:${event.toolName}`,
					});
				}
				if (observedArtifactPaths.length > 0) {
					await persistArtifacts();
					recordToolActivity(ctx, {
						tool: event.toolName,
						target: observedArtifactPaths[0] ?? event.toolName,
						summary: firstLine,
						artifacts: observedArtifactPaths,
					});
				}
			}
		}

		if (event.toolName === "read" || event.toolName === "write" || event.toolName === "edit") {
			const rawPath = typeof event.input.path === "string" ? event.input.path : undefined;
			if (rawPath) {
				await observeArtifact(ctx, rawPath, `tool:${event.toolName}`);
			}
			return;
		}

		if (event.toolName === "bash") {
			const fullOutputPath =
				event.details && typeof event.details === "object" && "fullOutputPath" in event.details
					? (event.details.fullOutputPath as string | undefined)
					: undefined;
			const command = typeof event.input.command === "string" ? event.input.command : undefined;
			if (fullOutputPath) {
				await observeArtifact(ctx, fullOutputPath, "tool:bash", {
					type: "log",
					command,
				});
			}
			return;
		}

		if (event.toolName === "environment_inventory") {
			recordToolActivity(ctx, {
				tool: event.toolName,
				target: ctx.cwd,
				summary: "Captured environment inventory",
				artifacts: [],
			});
			await persistArtifacts();
			return;
		}

		const binaryDetails = getBinaryToolDetails(event.details);
		if (binaryDetails) {
			for (const artifact of binaryDetails.artifacts as BinaryArtifactObservation[]) {
				await observeArtifact(ctx, artifact.path, `tool:${event.toolName}`, {
					type: artifact.type as ArtifactType | undefined,
					command: artifact.command ?? binaryDetails.commandString,
					finding: artifact.finding,
				});
			}
			recordToolActivity(ctx, {
				tool: event.toolName,
				target: binaryDetails.targetPath,
				summary: binaryDetails.summary.split("\n")[0] ?? event.toolName,
				artifacts: binaryDetails.artifacts.map((artifact) => artifact.path),
			});
			return;
		}

		const disasmDetails = getDisasmToolDetails(event.details);
		if (disasmDetails) {
			for (const artifact of disasmDetails.artifacts as DisasmArtifactObservation[]) {
				await observeArtifact(ctx, artifact.path, `tool:${event.toolName}`, {
					type: artifact.type as ArtifactType | undefined,
					command: artifact.command ?? disasmDetails.commandString,
					finding: artifact.finding,
				});
			}
			recordToolActivity(ctx, {
				tool: event.toolName,
				target: disasmDetails.targetPath,
				summary: disasmDetails.summary.split("\n")[0] ?? event.toolName,
				artifacts: disasmDetails.artifacts.map((artifact) => artifact.path),
			});
			return;
		}

		const decompDetails = getDecompToolDetails(event.details);
		if (decompDetails) {
			for (const artifact of decompDetails.artifacts as DecompArtifactObservation[]) {
				await observeArtifact(ctx, artifact.path, `tool:${event.toolName}`, {
					type: artifact.type as ArtifactType | undefined,
					command: artifact.command ?? decompDetails.commandString,
					finding: artifact.finding,
				});
			}
			recordToolActivity(ctx, {
				tool: event.toolName,
				target: decompDetails.targetPath,
				summary: decompDetails.summary.split("\n")[0] ?? event.toolName,
				artifacts: decompDetails.artifacts.map((artifact) => artifact.path),
			});
			return;
		}

		const debugDetails = getDebugToolDetails(event.details);
		if (debugDetails) {
			for (const artifact of debugDetails.artifacts as DebugArtifactObservation[]) {
				await observeArtifact(ctx, artifact.path, `tool:${event.toolName}`, {
					type: artifact.type as ArtifactType | undefined,
					command: artifact.command ?? debugDetails.commandString,
					finding: artifact.finding,
				});
			}
			recordToolActivity(ctx, {
				tool: event.toolName,
				target: debugDetails.targetPath,
				summary: debugDetails.summary.split("\n")[0] ?? event.toolName,
				artifacts: debugDetails.artifacts.map((artifact) => artifact.path),
			});
			return;
		}

		const netDetails = getNetToolDetails(event.details);
		if (netDetails) {
			for (const artifact of netDetails.artifacts as NetArtifactObservation[]) {
				await observeArtifact(ctx, artifact.path, `tool:${event.toolName}`, {
					type: artifact.type as ArtifactType | undefined,
					command: artifact.command ?? netDetails.commandString,
					finding: artifact.finding,
				});
			}
			recordToolActivity(ctx, {
				tool: event.toolName,
				target: netDetails.target,
				summary: netDetails.summary.split("\n")[0] ?? event.toolName,
				artifacts: netDetails.artifacts.map((artifact) => artifact.path),
			});
			return;
		}

			const unpackDetails = getUnpackToolDetails(event.details);
			if (unpackDetails) {
			for (const artifact of unpackDetails.artifacts as UnpackArtifactObservation[]) {
				await observeArtifact(ctx, artifact.path, `tool:${event.toolName}`, {
					type: artifact.type as ArtifactType | undefined,
					command: artifact.command ?? unpackDetails.commandString,
					finding: artifact.finding,
				});
			}
				recordToolActivity(ctx, {
					tool: event.toolName,
					target: unpackDetails.targetPath,
					summary: unpackDetails.summary.split("\n")[0] ?? event.toolName,
					artifacts: unpackDetails.artifacts.map((artifact) => artifact.path),
				});
				return;
			}

			const inferredPathTarget = typeof event.input.path === "string" ? resolveArtifactPath(ctx.cwd, event.input.path) : undefined;
			const inferredStringTarget =
				typeof event.input.url === "string"
					? event.input.url
					: typeof event.input.path === "string"
						? resolveArtifactPath(ctx.cwd, event.input.path)
						: undefined;
			if (
				event.toolName.startsWith("binary_") ||
				event.toolName.startsWith("disasm_") ||
				event.toolName.startsWith("decomp_") ||
				event.toolName.startsWith("debug_") ||
				event.toolName.startsWith("net_") ||
				event.toolName.startsWith("unpack_")
			) {
				if (inferredPathTarget) {
					await observeArtifact(ctx, inferredPathTarget, `tool:${event.toolName}`);
				}
				if (inferredStringTarget) {
					recordToolActivity(ctx, {
						tool: event.toolName,
						target: inferredStringTarget,
						summary: summarizeToolResult(event),
						artifacts: inferredPathTarget ? [inferredPathTarget] : [],
					});
				}
			}
		});
	}
