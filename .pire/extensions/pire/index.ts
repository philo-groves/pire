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
	runDebugGdbCommands,
	runDebugGdbScript,
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
	runExploitRopgadget,
	type ExploitArtifactObservation,
	type ExploitToolDetails,
} from "./exploit.js";
import {
	runDisasmRadare2Disassembly,
	runDisasmRadare2GadgetSearch,
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
	runWebCdpDiscover,
	runWebCdpRuntimeEval,
	type WebArtifactObservation,
	type WebToolDetails,
} from "./web.js";
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
import {
	addCampaignReportPath,
	appendCampaignJournalEntry,
	buildCampaignLedgerSummary,
	buildCampaignPromptSummary,
	campaignStatusRequiresNote,
	createCampaignChain,
	loadCampaignLedger,
	renderCampaignChainDetail,
	renderCampaignDetail,
	saveCampaignLedger,
	summarizeCampaignChains,
	summarizeOpenCampaignLedger,
	summarizeRecentCampaignLedger,
	summarizeCampaignLedger,
	type CampaignChainStatus,
	type CampaignFindingStatus,
	type CampaignLedger,
	type CampaignLedgerSummary,
	upsertCampaignFinding,
	updateCampaignChain,
	updateCampaignFindingStatus,
	validateCampaignStatusNote,
} from "./campaign.js";
import {
	runPlatformHyperv,
	runPlatformMacos,
	runPlatformPowershell,
	runPlatformXcrun,
	type PlatformArtifactObservation,
	type PlatformToolDetails,
} from "./platform.js";
import {
	ReproBundleAssessmentError,
	buildNotebookDocument,
	generateReproBundle,
	inferArtifactTypeFromExportPath,
	writeNotebookExport,
	type NotebookFormat,
} from "./reporting.js";
import {
	buildResearchCompactionSummary,
	formatRolePrompt,
	formatSessionTypePrompt,
	getRoleProfile,
	getSessionTypeProfile,
	isPireRole,
	isPireSessionType,
	PIRE_ROLE_ORDER,
	PIRE_SESSION_TYPE_ORDER,
	type PireMode,
	type PireRole,
	type PireSessionType,
	type PireToolActivity,
	renderTrackerRecordDetail,
} from "./research-runtime.js";
import {
	ACTIVE_PROBING_PATTERNS,
	PERSISTENCE_PATTERNS,
	allowActiveProbe,
	allowObservationTarget,
	allowPersistence,
	buildSafetyPrompt,
	createDefaultSafetyPosture,
	summarizeSafetyPosture,
	type PireSafetyIntent,
	type PireSafetyPosture,
	type PireSafetyScope,
} from "./safety.js";
import {
	createPireEvalRunBundleFromSession,
	formatPireEvalRunScoreReport,
	loadPireEvalSessionBindingFile,
	loadPireEvalTaskSuite,
	savePireEvalRunBundle,
} from "../../../packages/coding-agent/src/core/pire/eval-runner.js";
import { scorePireEvalRunBundle } from "../../../packages/coding-agent/src/core/pire/eval-bundles.js";

interface PersistedModeState {
	mode: PireMode;
}

interface PersistedRoleState {
	role: PireRole;
}

interface PersistedSessionTypeState {
	sessionType: PireSessionType;
}

interface FocusState {
	hypothesisIds: string[];
	findingIds: string[];
	questionIds: string[];
	updatedAt: string;
}

interface PersistedInventoryState {
	capturedAt: string;
	source: "auto" | "command" | "tool";
	inventory: EnvironmentInventory;
}

interface PersistedSafetyState {
	posture: PireSafetyPosture;
}

interface PersistedCampaignState {
	updatedAt: string;
	jsonPath: string;
	statusPath: string;
	summary: CampaignLedgerSummary;
	ledger: CampaignLedger;
}

const MODE_ENTRY_TYPE = "pire-mode";
const ROLE_ENTRY_TYPE = "pire-role";
const SESSION_TYPE_ENTRY_TYPE = "pire-session-type";
const ARTIFACT_ENTRY_TYPE = "pire-artifacts";
const TRACKER_ENTRY_TYPE = "pire-findings-tracker";
const TOOL_ACTIVITY_ENTRY_TYPE = "pire-tool-activity";
const INVENTORY_ENTRY_TYPE = "pire-env-inventory-state";
const FOCUS_ENTRY_TYPE = "pire-focus";
const SAFETY_ENTRY_TYPE = "pire-safety";
const CAMPAIGN_ENTRY_TYPE = "pire-campaign";
const MODE_FLAG = "pire-mode";
const ROLE_FLAG = "pire-role";
const SESSION_TYPE_FLAG = "pire-session";
const MODE_TOOLS: Record<PireMode, string[]> = {
	recon: ["research_tracker", "read", "bash", "environment_inventory"],
	dynamic: ["research_tracker", "read", "bash", "environment_inventory"],
	proofing: ["research_tracker", "read", "bash", "edit", "write", "environment_inventory"],
	report: ["research_tracker", "read", "bash", "edit", "write", "environment_inventory"],
};
const SESSION_TYPE_TOOLS: Partial<Record<PireSessionType, string[]>> = {
	"web-security-review": ["net_curl_head", "web_cdp_discover", "web_cdp_runtime_eval"],
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

	if (DYNAMIC_PATTERNS.some((pattern) => pattern.test(command))) {
		return mode === "dynamic";
	}

	return true;
}

function formatModePrompt(mode: PireMode): string {
	const lines = [
		`[PIRE MODE: ${mode.toUpperCase()}]`,
		"Operate as a security-research harness, not a generic coding assistant.",
		"Distinguish facts, inferences, and assumptions explicitly.",
		"Preserve exact commands, hashes, offsets, addresses, symbols, and crash signatures.",
		"Prefer bash plus the standard CLI tooling available in PATH. Reach for custom harness tools only when they add durable research state such as tracker or inventory records.",
	];

	if (mode === "recon") {
		lines.push("Recon mode starts with inventory, environment validation, and hypothesis generation before mutation.");
		lines.push("Do not edit or write files. Avoid active probing or destructive commands, but keep moving with benign local analysis.");
	} else if (mode === "dynamic") {
		lines.push("Dynamic mode allows runtime observation and tracing while still avoiding mutation and active external probing by default.");
		lines.push("Do not edit or write files unless the user explicitly switches to proofing or report mode, but do not stall on safe local runtime checks.");
	} else if (mode === "proofing") {
		lines.push("Proofing mode is explicitly authorized for mutation, reproduction harnesses, and tightly scoped proof-of-concept work.");
		lines.push("Keep modifications narrow and evidence-driven.");
	} else {
		lines.push("Report mode focuses on synthesizing evidence into durable notes, advisories, and reproducible write-ups.");
		lines.push("Preserve technical specificity and label uncertainty clearly.");
	}

	return lines.join("\n");
}

function dedupeIds(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
}

function createEmptyFocusState(): FocusState {
	return {
		hypothesisIds: [],
		findingIds: [],
		questionIds: [],
		updatedAt: new Date().toISOString(),
	};
}

function buildInventoryPromptSummary(inventory?: EnvironmentInventory): string | undefined {
	if (!inventory) {
		return undefined;
	}
	const availableTools = inventory.tools
		.filter((tool) => tool.available)
		.map((tool) => tool.name)
		.sort()
		.slice(0, 12);
	return [
		"[PIRE ENVIRONMENT]",
		`Platform: ${inventory.platform}/${inventory.arch}; shell: ${inventory.shell ?? "unknown"}; writable dirs: ${inventory.writableDirs.join(", ") || "none"}.`,
		`Network posture: ${inventory.networkPosture}`,
		`Sandbox posture: ${inventory.sandboxPosture}`,
		`Available tools: ${availableTools.join(", ") || "none detected"}.`,
	].join("\n");
}

function updateStatus(ctx: ExtensionContext, mode: PireMode): void {
	ctx.ui.setStatus("pire-mode", ctx.ui.theme.fg("accent", `mode:${mode}`));
}

function updateRoleStatus(ctx: ExtensionContext, role?: PireRole): void {
	ctx.ui.setStatus("pire-role", role ? ctx.ui.theme.fg("accent", `role:${role}`) : undefined);
}

function updateSessionTypeStatus(ctx: ExtensionContext, sessionType?: PireSessionType): void {
	ctx.ui.setStatus("pire-session-type", sessionType ? ctx.ui.theme.fg("accent", `session:${sessionType}`) : undefined);
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

function updateFocusStatus(ctx: ExtensionContext, focus: FocusState): void {
	const parts = [
		focus.hypothesisIds[0] ? `h:${focus.hypothesisIds[0]}` : undefined,
		focus.findingIds[0] ? `f:${focus.findingIds[0]}` : undefined,
		focus.questionIds[0] ? `q:${focus.questionIds[0]}` : undefined,
	].filter((value): value is string => value !== undefined);
	ctx.ui.setStatus("pire-focus", parts.length > 0 ? ctx.ui.theme.fg("accent", `focus:${parts.join("/")}`) : undefined);
}

function updateSafetyStatus(ctx: ExtensionContext, posture: PireSafetyPosture): void {
	const suffix = posture.activeProbing.approved ? "+probe" : "";
	ctx.ui.setStatus("pire-safety", ctx.ui.theme.fg("accent", `safety:${posture.scope}/${posture.intent}${suffix}`));
}

function updateTrackerStatus(ctx: ExtensionContext, tracker: FindingsTracker): void {
	const summary = buildFindingsTrackerSummary(tracker);
	ctx.ui.setStatus(
		"pire-tracker",
		ctx.ui.theme.fg("accent", `tracker:h${summary.openHypotheses}/f${summary.confirmedFindings}/q${summary.blockedQuestions}`),
	);
	ctx.ui.setWidget("pire-tracker", buildFindingsWidgetLines(tracker), { placement: "belowEditor" });
}

function updateCampaignStatus(ctx: ExtensionContext, ledger: CampaignLedger): void {
	const summary = buildCampaignLedgerSummary(ledger);
	ctx.ui.setStatus(
		"pire-campaign",
		ctx.ui.theme.fg(
			"accent",
			`campaign:l${summary.leadFindings}/c${summary.confirmedFindings}/s${summary.submittedFindings}/x${summary.deEscalatedFindings + summary.blockedFindings}/ch${summary.activeChains}`,
		),
	);
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

function getWebToolDetails(eventDetails: unknown): WebToolDetails | undefined {
	if (!eventDetails || typeof eventDetails !== "object" || !("artifacts" in eventDetails)) {
		return undefined;
	}
	return eventDetails as WebToolDetails;
}

function getUnpackToolDetails(eventDetails: unknown): UnpackToolDetails | undefined {
	if (!eventDetails || typeof eventDetails !== "object" || !("artifacts" in eventDetails)) {
		return undefined;
	}
	return eventDetails as UnpackToolDetails;
}

function getPlatformToolDetails(eventDetails: unknown): PlatformToolDetails | undefined {
	if (!eventDetails || typeof eventDetails !== "object" || !("artifacts" in eventDetails)) {
		return undefined;
	}
	return eventDetails as PlatformToolDetails;
}

function collectRecentActivityFromEntries(
	entries: Array<{ type: string; customType?: string; data?: unknown }>,
): PireToolActivity[] {
	return entries
		.flatMap((entry) => {
			if (entry.type !== "custom" || entry.customType !== TOOL_ACTIVITY_ENTRY_TYPE || entry.data === undefined) {
				return [];
			}
			return [entry.data as PireToolActivity];
		})
		.slice(-8)
		.reverse();
}

export default function pireExtension(pi: ExtensionAPI): void {
	let currentMode: PireMode = "recon";
	let currentRole: PireRole | undefined;
	let currentSessionType: PireSessionType | undefined;
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
	let currentInventory: EnvironmentInventory | undefined;
	let currentFocus: FocusState = createEmptyFocusState();
	let currentSafety: PireSafetyPosture = createDefaultSafetyPosture();
	let campaignLedger: CampaignLedger = {
		version: 1,
		updatedAt: new Date().toISOString(),
		findings: [],
		chains: [],
		nextIds: { journal: 1, chain: 1 },
	};

	const persistMode = (): void => {
		pi.appendEntry<PersistedModeState>(MODE_ENTRY_TYPE, { mode: currentMode });
	};

	const persistRole = (): void => {
		if (currentRole) {
			pi.appendEntry<PersistedRoleState>(ROLE_ENTRY_TYPE, { role: currentRole });
		}
	};

	const persistSessionType = (): void => {
		if (currentSessionType) {
			pi.appendEntry<PersistedSessionTypeState>(SESSION_TYPE_ENTRY_TYPE, { sessionType: currentSessionType });
		}
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

	const persistInventory = (inventory: EnvironmentInventory, source: "auto" | "command" | "tool"): void => {
		currentInventory = inventory;
		pi.appendEntry<PersistedInventoryState>(INVENTORY_ENTRY_TYPE, {
			capturedAt: new Date().toISOString(),
			source,
			inventory,
		});
	};

	const persistFocus = (): void => {
		pi.appendEntry<FocusState>(FOCUS_ENTRY_TYPE, currentFocus);
	};

	const persistSafety = (): void => {
		pi.appendEntry<PersistedSafetyState>(SAFETY_ENTRY_TYPE, { posture: currentSafety });
	};

	const persistCampaign = async (): Promise<{ jsonPath: string; statusPath: string }> => {
		const paths = await saveCampaignLedger(currentCwd, campaignLedger);
		const summary = buildCampaignLedgerSummary(campaignLedger);
		pi.appendEntry<PersistedCampaignState>(CAMPAIGN_ENTRY_TYPE, {
			updatedAt: campaignLedger.updatedAt,
			jsonPath: paths.jsonPath,
			statusPath: paths.statusPath,
			summary,
			ledger: campaignLedger,
		});
		return paths;
	};

	const getActiveToolsForContext = (mode: PireMode, sessionType?: PireSessionType): string[] => {
		const sessionTools = sessionType ? (SESSION_TYPE_TOOLS[sessionType] ?? []) : [];
		return Array.from(new Set([...MODE_TOOLS[mode], ...sessionTools]));
	};

	const applyMode = (ctx: ExtensionContext, mode: PireMode, options?: { notify?: boolean }): void => {
		currentMode = mode;
		pi.setActiveTools(getActiveToolsForContext(mode, currentSessionType));
		updateStatus(ctx, mode);
		updateRoleStatus(ctx, currentRole);
		updateSessionTypeStatus(ctx, currentSessionType);
			updateArtifactStatus(ctx, artifactManifest);
			updateTrackerStatus(ctx, findingsTracker);
			updateActivityStatus(ctx, lastActivity);
			updateFocusStatus(ctx, currentFocus);
			updateSafetyStatus(ctx, currentSafety);
			updateCampaignStatus(ctx, campaignLedger);
			persistMode();
		if (options?.notify !== false) {
			ctx.ui.notify(`pire mode: ${mode}`, "info");
		}
	};

	const applyRole = (ctx: ExtensionContext, role: PireRole, options?: { notify?: boolean }): void => {
		currentRole = role;
		updateRoleStatus(ctx, role);
		persistRole();
		if (options?.notify !== false) {
			ctx.ui.notify(`pire role: ${getRoleProfile(role).label}`, "info");
		}
	};

	const tryApplySessionTypeModel = async (ctx: ExtensionContext, sessionType: PireSessionType): Promise<void> => {
		const profile = getSessionTypeProfile(sessionType);
		for (const modelHint of profile.modelHints) {
			for (const provider of ["anthropic", "google", "openai", "openai-codex"] as const) {
				const model = ctx.modelRegistry.find(provider, modelHint);
				if (!model) {
					continue;
				}
				const didSet = await pi.setModel(model);
				if (didSet) {
					return;
				}
			}
		}
	};

	const applySessionType = async (
		ctx: ExtensionContext,
		sessionType: PireSessionType,
		options?: { notify?: boolean; preserveRole?: boolean },
	): Promise<void> => {
		const profile = getSessionTypeProfile(sessionType);
		currentSessionType = sessionType;
		pi.setThinkingLevel(profile.thinkingLevel);
		applyMode(ctx, profile.defaultMode, { notify: false });
		if (!options?.preserveRole) {
			applyRole(ctx, profile.defaultRole, { notify: false });
		} else {
			updateRoleStatus(ctx, currentRole);
		}
		updateSessionTypeStatus(ctx, sessionType);
		persistSessionType();
		void tryApplySessionTypeModel(ctx, sessionType);
		if (options?.notify !== false) {
			ctx.ui.notify(`pire session type: ${profile.label}`, "info");
		}
	};

	const showInventory = async (ctx: ExtensionContext): Promise<void> => {
		const inventory = await collectEnvironmentInventory(ctx.cwd, (command, args) => pi.exec(command, args, { cwd: ctx.cwd }));
		persistInventory(inventory, "command");
		recordToolActivity(ctx, {
			tool: "environment_inventory",
			target: ctx.cwd,
			summary: "Captured environment inventory",
			artifacts: [],
		});
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

	const showSafety = (): void => {
		pi.sendMessage(
			{
				customType: "pire-safety",
				content: summarizeSafetyPosture(currentSafety),
				display: true,
				details: currentSafety,
			},
			{ triggerTurn: false },
		);
	};

	const showCampaign = (filterText?: string): void => {
		pi.sendMessage(
			{
				customType: "pire-campaign",
				content: summarizeCampaignLedger(campaignLedger, filterText),
				display: true,
				details: {
					filter: filterText,
					summary: buildCampaignLedgerSummary(campaignLedger),
					ledger: campaignLedger,
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

	const applySafety = (
		ctx: ExtensionContext,
		input: Partial<Pick<PireSafetyPosture, "scope" | "intent">> & {
			activeProbing?: PireSafetyPosture["activeProbing"];
		},
		options?: { notify?: boolean },
	): void => {
		currentSafety = {
			...currentSafety,
			...input,
			activeProbing: input.activeProbing ?? currentSafety.activeProbing,
			updatedAt: new Date().toISOString(),
		};
		updateSafetyStatus(ctx, currentSafety);
		persistSafety();
		if (options?.notify !== false) {
			ctx.ui.notify(`pire safety: ${currentSafety.scope}/${currentSafety.intent}`, "info");
		}
	};

	const syncCampaignUI = (ctx: ExtensionContext): void => {
		updateCampaignStatus(ctx, campaignLedger);
	};

	const syncCampaignFinding = async (
		ctx: ExtensionContext,
		findingId: string,
		summary: string,
	): Promise<void> => {
		const finding = findingsTracker.findings.find((record) => record.id === findingId);
		if (!finding) {
			return;
		}
		const result = upsertCampaignFinding(campaignLedger, {
			finding,
			tracker: findingsTracker,
			artifacts: artifactManifest.artifacts,
		});
		await appendCampaignJournalEntry(currentCwd, campaignLedger, {
			findingId: result.record.id,
			action: result.created ? "create" : "sync",
			summary,
			details: result.created
				? `created campaign record ${result.record.id} with status ${result.record.status}`
				: `synced campaign record ${result.record.id} with status ${result.record.status}`,
		});
		await persistCampaign();
		syncCampaignUI(ctx);
	};

	const applyFocus = (
		ctx: ExtensionContext,
		focus: Partial<Omit<FocusState, "updatedAt">>,
		options?: { notify?: boolean; persist?: boolean },
	): void => {
		currentFocus = {
			hypothesisIds: dedupeIds(focus.hypothesisIds ?? currentFocus.hypothesisIds),
			findingIds: dedupeIds(focus.findingIds ?? currentFocus.findingIds),
			questionIds: dedupeIds(focus.questionIds ?? currentFocus.questionIds),
			updatedAt: new Date().toISOString(),
		};
		updateFocusStatus(ctx, currentFocus);
		if (options?.persist !== false) {
			persistFocus();
		}
		if (options?.notify !== false) {
			const summary = [
				currentFocus.hypothesisIds[0],
				currentFocus.findingIds[0],
				currentFocus.questionIds[0],
			]
				.filter((value): value is string => value !== undefined)
				.join(", ");
			if (summary.length > 0) {
				ctx.ui.notify(`pire focus: ${summary}`, "info");
			}
		}
	};

	const getEvidenceLinkFocus = (): FocusState => {
		if (
			currentFocus.hypothesisIds.length > 0 ||
			currentFocus.findingIds.length > 0 ||
			currentFocus.questionIds.length > 0
		) {
			return currentFocus;
		}
		return {
			hypothesisIds: findingsTracker.hypotheses.slice(-1).map((record) => record.id),
			findingIds: findingsTracker.findings.slice(-1).map((record) => record.id),
			questionIds: findingsTracker.questions
				.filter((record) => record.status === "open" || record.status === "blocked")
				.slice(-1)
				.map((record) => record.id),
			updatedAt: new Date().toISOString(),
		};
	};

	const linkEvidenceToActiveFocus = (evidenceId: string, artifactIds: string[]): boolean => {
		const focus = getEvidenceLinkFocus();
		let changed = false;
		for (const id of focus.hypothesisIds) {
			if (updateHypothesis(findingsTracker, { id, addEvidenceIds: [evidenceId], addArtifactIds: artifactIds })) {
				changed = true;
			}
		}
		for (const id of focus.findingIds) {
			if (updateFinding(findingsTracker, { id, addEvidenceIds: [evidenceId], addArtifactIds: artifactIds, addBasis: [evidenceId] })) {
				changed = true;
			}
		}
		for (const id of focus.questionIds) {
			if (updateQuestion(findingsTracker, { id, addEvidenceIds: [evidenceId] })) {
				changed = true;
			}
		}
		return changed;
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

	const showHandoff = (ctx: ExtensionContext): void => {
		const content = buildResearchCompactionSummary({
			mode: currentMode,
			role: currentRole,
			sessionType: currentSessionType,
			tracker: findingsTracker,
			manifest: artifactManifest,
			campaign: campaignLedger,
			recentActivity: collectRecentActivityFromEntries(ctx.sessionManager.getEntries()),
		});
		pi.sendMessage(
			{
				customType: "pire-handoff",
				content,
				display: true,
				details: {
					mode: currentMode,
					role: currentRole,
					sessionType: currentSessionType,
				},
			},
			{ triggerTurn: false },
		);
	};

	const collectActivitiesForNotebook = (ctx: ExtensionContext): PireToolActivity[] =>
		ctx.sessionManager
			.getEntries()
			.flatMap((entry) => {
				if (entry.type !== "custom" || entry.customType !== TOOL_ACTIVITY_ENTRY_TYPE || entry.data === undefined) {
					return [];
				}
				return [entry.data as PireToolActivity];
			})
			.slice(-64);

	const exportNotebook = async (ctx: ExtensionContext, format: NotebookFormat | "all", outputPath?: string): Promise<void> => {
		const campaignSummary = buildCampaignLedgerSummary(campaignLedger);
		const doc = buildNotebookDocument({
			cwd: ctx.cwd,
			mode: currentMode,
			role: currentRole,
			sessionType: currentSessionType,
			safety: currentSafety,
			inventory: currentInventory,
			tracker: findingsTracker,
			trackerSummary: buildFindingsTrackerSummary(findingsTracker),
			manifest: artifactManifest,
			activities: collectActivitiesForNotebook(ctx),
			campaign: campaignLedger,
			campaignSummary,
		});
		const formats: NotebookFormat[] = format === "all" ? ["markdown", "json", "html"] : [format];
		const exports = [];
		for (const currentFormat of formats) {
			const result = await writeNotebookExport(ctx.cwd, doc, currentFormat, format === "all" ? undefined : outputPath);
			exports.push(result);
			await observeArtifact(ctx, result.path, "command:notebook-export", {
				type: inferArtifactTypeFromExportPath(result.path),
			});
		}
		pi.sendMessage(
			{
				customType: "pire-notebook-export",
				content: ["Pire Notebook Export", ...exports.map((entry) => `- ${entry.format}: ${entry.path}`)].join("\n"),
				display: true,
				details: { exports },
			},
			{ triggerTurn: false },
		);
	};

	const createReproBundle = async (ctx: ExtensionContext, findingId: string, slug?: string): Promise<void> => {
		const finding = findingsTracker.findings.find((record) => record.id === findingId);
		if (!finding) {
			ctx.ui.notify(`Unknown finding: ${findingId}`, "error");
			return;
		}
		let bundle;
		try {
			bundle = await generateReproBundle({
				cwd: ctx.cwd,
				mode: currentMode,
				role: currentRole,
				sessionType: currentSessionType,
				safety: currentSafety,
				inventory: currentInventory,
				tracker: findingsTracker,
				manifest: artifactManifest,
				finding,
				slug,
			});
		} catch (error) {
			if (error instanceof ReproBundleAssessmentError) {
				pi.sendMessage(
					{
						customType: "pire-repro-bundle-assessment",
						content: [
							"Pire Repro Bundle Refused",
							`- finding: ${finding.id}`,
							`- readiness: ${error.assessment.readiness}`,
							...error.assessment.issues.map((issue) => `- ${issue}`),
						].join("\n"),
						display: true,
						details: error.assessment,
					},
					{ triggerTurn: false },
				);
				return;
			}
			throw error;
		}
		for (const path of [bundle.readmePath, bundle.manifestPath, bundle.commandsPath, bundle.environmentPath, bundle.artifactsPath]) {
			await observeArtifact(ctx, path, "command:repro-bundle");
		}
		for (const file of bundle.files) {
			if (file.bundledPath) {
				await observeArtifact(ctx, file.bundledPath, "command:repro-bundle", { type: file.type });
			}
		}
		const campaignRecord = addCampaignReportPath(campaignLedger, { id: finding.id, path: bundle.readmePath });
		if (campaignRecord) {
			await appendCampaignJournalEntry(currentCwd, campaignLedger, {
				findingId: campaignRecord.id,
				action: "report",
				summary: `Attached repro bundle readme for ${campaignRecord.id}`,
				details: bundle.readmePath,
			});
			await persistCampaign();
			syncCampaignUI(ctx);
		}
		pi.sendMessage(
			{
				customType: "pire-repro-bundle",
				content: [
					"Pire Repro Bundle",
					`- directory: ${bundle.directory}`,
					`- readiness: ${bundle.assessment.readiness}`,
					`- readme: ${bundle.readmePath}`,
					`- commands: ${bundle.commandsPath}`,
					`- manifest: ${bundle.manifestPath}`,
				].join("\n"),
				display: true,
				details: bundle,
			},
			{ triggerTurn: false },
		);
	};

	const exportEval = async (
		ctx: ExtensionContext,
		suitePathInput: string,
		bindingsPathInput: string,
		runIdInput?: string,
		outputPathInput?: string,
	): Promise<void> => {
		const suitePath = resolveArtifactPath(ctx.cwd, suitePathInput);
		const bindingsPath = resolveArtifactPath(ctx.cwd, bindingsPathInput);
		const outputPath = outputPathInput ? resolveArtifactPath(ctx.cwd, outputPathInput) : undefined;

		const suite = await loadPireEvalTaskSuite(suitePath);
		const bindingFile = await loadPireEvalSessionBindingFile(bindingsPath);
		if (bindingFile.suiteId && bindingFile.suiteId !== suite.suiteId) {
			ctx.ui.notify(
				`Binding file suiteId ${bindingFile.suiteId} does not match task suite ${suite.suiteId}`,
				"error",
			);
			return;
		}

		const runId = runIdInput?.trim() || bindingFile.runId?.trim() || `eval-${new Date().toISOString().replace(/[:.]/g, "-")}`;
		const run = await createPireEvalRunBundleFromSession({
			cwd: ctx.cwd,
			suite,
			runId,
			bindings: bindingFile.bindings,
			model: bindingFile.model,
			startedAt: bindingFile.startedAt,
			finishedAt: bindingFile.finishedAt,
			notes: bindingFile.notes,
		});
		if (run.submissions.length === 0) {
			pi.sendMessage(
				{
					customType: "pire-eval-export-refused",
					content: [
						"Pire Eval Export Refused",
						`- suite: ${suite.suiteId}`,
						`- bindings: ${bindingsPath}`,
						"- no matching findings were found for the provided task bindings",
					].join("\n"),
					display: true,
				},
				{ triggerTurn: false },
			);
			return;
		}

		const savedPath = await savePireEvalRunBundle(ctx.cwd, run, outputPath);
		await observeArtifact(ctx, savedPath, "command:eval-export", { type: "json" });
		recordToolActivity(ctx, {
			tool: "eval_export",
			target: savedPath,
			summary: `Exported eval run bundle for ${suite.suiteId}`,
			artifacts: [savedPath],
		});

		const score = scorePireEvalRunBundle(suite, run);
		pi.sendMessage(
			{
				customType: "pire-eval-export",
				content: [
					"Pire Eval Export",
					`- suite: ${suite.suiteId}`,
					`- run: ${run.runId}`,
					`- output: ${savedPath}`,
					`- submissions: ${run.submissions.length}`,
					"",
					formatPireEvalRunScoreReport(score).trimEnd(),
				].join("\n"),
				display: true,
				details: {
					path: savedPath,
					run,
					score,
				},
			},
			{ triggerTurn: false },
		);
	};

	pi.registerFlag(MODE_FLAG, {
		description: "Start pire in a specific mode: recon, dynamic, proofing, report",
		type: "string",
	});
	pi.registerFlag(ROLE_FLAG, {
		description: "Start pire in a specific role: scout, reverser, tracer, fuzzer, reviewer, writer",
		type: "string",
	});
	pi.registerFlag(SESSION_TYPE_FLAG, {
		description:
			"Start pire in a specific session type: binary-re, crash-triage, network-protocol, firmware-analysis, web-security-review, malware-analysis",
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
					applyFocus(
						ctx,
						{ hypothesisIds: [record.id], findingIds: [], questionIds: record.relatedQuestionIds },
						{ notify: false },
					);
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
					applyFocus(ctx, { hypothesisIds: [record.id] }, { notify: false });
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
					await syncCampaignFinding(ctx, record.id, `Synced ${record.id} into the campaign ledger from research_tracker add_finding.`);
					syncTrackerUI(ctx);
					applyFocus(ctx, { findingIds: [record.id] }, { notify: false });
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
					await syncCampaignFinding(ctx, record.id, `Synced ${record.id} into the campaign ledger from research_tracker update_finding.`);
					syncTrackerUI(ctx);
					applyFocus(ctx, { findingIds: [record.id] }, { notify: false });
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
						relatedEvidenceIds: params.relatedEvidenceIds,
						blockedOn: params.blockedOn,
					});
					await persistTracker();
					syncTrackerUI(ctx);
					applyFocus(ctx, { questionIds: [record.id] }, { notify: false });
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
						addEvidenceIds: params.addEvidenceIds,
						addBlockedOn: params.addBlockedOn,
					});
					if (!record) {
						resultText = `Unknown question: ${params.id}`;
						break;
					}
					await persistTracker();
					syncTrackerUI(ctx);
					applyFocus(ctx, { questionIds: [record.id] }, { notify: false });
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
					linkEvidenceToActiveFocus(record.id, params.artifactIds ?? []);
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
		name: "platform_powershell",
		label: "Platform PowerShell",
		description: "Run bounded, read-only PowerShell inspection for Windows host state.",
		promptSnippet: "Use platform_powershell for structured Windows host inspection without ad-hoc shell parsing.",
		promptGuidelines: ["Use platform_powershell for Windows host state, services, processes, or Defender posture."],
		parameters: Type.Object({
			view: Type.Optional(
				Type.Union([
					Type.Literal("system-summary"),
					Type.Literal("services"),
					Type.Literal("processes"),
					Type.Literal("defender-status"),
				]),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const details = await runPlatformPowershell(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				params.view ?? "system-summary",
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "platform_hyperv",
		label: "Platform Hyper-V",
		description: "Run bounded, read-only Hyper-V inventory commands via PowerShell.",
		promptSnippet: "Use platform_hyperv for structured Hyper-V VM inventory and network state.",
		promptGuidelines: ["Use platform_hyperv when Windows or Hyper-V campaign work depends on VM, switch, or snapshot state."],
		parameters: Type.Object({
			view: Type.Optional(Type.Union([Type.Literal("vm-list"), Type.Literal("vm-network"), Type.Literal("vm-checkpoints")])),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const details = await runPlatformHyperv(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				params.view ?? "vm-list",
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "platform_macos",
		label: "Platform macOS",
		description: "Run bounded macOS or iOS-adjacent inspection commands against a bundle, binary, or plist.",
		promptSnippet: "Use platform_macos for codesign, entitlements, otool, plist, or xattr inspection.",
		promptGuidelines: ["Use platform_macos to inspect app bundles, Mach-O binaries, plists, or signing state."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to a binary, bundle, or plist." }),
			view: Type.Optional(
				Type.Union([
					Type.Literal("codesign"),
					Type.Literal("entitlements"),
					Type.Literal("otool-load-commands"),
					Type.Literal("plist"),
					Type.Literal("xattrs"),
				]),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const details = await runPlatformMacos(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				resolveArtifactPath(ctx.cwd, params.path),
				params.view ?? "codesign",
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "platform_xcrun",
		label: "Platform Xcrun",
		description: "Run bounded Xcode CLI inspection for simulator, device, or SDK state.",
		promptSnippet: "Use platform_xcrun for structured simulator, device, or SDK inspection on Apple hosts.",
		promptGuidelines: ["Use platform_xcrun for simctl, devicectl, and SDK-path inspection instead of raw bash."],
		parameters: Type.Object({
			view: Type.Optional(Type.Union([Type.Literal("simctl-list"), Type.Literal("devicectl-list"), Type.Literal("sdk-paths")])),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const details = await runPlatformXcrun(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				params.view ?? "simctl-list",
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
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
		name: "disasm_radare2_gadgets",
		label: "Disasm Radare2 Gadgets",
		description:
			"Search for ROP gadgets in a binary using radare2. Returns instruction sequences ending in ret, syscall, or jmp reg that match the search pattern.",
		promptSnippet:
			"Use disasm_radare2_gadgets to find ROP gadgets for exploit chain construction. Search for specific instruction patterns like 'pop rdi' or 'mov rax'.",
		promptGuidelines: [
			"Use disasm_radare2_gadgets to search for specific gadget patterns (e.g., 'pop rdi', 'mov rax, [rsp]', 'syscall').",
			"Filter results by combining with CFI policy analysis from decompilation to identify surviving gadgets.",
			"For chain assembly, collect gadgets for: stack pivot, register control, memory write, and syscall/JIT entry.",
			"Set maxResults to limit output for large binaries.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the binary to search for gadgets." }),
			pattern: Type.String({
				description:
					"Gadget search pattern for radare2 /R command. Examples: 'pop rdi', 'mov rax', 'syscall', 'jmp rax'.",
			}),
			maxResults: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: 500,
					default: 100,
					description: "Maximum number of gadgets to return.",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runDisasmRadare2GadgetSearch(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				path,
				{ pattern: params.pattern, maxResults: params.maxResults },
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
		name: "debug_gdb_commands",
		label: "Debug GDB Commands",
		description:
			"Run multiple GDB commands in batch mode against a target binary. Use this for multi-step debugging: set breakpoints, run, inspect registers, dump memory, examine data structures. Each command is passed as a separate -ex flag.",
		promptSnippet:
			"Use debug_gdb_commands for multi-step debugging sessions: breakpoints, register inspection, memory dumps, and heap state examination.",
		promptGuidelines: [
			"Use debug_gdb_commands when you need to set breakpoints and inspect state at specific points.",
			"Combine with decompilation results to inspect allocator metadata, heap layouts, and object states.",
			"Commands execute sequentially — set breakpoints before 'run', inspect after 'continue'.",
			"For memory dumps use 'x/Nxw ADDRESS' format. For registers use 'info registers'.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the binary to debug." }),
			commands: Type.Array(Type.String(), {
				description:
					'Array of GDB commands to execute sequentially. Example: ["break *0x401234", "run", "info registers", "x/32xw $rsp"]',
			}),
			argv: Type.Optional(Type.Array(Type.String(), { description: "Arguments to pass to the target binary." })),
			breakOnEntry: Type.Optional(
				Type.Boolean({
					description: "If true, automatically sets a breakpoint at main and runs before executing commands.",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runDebugGdbCommands(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				path,
				params.commands,
				{ argv: params.argv, breakOnEntry: params.breakOnEntry },
				signal,
			);
			return {
				content: [{ type: "text", text: details.summary }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "debug_gdb_script",
		label: "Debug GDB Script",
		description:
			"Execute a GDB Python script against a target binary. Use this for complex analysis that requires conditional logic, loops, or structured output — such as walking allocator free-lists, dumping heap metadata, or validating object layouts.",
		promptSnippet:
			"Use debug_gdb_script for programmatic GDB analysis: custom allocator reversal, heap walks, and complex data structure inspection.",
		promptGuidelines: [
			"Write GDB Python scripts using the gdb module API (gdb.execute, gdb.parse_and_eval, gdb.selected_frame).",
			"Use gdb.execute('...', to_string=True) to capture command output for parsing.",
			"Print structured output (JSON or tabular) so results are easy to interpret.",
			"The script runs in --batch mode — it must complete without interactive input.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the binary to debug." }),
			script: Type.String({
				description:
					"GDB Python script content. Uses the gdb module API. Must print results to stdout. Example: import gdb; gdb.execute('break main'); gdb.execute('run'); print(gdb.execute('info registers', to_string=True))",
			}),
			argv: Type.Optional(Type.Array(Type.String(), { description: "Arguments to pass to the target binary." })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runDebugGdbScript(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				path,
				params.script,
				{ argv: params.argv },
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
		name: "exploit_ropgadget",
		label: "Exploit ROPgadget",
		description:
			"Search for ROP gadgets in a binary using ROPgadget. Supports filtering by instruction type, searching for specific patterns, controlling search depth, and auto-generating ROP chains for common goals.",
		promptSnippet:
			"Use exploit_ropgadget for comprehensive ROP gadget search, CFI-filtered gadget inventory, and automatic chain generation.",
		promptGuidelines: [
			"Use exploit_ropgadget for thorough gadget search — it finds more gadgets than radare2 /R and supports auto-chain generation.",
			"Use --only to filter by instruction type (e.g., 'pop|ret' to find register-control gadgets).",
			"Use --filter to exclude unwanted instructions (e.g., filter out 'jmp' to avoid indirect branches under CFI).",
			"Use --search to find specific instruction sequences (e.g., 'pop rdi ; ret').",
			"Use --ropchain to auto-generate a chain for execve('/bin/sh') — useful as a starting point.",
			"Cross-reference results with CFI policy from decompilation to identify which gadgets survive enforcement.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the binary to search for gadgets." }),
			only: Type.Optional(
				Type.String({
					description:
						"Only show gadgets containing these instruction types (pipe-separated). Example: 'pop|ret', 'mov|pop|ret'.",
				}),
			),
			filter: Type.Optional(
				Type.String({
					description: "Filter out gadgets containing these instructions. Example: 'jmp|call' to exclude indirect branches.",
				}),
			),
			search: Type.Optional(
				Type.String({
					description: "Search for a specific gadget instruction sequence. Example: 'pop rdi ; ret'.",
				}),
			),
			depth: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: 20,
					description: "Maximum number of instructions per gadget (default: 10).",
				}),
			),
			ropchain: Type.Optional(
				Type.Boolean({
					description: "If true, attempt to auto-generate a ROP chain for execve('/bin/sh').",
				}),
			),
			multibr: Type.Optional(
				Type.Boolean({
					description: "If true, include gadgets with multiple branches (useful for complex chains).",
				}),
			),
			maxResults: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: 500,
					default: 200,
					description: "Maximum number of result lines to return.",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveArtifactPath(ctx.cwd, params.path);
			const details = await runExploitRopgadget(
				(command, args, options) => pi.exec(command, args, { cwd: ctx.cwd, ...options }),
				ctx.cwd,
				path,
				{
					only: params.only,
					filter: params.filter,
					search: params.search,
					depth: params.depth,
					ropchain: params.ropchain,
					multibr: params.multibr,
					maxResults: params.maxResults,
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
		name: "web_cdp_discover",
		label: "Web CDP Discover",
		description: "Inspect a Chrome DevTools Protocol endpoint, capture version metadata, and optionally inventory available targets.",
		promptSnippet: "Use web_cdp_discover when a local browser or WebView exposes a DevTools endpoint.",
		promptGuidelines: [
			"Start with web_cdp_discover before trying Runtime.evaluate so you know which page, iframe, or worker you are attaching to.",
			"Use the targetType filter when you want to focus on page, iframe, worker, or service_worker targets.",
		],
		parameters: Type.Object({
			endpoint: Type.String({ description: "CDP HTTP or websocket endpoint, for example http://127.0.0.1:9222 or ws://127.0.0.1:9222/devtools/browser/..." }),
			includeTargets: Type.Optional(Type.Boolean({ default: true })),
			targetType: Type.Optional(Type.String({ description: "Optional target type filter, for example page, iframe, worker, or service_worker." })),
			maxTargets: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 10 })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const details = await runWebCdpDiscover(
				ctx.cwd,
				params.endpoint,
				{
					includeTargets: params.includeTargets ?? true,
					targetType: params.targetType,
					maxTargets: params.maxTargets ?? 10,
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
		name: "web_cdp_runtime_eval",
		label: "Web CDP Runtime Eval",
		description: "Run a read-oriented Runtime.evaluate call against a selected CDP page or worker target and persist the full transcript.",
		promptSnippet: "Use web_cdp_runtime_eval for narrow, read-only browser-state questions once you know the right target.",
		promptGuidelines: [
			"Pick the target deliberately using id, type, or URL substring instead of assuming the first page is correct.",
			"Keep expressions narrow and question-driven: URL, readyState, globals, storage markers, or app state relevant to the current hypothesis.",
			"Leave throwOnSideEffect enabled unless you have an explicit reason to risk mutating browser state.",
		],
		parameters: Type.Object({
			endpoint: Type.String({ description: "CDP HTTP or websocket endpoint, for example http://127.0.0.1:9222." }),
			expression: Type.String({ description: "JavaScript expression to evaluate in the selected target context." }),
			targetId: Type.Optional(Type.String({ description: "Optional exact CDP target id." })),
			targetType: Type.Optional(Type.String({ description: "Optional target type such as page, iframe, worker, or service_worker." })),
			targetUrlContains: Type.Optional(Type.String({ description: "Optional substring that must appear in the target URL." })),
			awaitPromise: Type.Optional(Type.Boolean({ default: false })),
			returnByValue: Type.Optional(Type.Boolean({ default: true })),
			includeCommandLineApi: Type.Optional(Type.Boolean({ default: false })),
			throwOnSideEffect: Type.Optional(Type.Boolean({ default: true })),
			timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 60000, default: 5000 })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const details = await runWebCdpRuntimeEval(
				ctx.cwd,
				params.endpoint,
				{
					targetId: params.targetId,
					targetType: params.targetType,
					targetUrlContains: params.targetUrlContains,
					expression: params.expression,
					awaitPromise: params.awaitPromise ?? false,
					returnByValue: params.returnByValue ?? true,
					includeCommandLineApi: params.includeCommandLineApi ?? false,
					throwOnSideEffect: params.throwOnSideEffect ?? true,
					timeoutMs: params.timeoutMs ?? 5000,
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

	pi.registerCommand("safety", {
		description:
			"Show or change pire safety posture: /safety, /safety scope <local|lab|external>, /safety intent <observe|probe|exploit|persistence>, /safety approve-probing <target> :: <why>",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed) {
				showSafety();
				return;
			}
			const [action, ...rest] = trimmed.split(/\s+/);
			if (action === "scope") {
				const value = rest[0];
				if (value !== "local" && value !== "lab" && value !== "external") {
					ctx.ui.notify("Usage: /safety scope <local|lab|external>", "warning");
					return;
				}
				applySafety(ctx, { scope: value as PireSafetyScope });
				return;
			}
			if (action === "intent") {
				const value = rest[0];
				if (value !== "observe" && value !== "probe" && value !== "exploit" && value !== "persistence") {
					ctx.ui.notify("Usage: /safety intent <observe|probe|exploit|persistence>", "warning");
					return;
				}
				applySafety(ctx, { intent: value as PireSafetyIntent });
				return;
			}
			if (action === "approve-probing") {
				const remainder = rest.join(" ").trim();
				const [target, justification] = remainder.split(/\s*::\s*/, 2);
				if (!target?.trim() || !justification?.trim()) {
					ctx.ui.notify("Usage: /safety approve-probing <target> :: <justification>", "warning");
					return;
				}
				applySafety(ctx, {
					activeProbing: {
						approved: true,
						target: target.trim(),
						justification: justification.trim(),
						approvedAt: new Date().toISOString(),
					},
				});
				return;
			}
			if (action === "revoke-probing") {
				applySafety(ctx, { activeProbing: { approved: false } });
				return;
			}
			ctx.ui.notify("Unknown safety action", "error");
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

	pi.registerCommand("campaign", {
		description: "Show the current pire campaign ledger, optionally filtered by substring",
		handler: async (args) => {
			const filterText = args.trim();
			showCampaign(filterText.length > 0 ? filterText : undefined);
		},
	});

	pi.registerCommand("campaign-open", {
		description: "Show open campaign findings and active or parked chains",
		handler: async () => {
			pi.sendMessage(
				{
					customType: "pire-campaign-open",
					content: summarizeOpenCampaignLedger(campaignLedger),
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});

	pi.registerCommand("campaign-recent", {
		description: "Show the most recently updated campaign findings and chains",
		handler: async () => {
			pi.sendMessage(
				{
					customType: "pire-campaign-recent",
					content: summarizeRecentCampaignLedger(campaignLedger),
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});

	pi.registerCommand("campaign-search", {
		description: "Search the campaign ledger by finding title, note, chain title, or ID: /campaign-search <query>",
		handler: async (args, ctx) => {
			const query = args.trim();
			if (!query) {
				ctx.ui.notify("Usage: /campaign-search <query>", "warning");
				return;
			}
			showCampaign(query);
		},
	});

	pi.registerCommand("campaign-detail", {
		description: "Show one campaign finding with its current status, note, and linked evidence",
		handler: async (args) => {
			const id = args.trim();
			if (!id) {
				pi.sendMessage({ customType: "pire-campaign-detail", content: "Usage: /campaign-detail <finding-id>", display: true }, { triggerTurn: false });
				return;
			}
			pi.sendMessage(
				{
					customType: "pire-campaign-detail",
					content: renderCampaignDetail(campaignLedger, id),
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});

	pi.registerCommand("campaign-status", {
		description: "Update the campaign ledger status: /campaign-status <id> <lead|confirmed|submitted|de-escalated|blocked> [:: note]",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed) {
				ctx.ui.notify("Usage: /campaign-status <id> <lead|confirmed|submitted|de-escalated|blocked> [:: note]", "warning");
				return;
			}
			const [head, notePart] = trimmed.split(/\s*::\s*/, 2);
			const [id, statusText] = head.trim().split(/\s+/, 2);
			if (!id || !statusText) {
				ctx.ui.notify("Usage: /campaign-status <id> <lead|confirmed|submitted|de-escalated|blocked> [:: note]", "warning");
				return;
			}
			if (
				statusText !== "lead" &&
				statusText !== "confirmed" &&
				statusText !== "submitted" &&
				statusText !== "de-escalated" &&
				statusText !== "blocked"
			) {
				ctx.ui.notify(`Unknown campaign status: ${statusText}`, "error");
				return;
			}
			const validationError = validateCampaignStatusNote(statusText as CampaignFindingStatus, notePart);
			if (validationError) {
				ctx.ui.notify(validationError, "warning");
				return;
			}
			const record = updateCampaignFindingStatus(campaignLedger, {
				id,
				status: statusText as CampaignFindingStatus,
				note: notePart ?? "",
			});
			if (!record) {
				ctx.ui.notify(`Unknown campaign finding: ${id}`, "error");
				return;
			}
			await appendCampaignJournalEntry(currentCwd, campaignLedger, {
				findingId: record.id,
				action: "status",
				summary: `Set ${record.id} to ${record.status}`,
				details: notePart?.trim() || undefined,
			});
			await persistCampaign();
			syncCampaignUI(ctx);
			ctx.ui.notify(
				`Campaign ${record.id}: ${record.status}${campaignStatusRequiresNote(record.status) ? " with note" : ""}`,
				"info",
			);
		},
	});

	pi.registerCommand("campaign-sync", {
		description: "Sync session findings into the campaign ledger: /campaign-sync [finding-id]",
		handler: async (args, ctx) => {
			const findingId = args.trim();
			const findings = findingId
				? findingsTracker.findings.filter((record) => record.id === findingId)
				: findingsTracker.findings;
			if (findings.length === 0) {
				ctx.ui.notify(findingId ? `Unknown finding: ${findingId}` : "No findings to sync", "warning");
				return;
			}
			for (const finding of findings) {
				await syncCampaignFinding(ctx, finding.id, `Synced ${finding.id} into the campaign ledger from /campaign-sync.`);
			}
			ctx.ui.notify(`Synced ${findings.length} finding(s) into the campaign ledger`, "info");
		},
	});

	pi.registerCommand("chain", {
		description: "Show campaign chains, optionally filtered by substring",
		handler: async (args) => {
			const filterText = args.trim();
			pi.sendMessage(
				{
					customType: "pire-chain",
					content: summarizeCampaignChains(campaignLedger, filterText.length > 0 ? filterText : undefined),
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});

	pi.registerCommand("chain-detail", {
		description: "Show one campaign chain with linked findings",
		handler: async (args) => {
			const id = args.trim();
			if (!id) {
				pi.sendMessage({ customType: "pire-chain-detail", content: "Usage: /chain-detail <chain-id>", display: true }, { triggerTurn: false });
				return;
			}
			pi.sendMessage(
				{
					customType: "pire-chain-detail",
					content: renderCampaignChainDetail(campaignLedger, id),
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});

	pi.registerCommand("chain-create", {
		description: "Create a campaign chain: /chain-create <title> :: <summary>",
		handler: async (args, ctx) => {
			const [titlePart, summaryPart] = args.trim().split(/\s*::\s*/, 2);
			const title = titlePart?.trim();
			const summary = summaryPart?.trim();
			if (!title || !summary) {
				ctx.ui.notify("Usage: /chain-create <title> :: <summary>", "warning");
				return;
			}
			const chain = createCampaignChain(campaignLedger, { title, summary });
			await appendCampaignJournalEntry(currentCwd, campaignLedger, {
				chainId: chain.id,
				action: "chain",
				summary: `Created ${chain.id}`,
				details: chain.summary,
			});
			await persistCampaign();
			syncCampaignUI(ctx);
			ctx.ui.notify(`Created chain ${chain.id}`, "info");
		},
	});

	pi.registerCommand("chain-link", {
		description: "Link findings into a campaign chain: /chain-link <chain-id> <finding-id...>",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter((part) => part.length > 0);
			if (parts.length < 2) {
				ctx.ui.notify("Usage: /chain-link <chain-id> <finding-id...>", "warning");
				return;
			}
			const [id, ...findingIds] = parts;
			const unknownFindingId = findingIds.find((findingId) => !campaignLedger.findings.some((record) => record.id === findingId));
			if (unknownFindingId) {
				ctx.ui.notify(`Unknown campaign finding: ${unknownFindingId}`, "error");
				return;
			}
			const chain = updateCampaignChain(campaignLedger, { id, addFindingIds: findingIds });
			if (!chain) {
				ctx.ui.notify(`Unknown chain: ${id}`, "error");
				return;
			}
			await appendCampaignJournalEntry(currentCwd, campaignLedger, {
				chainId: chain.id,
				action: "chain",
				summary: `Linked findings into ${chain.id}`,
				details: findingIds.join(", "),
			});
			await persistCampaign();
			syncCampaignUI(ctx);
			ctx.ui.notify(`Updated ${chain.id}`, "info");
		},
	});

	pi.registerCommand("chain-status", {
		description: "Update a campaign chain status: /chain-status <chain-id> <active|parked|closed> [:: note]",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed) {
				ctx.ui.notify("Usage: /chain-status <chain-id> <active|parked|closed> [:: note]", "warning");
				return;
			}
			const [head, notePart] = trimmed.split(/\s*::\s*/, 2);
			const [id, statusText] = head.trim().split(/\s+/, 2);
			if (!id || !statusText || (statusText !== "active" && statusText !== "parked" && statusText !== "closed")) {
				ctx.ui.notify("Usage: /chain-status <chain-id> <active|parked|closed> [:: note]", "warning");
				return;
			}
			const chain = updateCampaignChain(campaignLedger, {
				id,
				status: statusText as CampaignChainStatus,
				note: notePart,
			});
			if (!chain) {
				ctx.ui.notify(`Unknown chain: ${id}`, "error");
				return;
			}
			await appendCampaignJournalEntry(currentCwd, campaignLedger, {
				chainId: chain.id,
				action: "chain",
				summary: `Set ${chain.id} to ${chain.status}`,
				details: notePart?.trim() || undefined,
			});
			await persistCampaign();
			syncCampaignUI(ctx);
			ctx.ui.notify(`Chain ${chain.id}: ${chain.status}`, "info");
		},
	});

	pi.registerCommand("tracker-detail", {
		description: "Show one tracker record with linked evidence, artifacts, and questions",
		handler: async (args, ctx) => {
			const id = args.trim();
			if (!id) {
				pi.sendMessage({ customType: "pire-tracker-detail", content: "Usage: /tracker-detail <record-id>", display: true }, { triggerTurn: false });
				return;
			}
			const hypothesis = findingsTracker.hypotheses.find((record) => record.id === id);
			const finding = findingsTracker.findings.find((record) => record.id === id);
			const question = findingsTracker.questions.find((record) => record.id === id);
			if (hypothesis) {
				applyFocus(ctx, { hypothesisIds: [hypothesis.id] }, { notify: false });
			} else if (finding) {
				applyFocus(ctx, { findingIds: [finding.id] }, { notify: false });
			} else if (question) {
				applyFocus(ctx, { questionIds: [question.id] }, { notify: false });
			}
			pi.sendMessage(
				{
					customType: "pire-tracker-detail",
					content: renderTrackerRecordDetail(findingsTracker, id),
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});

	pi.registerCommand("support-hypothesis", {
		description: "Mark a hypothesis supported and attach evidence IDs: /support-hypothesis <hyp-id> <ev-id...>",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter((part) => part.length > 0);
			if (parts.length < 2) {
				ctx.ui.notify("Usage: /support-hypothesis <hyp-id> <ev-id...>", "warning");
				return;
			}
			const [id, ...evidenceIds] = parts;
			const record = updateHypothesis(findingsTracker, { id, status: "supported", addEvidenceIds: evidenceIds });
			if (!record) {
				ctx.ui.notify(`Unknown hypothesis: ${id}`, "error");
				return;
			}
			await persistTracker();
			syncTrackerUI(ctx);
			applyFocus(ctx, { hypothesisIds: [record.id] }, { notify: false });
			ctx.ui.notify(`Supported ${record.id}`, "info");
		},
	});

	pi.registerCommand("refute-hypothesis", {
		description: "Mark a hypothesis refuted and attach evidence IDs: /refute-hypothesis <hyp-id> <ev-id...>",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter((part) => part.length > 0);
			if (parts.length < 2) {
				ctx.ui.notify("Usage: /refute-hypothesis <hyp-id> <ev-id...>", "warning");
				return;
			}
			const [id, ...evidenceIds] = parts;
			const record = updateHypothesis(findingsTracker, { id, status: "refuted", addEvidenceIds: evidenceIds });
			if (!record) {
				ctx.ui.notify(`Unknown hypothesis: ${id}`, "error");
				return;
			}
			await persistTracker();
			syncTrackerUI(ctx);
			applyFocus(ctx, { hypothesisIds: [record.id] }, { notify: false });
			ctx.ui.notify(`Refuted ${record.id}`, "info");
		},
	});

	pi.registerCommand("promote-finding", {
		description: "Create a finding from a hypothesis: /promote-finding <hyp-id> <title> :: <statement>",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed) {
				ctx.ui.notify("Usage: /promote-finding <hyp-id> <title> :: <statement>", "warning");
				return;
			}
			const firstSpace = trimmed.indexOf(" ");
			if (firstSpace === -1) {
				ctx.ui.notify("Usage: /promote-finding <hyp-id> <title> :: <statement>", "warning");
				return;
			}
			const hypothesisId = trimmed.slice(0, firstSpace).trim();
			const remainder = trimmed.slice(firstSpace + 1).trim();
			const [titlePart, statementPart] = remainder.split(/\s*::\s*/, 2);
			const hypothesis = findingsTracker.hypotheses.find((record) => record.id === hypothesisId);
			if (!hypothesis) {
				ctx.ui.notify(`Unknown hypothesis: ${hypothesisId}`, "error");
				return;
			}
			const title = titlePart?.trim();
			const statement = statementPart?.trim() || hypothesis.claim;
			if (!title) {
				ctx.ui.notify("promote-finding requires a title", "warning");
				return;
			}
			const finding = addFinding(findingsTracker, {
				title,
				statement,
				status: "candidate",
				severity: "medium",
				reproStatus: "not-reproduced",
				basis: hypothesis.relatedEvidenceIds,
				relatedEvidenceIds: hypothesis.relatedEvidenceIds,
				relatedArtifactIds: hypothesis.relatedArtifactIds,
			});
			await persistTracker();
			await syncCampaignFinding(ctx, finding.id, `Synced ${finding.id} into the campaign ledger from /promote-finding.`);
			syncTrackerUI(ctx);
			applyFocus(ctx, { hypothesisIds: [hypothesis.id], findingIds: [finding.id] }, { notify: false });
			ctx.ui.notify(`Created finding ${finding.id}`, "info");
		},
	});

	pi.registerCommand("mark-dead-end", {
		description: "Record a dead end: /mark-dead-end <summary> :: <why-it-failed>",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed) {
				ctx.ui.notify("Usage: /mark-dead-end <summary> :: <why-it-failed>", "warning");
				return;
			}
			const [summary, whyItFailed] = trimmed.split(/\s*::\s*/, 2);
			const record = addDeadEnd(findingsTracker, {
				summary,
				whyItFailed,
			});
			await persistTracker();
			syncTrackerUI(ctx);
			ctx.ui.notify(`Recorded dead end ${record.id}`, "info");
		},
	});

	pi.registerCommand("role", {
		description: "Show or change pire role: /role [scout|reverser|tracer|fuzzer|reviewer|writer]",
		handler: async (args, ctx) => {
			const requested = args.trim().toLowerCase();
			if (!requested) {
				const choice = ctx.hasUI ? await ctx.ui.select("Select pire role", PIRE_ROLE_ORDER) : undefined;
				if (!choice) {
					ctx.ui.notify(`current pire role: ${currentRole ?? "unset"}`, "info");
					return;
				}
				applyRole(ctx, choice as PireRole);
				return;
			}
			if (!isPireRole(requested)) {
				ctx.ui.notify(`unknown role: ${requested}`, "error");
				return;
			}
			applyRole(ctx, requested);
		},
	});

	for (const role of PIRE_ROLE_ORDER) {
		pi.registerCommand(role, {
			description: `Switch pire to ${role} role`,
			handler: async (_args, ctx) => applyRole(ctx, role),
		});
	}

	pi.registerCommand("session-type", {
		description:
			"Show or change pire session type: /session-type [binary-re|crash-triage|network-protocol|firmware-analysis|web-security-review|malware-analysis]",
		handler: async (args, ctx) => {
			const requested = args.trim().toLowerCase();
			if (!requested) {
				const choice = ctx.hasUI ? await ctx.ui.select("Select pire session type", PIRE_SESSION_TYPE_ORDER) : undefined;
				if (!choice) {
					ctx.ui.notify(`current pire session type: ${currentSessionType ?? "unset"}`, "info");
					return;
				}
				await applySessionType(ctx, choice as PireSessionType);
				return;
			}
			if (!isPireSessionType(requested)) {
				ctx.ui.notify(`unknown session type: ${requested}`, "error");
				return;
			}
			await applySessionType(ctx, requested);
		},
	});

	pi.registerCommand("handoff", {
		description: "Show a research handoff summary for another session or subagent",
		handler: async (_args, ctx) => {
			showHandoff(ctx);
		},
	});

	pi.registerCommand("notebook-export", {
		description: "Export the current pire research notebook: /notebook-export [markdown|json|html|all] [path]",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter((part) => part.length > 0);
			const format = (parts[0] ?? "markdown").toLowerCase();
			const outputPath = parts.length > 1 ? parts.slice(1).join(" ") : undefined;
			if (format !== "markdown" && format !== "json" && format !== "html" && format !== "all") {
				ctx.ui.notify("Usage: /notebook-export [markdown|json|html|all] [path]", "warning");
				return;
			}
			await exportNotebook(ctx, format as NotebookFormat | "all", outputPath);
		},
	});

	pi.registerCommand("repro-bundle", {
		description: "Generate a repro bundle for a finding: /repro-bundle <finding-id> [slug]",
		handler: async (args, ctx) => {
			const [findingId, ...slugParts] = args.trim().split(/\s+/).filter((part) => part.length > 0);
			if (!findingId) {
				ctx.ui.notify("Usage: /repro-bundle <finding-id> [slug]", "warning");
				return;
			}
			await createReproBundle(ctx, findingId, slugParts.join("-") || undefined);
		},
	});

	pi.registerCommand("eval-export", {
		description:
			"Export a scored eval run bundle from the current pire session: /eval-export <suite-path> :: <bindings-path> [:: run-id] [:: output-path]",
		handler: async (args, ctx) => {
			const parts = args
				.split(/\s*::\s*/)
				.map((part) => part.trim())
				.filter((part) => part.length > 0);
			if (parts.length < 2) {
				ctx.ui.notify(
					"Usage: /eval-export <suite-path> :: <bindings-path> [:: run-id] [:: output-path]",
					"warning",
				);
				return;
			}
			await exportEval(ctx, parts[0]!, parts[1]!, parts[2], parts[3]);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		currentCwd = ctx.cwd;
		const flagValue = pi.getFlag(MODE_FLAG);
		const roleFlagValue = pi.getFlag(ROLE_FLAG);
		const sessionTypeFlagValue = pi.getFlag(SESSION_TYPE_FLAG);
		const entries = ctx.sessionManager.getEntries();
		const persisted = entries
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === MODE_ENTRY_TYPE)
			.pop() as { data?: PersistedModeState } | undefined;
		const persistedRole = entries
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === ROLE_ENTRY_TYPE)
			.pop() as { data?: PersistedRoleState } | undefined;
		const persistedSessionType = entries
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === SESSION_TYPE_ENTRY_TYPE)
			.pop() as { data?: PersistedSessionTypeState } | undefined;

		const persistedMode = persisted?.data?.mode;
		const latestActivityEntry = entries
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === TOOL_ACTIVITY_ENTRY_TYPE)
			.pop() as { data?: PireToolActivity } | undefined;
		const latestTrackerEntry = ctx.sessionManager
			.getBranch()
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === TRACKER_ENTRY_TYPE)
			.pop() as { data?: { tracker?: FindingsTracker } } | undefined;
		const latestInventoryEntry = ctx.sessionManager
			.getBranch()
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === INVENTORY_ENTRY_TYPE)
			.pop() as { data?: PersistedInventoryState } | undefined;
		const latestCampaignEntry = ctx.sessionManager
			.getBranch()
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === CAMPAIGN_ENTRY_TYPE)
			.pop() as { data?: PersistedCampaignState } | undefined;
			const latestFocusEntry = ctx.sessionManager
				.getBranch()
				.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === FOCUS_ENTRY_TYPE)
				.pop() as { data?: FocusState } | undefined;
			const latestSafetyEntry = ctx.sessionManager
				.getBranch()
				.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === SAFETY_ENTRY_TYPE)
				.pop() as { data?: PersistedSafetyState } | undefined;
			const flagMode = typeof flagValue === "string" && isPireMode(flagValue) ? flagValue : undefined;
			const flagRole = typeof roleFlagValue === "string" && isPireRole(roleFlagValue) ? roleFlagValue : undefined;
		const flagSessionType =
			typeof sessionTypeFlagValue === "string" && isPireSessionType(sessionTypeFlagValue) ? sessionTypeFlagValue : undefined;
		artifactManifest = await loadArtifactManifest(ctx.cwd);
			campaignLedger = latestCampaignEntry?.data?.ledger ?? (await loadCampaignLedger(ctx.cwd));
			findingsTracker = latestTrackerEntry?.data?.tracker ?? (await loadFindingsTracker(ctx.cwd));
			lastActivity = latestActivityEntry?.data;
			currentInventory = latestInventoryEntry?.data?.inventory;
			currentFocus = latestFocusEntry?.data ?? createEmptyFocusState();
			currentSafety = latestSafetyEntry?.data?.posture ?? createDefaultSafetyPosture();
			currentRole = flagRole ?? persistedRole?.data?.role;
			currentSessionType = flagSessionType ?? persistedSessionType?.data?.sessionType;
		applyMode(ctx, flagMode ?? persistedMode ?? "recon", { notify: false });
		if (currentSessionType) {
			await applySessionType(ctx, currentSessionType, { notify: false, preserveRole: currentRole !== undefined });
		}
		if (currentRole) {
			applyRole(ctx, currentRole, { notify: false });
			}
			updateFocusStatus(ctx, currentFocus);
			updateSafetyStatus(ctx, currentSafety);
			updateCampaignStatus(ctx, campaignLedger);
			if (!currentInventory || currentInventory.cwd !== ctx.cwd) {
			const inventory = await collectEnvironmentInventory(ctx.cwd, (command, args) => pi.exec(command, args, { cwd: ctx.cwd }));
			persistInventory(inventory, "auto");
			recordToolActivity(ctx, {
				tool: "environment_inventory",
				target: ctx.cwd,
				summary: "Captured environment inventory",
				artifacts: [],
			});
		}
	});

	pi.on("session_tree", async (_event, ctx) => {
		const latestTrackerEntry = ctx.sessionManager
			.getBranch()
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === TRACKER_ENTRY_TYPE)
			.pop() as { data?: { tracker?: FindingsTracker } } | undefined;
		const latestRoleEntry = ctx.sessionManager
			.getBranch()
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === ROLE_ENTRY_TYPE)
			.pop() as { data?: PersistedRoleState } | undefined;
		const latestSessionTypeEntry = ctx.sessionManager
			.getBranch()
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === SESSION_TYPE_ENTRY_TYPE)
			.pop() as { data?: PersistedSessionTypeState } | undefined;
		const latestInventoryEntry = ctx.sessionManager
			.getBranch()
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === INVENTORY_ENTRY_TYPE)
			.pop() as { data?: PersistedInventoryState } | undefined;
			const latestCampaignEntry = ctx.sessionManager
				.getBranch()
				.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === CAMPAIGN_ENTRY_TYPE)
				.pop() as { data?: PersistedCampaignState } | undefined;
			const latestFocusEntry = ctx.sessionManager
				.getBranch()
				.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === FOCUS_ENTRY_TYPE)
				.pop() as { data?: FocusState } | undefined;
			const latestSafetyEntry = ctx.sessionManager
				.getBranch()
				.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === SAFETY_ENTRY_TYPE)
				.pop() as { data?: PersistedSafetyState } | undefined;
			findingsTracker = latestTrackerEntry?.data?.tracker ?? findingsTracker;
			currentRole = latestRoleEntry?.data?.role ?? currentRole;
			currentSessionType = latestSessionTypeEntry?.data?.sessionType ?? currentSessionType;
			currentInventory = latestInventoryEntry?.data?.inventory ?? currentInventory;
			campaignLedger = latestCampaignEntry?.data?.ledger ?? campaignLedger;
			currentFocus = latestFocusEntry?.data ?? createEmptyFocusState();
			currentSafety = latestSafetyEntry?.data?.posture ?? currentSafety;
			syncTrackerUI(ctx);
			updateRoleStatus(ctx, currentRole);
			updateSessionTypeStatus(ctx, currentSessionType);
			updateFocusStatus(ctx, currentFocus);
			updateSafetyStatus(ctx, currentSafety);
			updateCampaignStatus(ctx, campaignLedger);
		});

	pi.on("before_agent_start", async (_event, ctx) => {
		if (!currentInventory || currentInventory.cwd !== ctx.cwd) {
			const inventory = await collectEnvironmentInventory(ctx.cwd, (command, args) => pi.exec(command, args, { cwd: ctx.cwd }));
			persistInventory(inventory, "auto");
		}
		return {
			message: {
				customType: "pire-mode-context",
				content: [
						formatModePrompt(currentMode),
						currentSessionType ? formatSessionTypePrompt(currentSessionType) : undefined,
						currentRole ? formatRolePrompt(currentRole) : undefined,
						buildSafetyPrompt(currentSafety),
						buildInventoryPromptSummary(currentInventory),
						buildCampaignPromptSummary(campaignLedger),
						buildFindingsPromptSummary(findingsTracker, {
						activeHypothesisIds: currentFocus.hypothesisIds,
						activeFindingIds: currentFocus.findingIds,
						activeQuestionIds: currentFocus.questionIds,
					}),
				]
					.filter((value): value is string => value !== undefined)
					.join("\n\n"),
				display: false,
			},
		};
	});

	pi.on("session_before_compact", async (event) => {
		const recentActivity = collectRecentActivityFromEntries(event.branchEntries);
		if (recentActivity.length === 0 && lastActivity) {
			recentActivity.push(lastActivity);
		}
		return {
			compaction: {
				summary: buildResearchCompactionSummary({
					mode: currentMode,
					role: currentRole,
					sessionType: currentSessionType,
					tracker: findingsTracker,
					manifest: artifactManifest,
					campaign: campaignLedger,
					recentActivity,
					customInstructions: event.customInstructions,
					previousSummary: event.preparation.previousSummary,
				}),
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
				details: {
					mode: currentMode,
					role: currentRole,
					sessionType: currentSessionType,
					trackerSummary: buildFindingsTrackerSummary(findingsTracker),
					artifactSummary: buildArtifactManifestSummary(artifactManifest),
					campaignSummary: buildCampaignLedgerSummary(campaignLedger),
				},
			},
		};
	});

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
			if (PERSISTENCE_PATTERNS.some((pattern) => pattern.test(command))) {
				const decision = allowPersistence(currentSafety);
				if (!decision.allowed) {
					return { block: true, reason: decision.reason ?? "persistence blocked" };
				}
			}
			if (ACTIVE_PROBING_PATTERNS.some((pattern) => pattern.test(command))) {
				const decision = allowActiveProbe(currentSafety, currentSafety.activeProbing.target);
				if (!decision.allowed) {
					return { block: true, reason: decision.reason ?? "active probing blocked" };
				}
			}
				if (!isAllowedResearchCommand(command, currentMode)) {
					return {
						block: true,
						reason: `pire ${currentMode} mode blocked this command as destructive or requiring a more invasive posture.\nCommand: ${command}`,
					};
				}
			}

		if (event.toolName === "net_curl_head") {
			const url = typeof event.input.url === "string" ? event.input.url : "";
			const decision = allowObservationTarget(currentSafety, url);
			if (!decision.allowed) {
				return {
					block: true,
					reason: decision.reason ?? `safety posture blocked access to ${url}`,
				};
			}
		}

		if (event.toolName === "web_cdp_discover" || event.toolName === "web_cdp_runtime_eval") {
			const endpoint = typeof event.input.endpoint === "string" ? event.input.endpoint : "";
			const decision = allowObservationTarget(currentSafety, endpoint);
			if (!decision.allowed) {
				return {
					block: true,
					reason: decision.reason ?? `safety posture blocked access to ${endpoint}`,
				};
			}
		}
	});

	(pi as ExtensionAPI).on("tool_result", async (event, ctx) => {
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

			const evidence = addEvidence(findingsTracker, {
				kind: event.toolName === "debug_strace" || event.toolName === "debug_ltrace" ? "trace" : "tool-result",
				summary: `${event.toolName}: ${firstLine}`,
				commandId: `tool:${event.toolName}:${event.toolCallId}`,
				artifactIds,
			});
			linkEvidenceToActiveFocus(evidence.id, artifactIds);
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
			if (
				event.details &&
				typeof event.details === "object" &&
				"cwd" in event.details &&
				typeof event.details.cwd === "string"
			) {
				persistInventory(event.details as EnvironmentInventory, "tool");
			}
			recordToolActivity(ctx, {
				tool: event.toolName,
				target: ctx.cwd,
				summary: "Captured environment inventory",
				artifacts: [],
			});
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

		const webDetails = getWebToolDetails(event.details);
		if (webDetails) {
			for (const artifact of webDetails.artifacts as WebArtifactObservation[]) {
				await observeArtifact(ctx, artifact.path, `tool:${event.toolName}`, {
					type: artifact.type as ArtifactType | undefined,
					command: artifact.command ?? webDetails.commandString,
					finding: artifact.finding,
				});
			}
			recordToolActivity(ctx, {
				tool: event.toolName,
				target: webDetails.target,
				summary: webDetails.summary.split("\n")[0] ?? event.toolName,
				artifacts: webDetails.artifacts.map((artifact) => artifact.path),
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

			const platformDetails = getPlatformToolDetails(event.details);
			if (platformDetails) {
				for (const artifact of platformDetails.artifacts as PlatformArtifactObservation[]) {
					await observeArtifact(ctx, artifact.path, `tool:${event.toolName}`, {
						type: artifact.type as ArtifactType | undefined,
						command: artifact.command ?? platformDetails.commandString,
						finding: artifact.finding,
					});
				}
				recordToolActivity(ctx, {
					tool: event.toolName,
					target: platformDetails.target,
					summary: platformDetails.summary.split("\n")[0] ?? event.toolName,
					artifacts: platformDetails.artifacts.map((artifact) => artifact.path),
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
				event.toolName.startsWith("web_") ||
				event.toolName.startsWith("unpack_") ||
				event.toolName.startsWith("platform_")
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
