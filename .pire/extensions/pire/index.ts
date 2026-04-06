import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { collectEnvironmentInventory, formatInventorySummary, type EnvironmentInventory } from "./inventory.js";

type PireMode = "recon" | "dynamic" | "proofing" | "report";

interface PersistedModeState {
	mode: PireMode;
}

const MODE_ENTRY_TYPE = "pire-mode";
const MODE_FLAG = "pire-mode";
const MODE_TOOLS: Record<PireMode, string[]> = {
	recon: ["read", "bash", "grep", "find", "ls", "environment_inventory"],
	dynamic: ["read", "bash", "grep", "find", "ls", "environment_inventory"],
	proofing: ["read", "bash", "edit", "write", "grep", "find", "ls", "environment_inventory"],
	report: ["read", "bash", "edit", "write", "grep", "find", "ls", "environment_inventory"],
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

export default function pireExtension(pi: ExtensionAPI): void {
	let currentMode: PireMode = "recon";

	const persistMode = (): void => {
		pi.appendEntry<PersistedModeState>(MODE_ENTRY_TYPE, { mode: currentMode });
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

	pi.on("session_start", async (_event, ctx) => {
		const flagValue = pi.getFlag(MODE_FLAG);
		const entries = ctx.sessionManager.getEntries();
		const persisted = entries
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === MODE_ENTRY_TYPE)
			.pop() as { data?: PersistedModeState } | undefined;

		const persistedMode = persisted?.data?.mode;
		const flagMode = typeof flagValue === "string" && isPireMode(flagValue) ? flagValue : undefined;
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
}
