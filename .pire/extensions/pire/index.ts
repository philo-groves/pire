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
	loadArtifactManifest,
	recordArtifact,
	resolveArtifactPath,
	saveArtifactManifest,
	summarizeArtifactManifest,
	type ArtifactManifest,
	type ArtifactType,
} from "./artifacts.js";
import { collectEnvironmentInventory, formatInventorySummary, type EnvironmentInventory } from "./inventory.js";

type PireMode = "recon" | "dynamic" | "proofing" | "report";

interface PersistedModeState {
	mode: PireMode;
}

const MODE_ENTRY_TYPE = "pire-mode";
const ARTIFACT_ENTRY_TYPE = "pire-artifacts";
const MODE_FLAG = "pire-mode";
const MODE_TOOLS: Record<PireMode, string[]> = {
	recon: [
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
	],
	dynamic: [
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
	],
	proofing: [
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
	],
	report: [
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

function getBinaryToolDetails(eventDetails: unknown): BinaryToolDetails | undefined {
	if (!eventDetails || typeof eventDetails !== "object" || !("artifacts" in eventDetails)) {
		return undefined;
	}
	return eventDetails as BinaryToolDetails;
}

export default function pireExtension(pi: ExtensionAPI): void {
	let currentMode: PireMode = "recon";
	let currentCwd = process.cwd();
	let artifactManifest: ArtifactManifest = { version: 1, updatedAt: new Date().toISOString(), artifacts: [] };

	const persistMode = (): void => {
		pi.appendEntry<PersistedModeState>(MODE_ENTRY_TYPE, { mode: currentMode });
	};

	const persistArtifacts = async (): Promise<void> => {
		const manifestPath = await saveArtifactManifest(currentCwd, artifactManifest);
		pi.appendEntry(ARTIFACT_ENTRY_TYPE, {
			updatedAt: artifactManifest.updatedAt,
			count: artifactManifest.artifacts.length,
			manifestPath,
		});
	};

	const applyMode = (ctx: ExtensionContext, mode: PireMode, options?: { notify?: boolean }): void => {
		currentMode = mode;
		pi.setActiveTools(MODE_TOOLS[mode]);
		updateStatus(ctx, mode);
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

	const showArtifacts = (): void => {
		pi.sendMessage(
			{
				customType: "pire-artifact-manifest",
				content: summarizeArtifactManifest(artifactManifest),
				display: true,
				details: artifactManifest,
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

	pi.registerFlag(MODE_FLAG, {
		description: "Start pire in a specific mode: recon, dynamic, proofing, report",
		type: "string",
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
		description: "Show the current pire artifact manifest summary",
		handler: async () => {
			showArtifacts();
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
		const flagMode = typeof flagValue === "string" && isPireMode(flagValue) ? flagValue : undefined;
		artifactManifest = await loadArtifactManifest(ctx.cwd);
		applyMode(ctx, flagMode ?? persistedMode ?? "recon", { notify: false });
	});

	pi.on("before_agent_start", async () => ({
		message: {
			customType: "pire-mode-context",
			content: formatModePrompt(currentMode),
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
		}
	});
}
