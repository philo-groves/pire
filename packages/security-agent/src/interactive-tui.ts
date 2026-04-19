import { homedir, userInfo } from "node:os";
import { basename, relative, resolve } from "node:path";
import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import {
	CombinedAutocompleteProvider,
	type Component,
	Editor,
	type EditorTheme,
	type Focusable,
	getKeybindings,
	ProcessTerminal,
	setKeybindings,
	TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import { createSecurityAgentKeybindings } from "./keybindings.js";
import { parseThinkingLevel, resolveModelCommandInput } from "./models.js";
import type { SecurityAgentRuntime } from "./runtime.js";
import type { SurfaceRecord } from "./surface-map/store.js";
import type { ResearchPlan } from "./tools/plan.js";

type TimelineEntry = UserTimelineEntry | AssistantTimelineEntry | ToolTimelineEntry | NoticeTimelineEntry;
type ToolStatus = "running" | "ok" | "error";

interface TimelineEntryBase {
	id: string;
	timestamp: number;
}

interface UserTimelineEntry extends TimelineEntryBase {
	kind: "user";
	text: string;
}

interface AssistantTimelineEntry extends TimelineEntryBase {
	kind: "assistant";
	text: string;
	thinking: string;
	streaming: boolean;
	stopReason?: AssistantMessage["stopReason"];
	errorMessage?: string;
	usage?: AssistantMessage["usage"];
	toolCalls: number;
}

interface ToolTimelineEntry extends TimelineEntryBase {
	kind: "tool";
	toolCallId: string;
	toolName: string;
	status: ToolStatus;
	args: unknown;
	output: string;
	details?: unknown;
}

interface NoticeTimelineEntry extends TimelineEntryBase {
	kind: "notice";
	label: string;
	text: string;
	tone: "neutral" | "warning" | "error" | "success";
}

type BoxTone = {
	border: (text: string) => string;
	accent: (text: string) => string;
	muted: (text: string) => string;
};

type FilledTone = {
	fg: number | string;
	bg: number | string;
	title: (text: string) => string;
	meta: (text: string) => string;
	label: (text: string) => string;
	body: (text: string) => string;
	status: (text: string) => string;
	thinking: (text: string) => string;
	error: (text: string) => string;
};

function sgr(codes: string, text: string): string {
	return `\x1b[${codes}m${text}\x1b[0m`;
}

const styles = {
	text: (text: string) => sgr("38;5;252", text),
	bright: (text: string) => sgr("1;38;5;231", text),
	dim: (text: string) => sgr("2;38;5;244", text),
	subtle: (text: string) => sgr("38;5;246", text),
	red: (text: string) => sgr("38;5;203", text),
	amber: (text: string) => sgr("38;5;215", text),
	gold: (text: string) => sgr("38;5;220", text),
	yellow: (text: string) => sgr("38;5;226", text),
	cyan: (text: string) => sgr("38;5;81", text),
	blue: (text: string) => sgr("38;5;75", text),
	green: (text: string) => sgr("38;5;114", text),
	italicDim: (text: string) => sgr("3;38;5;245", text),
	bgBadge: (label: string, fg: number, bg: number) => sgr(`1;38;5;${fg};48;5;${bg}`, ` ${label} `),
};

const brandBadge = (label: string): string => styles.bgBadge(label, 232, 226);

const composerSurface = {
	bg: 235,
	fg: 252,
	paddingX: 1,
} as const;

const planPanelVisibleLimit = 2;
const surfacePanelVisibleLimit = 3;

const tones = {
	user: { border: styles.yellow, accent: styles.yellow, muted: styles.subtle },
	assistant: { border: styles.cyan, accent: styles.cyan, muted: styles.subtle },
	tool: { border: styles.amber, accent: styles.amber, muted: styles.subtle },
	toolError: { border: styles.red, accent: styles.red, muted: styles.subtle },
	toolSuccess: { border: styles.green, accent: styles.green, muted: styles.subtle },
	notice: { border: styles.blue, accent: styles.blue, muted: styles.subtle },
	warning: { border: styles.amber, accent: styles.yellow, muted: styles.subtle },
	error: { border: styles.red, accent: styles.red, muted: styles.subtle },
	success: { border: styles.green, accent: styles.green, muted: styles.subtle },
	card: { border: styles.subtle, accent: styles.yellow, muted: styles.subtle },
} as const satisfies Record<string, BoxTone>;

const filledTones = {
	assistantPending: {
		fg: 231,
		bg: 236,
		title: (text: string) => sgr("1;38;5;231", text),
		meta: (text: string) => sgr("38;5;248", text),
		label: (text: string) => sgr("38;5;250", text),
		body: (text: string) => sgr("38;5;252", text),
		status: (text: string) => sgr("1;38;5;215", text),
		thinking: (text: string) => sgr("3;38;5;250", text),
		error: (text: string) => sgr("38;5;217", text),
	},
	assistantSuccess: {
		fg: 231,
		bg: "48;2;26;25;12",
		title: (text: string) => sgr("1;38;5;231", text),
		meta: (text: string) => sgr("38;5;223", text),
		label: (text: string) => sgr("38;5;229", text),
		body: (text: string) => sgr("38;5;230", text),
		status: (text: string) => sgr("1;38;5;226", text),
		thinking: (text: string) => sgr("3;38;5;222", text),
		error: (text: string) => sgr("38;5;224", text),
	},
	assistantError: {
		fg: 231,
		bg: 52,
		title: (text: string) => sgr("1;38;5;231", text),
		meta: (text: string) => sgr("38;5;224", text),
		label: (text: string) => sgr("38;5;217", text),
		body: (text: string) => sgr("38;5;224", text),
		status: (text: string) => sgr("1;38;5;210", text),
		thinking: (text: string) => sgr("3;38;5;224", text),
		error: (text: string) => sgr("1;38;5;231", text),
	},
	snapshotCard: {
		fg: 252,
		bg: 235,
		title: (text: string) => text,
		meta: (text: string) => text,
		label: (text: string) => text,
		body: (text: string) => text,
		status: (text: string) => text,
		thinking: (text: string) => text,
		error: (text: string) => text,
	},
} as const satisfies Record<string, FilledTone>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isTextContent(value: unknown): value is TextContent {
	return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

function joinTextParts(parts: unknown[]): string {
	return parts
		.filter((part): part is TextContent => isTextContent(part))
		.map((part) => part.text)
		.join("\n\n");
}

function extractMessageText(message: AgentMessage): string {
	if (!("content" in message)) {
		return "";
	}
	if (typeof message.content === "string") {
		return message.content;
	}
	if (!Array.isArray(message.content)) {
		return "";
	}
	return joinTextParts(message.content);
}

function extractAssistantContent(message: AssistantMessage): { text: string; thinking: string; toolCalls: number } {
	let text = "";
	let thinking = "";
	let toolCalls = 0;

	for (const block of message.content) {
		if (block.type === "text" && block.text.trim().length > 0) {
			text = text ? `${text}\n\n${block.text}` : block.text;
		}
		if (block.type === "thinking" && block.thinking.trim().length > 0) {
			thinking = thinking ? `${thinking}\n\n${block.thinking}` : block.thinking;
		}
		if (block.type === "toolCall") {
			toolCalls++;
		}
	}

	return { text, thinking, toolCalls };
}

function clampText(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	return text.slice(0, maxChars);
}

function compactText(text: string, maxChars: number): string {
	const compact = text.replace(/\s+/g, " ").trim();
	if (compact.length === 0) {
		return "";
	}
	return truncateToWidth(compact, maxChars, "...");
}

function flattenWrappedLines(text: string, width: number): string[] {
	if (text.trim().length === 0) {
		return [""];
	}

	const result: string[] = [];
	for (const rawLine of text.split("\n")) {
		if (rawLine.length === 0) {
			result.push("");
			continue;
		}
		const wrapped = wrapTextWithAnsi(rawLine, width);
		if (wrapped.length === 0) {
			result.push("");
			continue;
		}
		result.push(...wrapped);
	}
	return result;
}

function limitLines(lines: string[], maxLines: number, trailer: string): string[] {
	if (lines.length <= maxLines) {
		return lines;
	}
	return [...lines.slice(0, Math.max(1, maxLines - 1)), trailer];
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

function formatClock(timestamp: number): string {
	return new Intl.DateTimeFormat("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).format(new Date(timestamp));
}

function formatCount(value: number): string {
	if (value < 1000) {
		return `${value}`;
	}
	if (value < 10_000) {
		return `${(value / 1000).toFixed(1)}k`;
	}
	if (value < 1_000_000) {
		return `${Math.round(value / 1000)}k`;
	}
	return `${(value / 1_000_000).toFixed(1)}M`;
}

function formatPath(path: string): string {
	const rawPath = path.trim();
	const normalizedPath = rawPath.replace(/\/+$/, "");
	const resolvedPath = resolve(normalizedPath);
	const homeCandidates = new Set<string>();
	const userNames = [userInfo().username, process.env.SUDO_USER].filter(
		(value): value is string => typeof value === "string" && value.trim().length > 0,
	);

	for (const candidate of [process.env.HOME, homedir()]) {
		if (!candidate) {
			continue;
		}
		const normalizedHome = candidate.trim().replace(/\/+$/, "");
		if (normalizedHome.length === 0) {
			continue;
		}
		homeCandidates.add(normalizedHome);
		homeCandidates.add(resolve(normalizedHome));
	}

	for (const home of homeCandidates) {
		if (normalizedPath === home || resolvedPath === home) {
			return "~";
		}
		if (normalizedPath.startsWith(`${home}/`)) {
			return `~/${normalizedPath.slice(home.length + 1)}`;
		}
		if (resolvedPath.startsWith(`${home}/`)) {
			return `~/${resolvedPath.slice(home.length + 1)}`;
		}
	}

	for (const userName of userNames) {
		for (const userHomePrefix of [`/home/${userName}`, `/Users/${userName}`]) {
			if (normalizedPath === userHomePrefix || resolvedPath === userHomePrefix) {
				return "~";
			}
			if (normalizedPath.startsWith(`${userHomePrefix}/`)) {
				return `~/${normalizedPath.slice(userHomePrefix.length + 1)}`;
			}
			if (resolvedPath.startsWith(`${userHomePrefix}/`)) {
				return `~/${resolvedPath.slice(userHomePrefix.length + 1)}`;
			}
		}
	}

	return resolvedPath;
}

function formatFooterWorkspacePath(path: string): string {
	const formatted = formatPath(path);
	if (formatted.startsWith("~/") || formatted === "~") {
		return formatted;
	}

	const rawPath = path
		.trim()
		.replace(/[\u0000-\u001f\u007f\u200b-\u200d\u2060\ufeff]/g, "")
		.replace(/\/+$/, "");
	const homeCandidates = new Set<string>();
	const userNames = [userInfo().username, process.env.SUDO_USER].filter(
		(value): value is string => typeof value === "string" && value.trim().length > 0,
	);
	const explicitHomes = userNames.flatMap((userName) => [`/home/${userName}`, `/Users/${userName}`]);
	for (const candidate of [process.env.HOME, homedir(), ...explicitHomes]) {
		if (!candidate) {
			continue;
		}
		const normalizedHome = candidate.trim().replace(/\/+$/, "");
		if (normalizedHome.length > 0) {
			homeCandidates.add(normalizedHome);
			homeCandidates.add(resolve(normalizedHome));
		}
	}

	for (const home of homeCandidates) {
		if (rawPath === home) {
			return "~";
		}
		if (rawPath.startsWith(`${home}/`)) {
			return `~/${rawPath.slice(home.length + 1)}`;
		}
		const embeddedHomeIndex = rawPath.indexOf(`${home}/`);
		if (embeddedHomeIndex !== -1) {
			return `~/${rawPath.slice(embeddedHomeIndex + home.length + 1)}`;
		}
	}

	return formatted;
}

function forceTildeHome(text: string): string {
	const userNames = [userInfo().username, process.env.SUDO_USER].filter(
		(value): value is string => typeof value === "string" && value.trim().length > 0,
	);
	let result = text;
	for (const userName of userNames) {
		result = result
			.replaceAll(`/home/${userName}/`, "~/")
			.replaceAll(`/Users/${userName}/`, "~/")
			.replace(`/home/${userName}`, "~")
			.replace(`/Users/${userName}`, "~");
	}
	return result;
}

function formatRelativePath(basePath: string, targetPath: string): string {
	const relativePath = relative(basePath, targetPath);
	if (relativePath.length === 0) {
		return ".";
	}
	if (!relativePath.startsWith("..")) {
		return `./${relativePath}`;
	}
	return formatPath(targetPath);
}

function fitLine(text: string, width: number): string {
	if (width <= 0) {
		return "";
	}
	if (visibleWidth(text) > width) {
		return truncateToWidth(text, width, "...");
	}
	return text + " ".repeat(width - visibleWidth(text));
}

function renderAlignedLine(left: string, right: string, width: number): string {
	if (visibleWidth(left) + 2 + visibleWidth(right) <= width) {
		return left + " ".repeat(width - visibleWidth(left) - visibleWidth(right)) + right;
	}
	return truncateToWidth(`${left} ${right}`, width, "...");
}

function stripSgr(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function isSolidRuleLine(line: string): boolean {
	return /^─+$/.test(stripSgr(line).trimEnd());
}

function renderFilledLine(
	text: string,
	width: number,
	paddingX = 0,
	fg: number | string = composerSurface.fg,
	bg: number | string = composerSurface.bg,
): string {
	const innerWidth = Math.max(1, width - paddingX * 2);
	const leftPadding = " ".repeat(Math.max(0, paddingX));
	const rightPadding = leftPadding;
	const fgStyle = typeof fg === "number" ? `38;5;${fg}` : fg;
	const bgStyle = typeof bg === "number" ? `48;5;${bg}` : bg;
	const baseStyle = `0;${fgStyle};${bgStyle}`;
	const content = `${leftPadding}${fitLine(text, innerWidth)}${rightPadding}`;
	return `\x1b[${baseStyle}m${content.replaceAll("\x1b[0m", `\x1b[${baseStyle}m`)}\x1b[0m`;
}

function renderFilledBlock(width: number, title: string, lines: string[], tone: FilledTone, paddingX = 1): string[] {
	const innerWidth = Math.max(1, width - paddingX * 2);
	const wrappedLines: string[] = [];

	for (const line of lines.length > 0 ? lines : [""]) {
		if (line.length === 0) {
			wrappedLines.push("");
			continue;
		}
		wrappedLines.push(...flattenWrappedLines(line, innerWidth));
	}

	return [
		renderFilledLine("", width, paddingX, tone.fg, tone.bg),
		renderFilledLine(title, width, paddingX, tone.fg, tone.bg),
		renderFilledLine("", width, paddingX, tone.fg, tone.bg),
		...wrappedLines.map((line) => renderFilledLine(line, width, paddingX, tone.fg, tone.bg)),
		renderFilledLine("", width, paddingX, tone.fg, tone.bg),
	];
}

function renderRailBlock(width: number, title: string, lines: string[], tone: BoxTone): string[] {
	const innerWidth = Math.max(1, width - 2);
	const wrappedLines: string[] = [];
	for (const line of lines.length > 0 ? lines : [""]) {
		if (line.length === 0) {
			wrappedLines.push("");
			continue;
		}
		wrappedLines.push(...flattenWrappedLines(line, innerWidth));
	}

	return [
		`${tone.accent(">")} ${truncateToWidth(title, Math.max(1, width - 2), "...")}`,
		...wrappedLines.map((line) => `${tone.border("|")} ${fitLine(line, innerWidth)}`),
	];
}

function formatUsage(usage: AssistantMessage["usage"] | undefined): string {
	if (!usage) {
		return "usage unavailable";
	}
	return `${formatCount(usage.input)} in | ${formatCount(usage.output)} out | $${usage.cost.total.toFixed(3)}`;
}

function summarizeToolArgs(toolName: string, args: unknown): string {
	if (!isRecord(args)) {
		return clampText(String(args), 220);
	}

	switch (toolName) {
		case "bash":
			if (typeof args.command === "string") {
				return clampText(args.command, 220);
			}
			break;
		case "http": {
			const method = typeof args.method === "string" ? args.method : "GET";
			const url = typeof args.url === "string" ? args.url : "(unknown url)";
			return clampText(`${method} ${url}`, 220);
		}
		case "validate_artifact":
			if (typeof args.artifact_path === "string") {
				return clampText(args.artifact_path, 220);
			}
			break;
	}

	return clampText(safeJson(args), 220);
}

function formatToolOutputSummary(toolName: string, details: unknown, isError: boolean): string[] {
	if (!isRecord(details)) {
		return [isError ? styles.red("error result") : styles.green("completed")];
	}

	if (toolName === "bash") {
		const exitCode = typeof details.exitCode === "number" ? details.exitCode : 0;
		const timedOut = details.timedOut === true ? " | timed out" : "";
		const truncated = details.truncated === true ? " | truncated" : "";
		return [
			`${exitCode === 0 ? styles.green("exit 0") : styles.red(`exit ${exitCode}`)}${styles.dim(`${timedOut}${truncated}`)}`,
		];
	}

	if (toolName === "http") {
		const status = typeof details.status === "number" ? `${details.status}` : "?";
		const timing = typeof details.timingMs === "number" ? `${details.timingMs}ms` : "?";
		const contentType = typeof details.contentType === "string" ? details.contentType : "unknown";
		return [`${isError ? styles.red(status) : styles.green(status)} ${styles.dim(`| ${timing} | ${contentType}`)}`];
	}

	if (toolName === "validate_artifact") {
		const status = typeof details.status === "string" ? details.status : "unknown";
		const summary = typeof details.summary === "string" ? details.summary : "no summary";
		return [`${colorizeValidationStatus(status)} ${styles.dim(`| ${clampText(summary, 140)}`)}`];
	}

	if (toolName === "plan") {
		const phases = typeof details.phases === "number" ? `${details.phases} phases` : "plan updated";
		return [styles.cyan(phases)];
	}

	return [isError ? styles.red("execution failed") : styles.green("execution complete")];
}

function previewContentText(text: string, lineWidth: number, maxLines: number): string[] {
	return limitLines(
		flattenWrappedLines(clampText(text, 1800), lineWidth),
		maxLines,
		styles.dim("... preview truncated"),
	);
}

function colorizeSurfaceStatus(status: string): string {
	switch (status) {
		case "confirmed":
			return styles.green(status);
		case "active":
		case "hot":
			return styles.red(status);
		case "covered":
			return styles.cyan(status);
		case "blocked":
		case "rejected":
			return styles.subtle(status);
		default:
			return styles.amber(status);
	}
}

function colorizeValidationStatus(status: string): string {
	switch (status) {
		case "proof_complete":
			return styles.green(status);
		case "triggered":
			return styles.red(status);
		case "blocked":
		case "rejected":
			return styles.subtle(status);
		case "accepted_no_trigger":
		case "ambiguous":
			return styles.amber(status);
		default:
			return styles.subtle(status);
	}
}

function rankSurfaces(surfaces: Record<string, SurfaceRecord>): SurfaceRecord[] {
	return Object.values(surfaces).sort((left, right) => {
		if (right.score !== left.score) {
			return right.score - left.score;
		}
		return right.updatedAt.localeCompare(left.updatedAt);
	});
}

function keyHint(
	id:
		| "tui.input.submit"
		| "tui.input.newLine"
		| "app.exit"
		| "app.plan.scrollUp"
		| "app.plan.scrollDown"
		| "app.surfaces.scrollLeft"
		| "app.surfaces.scrollRight",
): string {
	const keys = getKeybindings().getKeys(id);
	return keys.join("/");
}

class SecurityConsoleApp implements Component, Focusable {
	private readonly editor: Editor;
	private readonly timeline: TimelineEntry[] = [];
	private readonly toolsById = new Map<string, ToolTimelineEntry>();
	private readonly unsubscribe: () => void;
	private readonly exitPromise: Promise<void>;
	private resolveExit!: () => void;
	private currentAssistantId?: string;
	private runningTools = 0;
	private recentTools: string[] = [];
	private planScrollOffset = 0;
	private showSurfaces = false;
	private surfaceScrollOffset = 0;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.editor.focused = value;
	}

	constructor(
		private readonly runtime: SecurityAgentRuntime,
		private readonly ui: TUI,
	) {
		const editorTheme: EditorTheme = {
			borderColor: styles.yellow,
			selectList: {
				selectedPrefix: (text) => styles.yellow(text),
				selectedText: (text) => sgr("1;38;5;231;48;2;42;39;8", text),
				description: (text) => styles.subtle(text),
				scrollInfo: (text) => styles.subtle(text),
				noMatch: (text) => styles.subtle(text),
			},
		};

		this.editor = new Editor(ui, editorTheme, { paddingX: 0, autocompleteMaxVisible: 6 });
		this.editor.setAutocompleteProvider(
			new CombinedAutocompleteProvider(
				[
					{ name: "status", description: "Ask the agent for a status summary" },
					{ name: "plan", description: "Ask the agent to refresh the plan" },
					{ name: "model", description: "Show or change the active model" },
					{ name: "effort", description: "Show or change the reasoning effort" },
					{ name: "surfaces", description: "Toggle the surfaces panel" },
				],
				this.runtime.workspaceRoot,
			),
		);
		this.editor.onSubmit = (text) => {
			void this.handleSubmit(text);
		};

		this.exitPromise = new Promise<void>((resolveExit) => {
			this.resolveExit = resolveExit;
		});
		this.unsubscribe = this.runtime.subscribe((event) => {
			this.handleAgentEvent(event);
		});

		this.pushNotice(
			"session",
			`${formatRelativePath(this.runtime.workspaceRoot, this.runtime.cwd)} attached to ${basename(this.runtime.workspaceRoot)}. ${this.runtime.contextFiles.length} context file${this.runtime.contextFiles.length === 1 ? "" : "s"} loaded.`,
			"neutral",
		);
		if (this.runtime.validationSpec) {
			this.pushNotice(
				"validation",
				`Validator ${this.runtime.validationSpec.name} is armed and the proof repair loop is active.`,
				"success",
			);
		}
	}

	waitForExit(): Promise<void> {
		return this.exitPromise;
	}

	dispose(): void {
		this.unsubscribe();
	}

	invalidate(): void {
		this.editor.invalidate();
	}

	handleInput(data: string): void {
		const keybindings = getKeybindings();

		if (this.hasPlan() && keybindings.matches(data, "app.plan.scrollUp")) {
			this.scrollPlan(-1);
			return;
		}

		if (this.hasPlan() && keybindings.matches(data, "app.plan.scrollDown")) {
			this.scrollPlan(1);
			return;
		}

		const editorText = this.editor.getText();
		const isBusy = this.runtime.state.isStreaming;
		if (keybindings.matches(data, "app.exit")) {
			if (isBusy) {
				this.setStatus("Wait for the active run to finish before exiting");
				return;
			}
			this.resolveExit();
			return;
		}

		if (this.showSurfaces && keybindings.matches(data, "app.surfaces.scrollLeft")) {
			this.scrollSurfaces(-1);
			return;
		}

		if (this.showSurfaces && keybindings.matches(data, "app.surfaces.scrollRight")) {
			this.scrollSurfaces(1);
			return;
		}

		if (isBusy && keybindings.matches(data, "tui.input.submit")) {
			const command = editorText.trim();
			if (this.handleLocalCommand(command)) {
				this.editor.setText("");
				this.ui.requestRender();
			}
			return;
		}

		this.editor.handleInput(data);
	}

	render(width: number): string[] {
		const effectiveWidth = Math.max(48, width);
		const snapshot = this.renderSnapshot(effectiveWidth);
		this.editor.disableSubmit = this.runtime.state.isStreaming;
		this.editor.borderColor = styles.subtle;
		const composer = this.renderComposer(effectiveWidth);
		const timeline = this.renderTimeline(effectiveWidth);
		const bottomSections = snapshot.length > 0 ? ["", ...snapshot, "", ...composer] : ["", ...composer];
		const spacerCount = Math.max(0, this.ui.terminal.rows - (timeline.length + bottomSections.length));
		return [...Array.from({ length: spacerCount }, () => ""), ...timeline, ...bottomSections];
	}

	private async handleSubmit(text: string): Promise<void> {
		const prompt = text.trim();
		if (prompt.length === 0) {
			return;
		}
		if (this.handleLocalCommand(prompt)) {
			this.editor.setText("");
			this.ui.requestRender();
			return;
		}
		if (this.runtime.state.isStreaming) {
			this.setStatus("Run already active. Wait for it to finish.");
			return;
		}

		this.editor.addToHistory(prompt);
		this.editor.setText("");
		this.setStatus("Dispatching prompt to security-agent");

		try {
			await this.runtime.prompt(prompt);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.pushNotice("runtime", message, "error");
			this.setStatus(`Run failed: ${message}`);
		}
	}

	private handleLocalCommand(command: string): boolean {
		const normalizedCommand = command.trim().replace(/^\/+/, "/");
		const [name = ""] = normalizedCommand.split(/\s+/, 1);
		const args = normalizedCommand.slice(name.length).trim();
		switch (name) {
			case "/surfaces":
				this.showSurfaces = !this.showSurfaces;
				if (this.showSurfaces) {
					this.surfaceScrollOffset = 0;
				}
				return true;
			case "/model":
				this.handleModelCommand(args);
				return true;
			case "/effort":
				this.handleEffortCommand(args);
				return true;
			default:
				return false;
		}
	}

	private handleModelCommand(args: string): void {
		const currentModel = this.runtime.model;
		const currentThinkingLevel = this.runtime.thinkingLevel;
		if (args.length === 0) {
			this.pushNotice(
				"model",
				`Current model ${currentModel.provider}/${currentModel.id} at ${currentThinkingLevel} effort. Usage: /model <provider> <model-id>, /model <provider>/<model-id>, or /model <model-id>.`,
				"neutral",
			);
			return;
		}

		try {
			const nextModel = resolveModelCommandInput(args, currentModel);
			const appliedThinkingLevel = this.runtime.setModel(nextModel);
			if (currentModel.provider === nextModel.provider && currentModel.id === nextModel.id) {
				this.pushNotice(
					"model",
					`Model remains ${nextModel.provider}/${nextModel.id} at ${appliedThinkingLevel} effort.${this.runtime.state.isStreaming ? " Applies on the next turn." : ""}`,
					"neutral",
				);
				return;
			}

			const effortNote =
				appliedThinkingLevel === currentThinkingLevel
					? `${appliedThinkingLevel} effort`
					: `${appliedThinkingLevel} effort (clamped from ${currentThinkingLevel})`;
			this.pushNotice(
				"model",
				`Model set to ${nextModel.provider}/${nextModel.id} with ${effortNote}.${this.runtime.state.isStreaming ? " Applies on the next turn." : ""}`,
				appliedThinkingLevel === currentThinkingLevel ? "success" : "warning",
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.pushNotice("model", message, "error");
		}
	}

	private handleEffortCommand(args: string): void {
		if (args.length === 0) {
			this.pushNotice(
				"effort",
				`Current effort ${this.runtime.thinkingLevel}. Usage: /effort <off|minimal|low|medium|high|xhigh>.`,
				"neutral",
			);
			return;
		}

		const requestedThinkingLevel = parseThinkingLevel(args);
		if (!requestedThinkingLevel) {
			this.pushNotice(
				"effort",
				`Invalid effort "${args}". Use one of: off, minimal, low, medium, high, xhigh.`,
				"error",
			);
			return;
		}

		const appliedThinkingLevel = this.runtime.setThinkingLevel(requestedThinkingLevel);
		const model = this.runtime.model;
		const message =
			appliedThinkingLevel === requestedThinkingLevel
				? `Effort set to ${appliedThinkingLevel} for ${model.provider}/${model.id}.${this.runtime.state.isStreaming ? " Applies on the next turn." : ""}`
				: `Effort ${requestedThinkingLevel} is not supported by ${model.provider}/${model.id}; using ${appliedThinkingLevel}.${this.runtime.state.isStreaming ? " Applies on the next turn." : ""}`;
		this.pushNotice("effort", message, appliedThinkingLevel === requestedThinkingLevel ? "success" : "warning");
	}

	private scrollPlan(delta: number): void {
		const totalPhases = this.runtime.planState.current?.phases.length ?? 0;
		const maxOffset = Math.max(0, totalPhases - planPanelVisibleLimit);
		const nextOffset = Math.max(0, Math.min(this.planScrollOffset + delta, maxOffset));
		if (nextOffset !== this.planScrollOffset) {
			this.planScrollOffset = nextOffset;
			this.ui.requestRender();
		}
	}

	private scrollSurfaces(delta: number): void {
		const totalSurfaces = Object.keys(this.runtime.surfaceMap.read().surfaces).length;
		const maxOffset = Math.max(0, totalSurfaces - surfacePanelVisibleLimit);
		const nextOffset = Math.max(0, Math.min(this.surfaceScrollOffset + delta, maxOffset));
		if (nextOffset !== this.surfaceScrollOffset) {
			this.surfaceScrollOffset = nextOffset;
			this.ui.requestRender();
		}
	}

	private handleAgentEvent(event: AgentEvent): void {
		switch (event.type) {
			case "agent_start":
				this.setStatus("Agent run in progress");
				break;
			case "agent_end":
				this.setStatus(this.runtime.state.errorMessage ?? "Agent idle");
				break;
			case "turn_start":
				this.setStatus("New analysis turn");
				break;
			case "turn_end":
				this.setStatus(
					event.toolResults.length > 0
						? `Turn complete with ${event.toolResults.length} tool result${event.toolResults.length === 1 ? "" : "s"}`
						: "Turn complete",
				);
				break;
			case "message_start":
				this.handleMessageStart(event.message);
				break;
			case "message_update":
				this.handleMessageUpdate(event.message);
				break;
			case "message_end":
				this.handleMessageEnd(event.message);
				break;
			case "tool_execution_start":
				this.handleToolStart(event.toolCallId, event.toolName, event.args);
				break;
			case "tool_execution_update":
				this.handleToolUpdate(event.toolCallId, event.partialResult);
				break;
			case "tool_execution_end":
				this.handleToolEnd(event.toolCallId, event.result, event.isError);
				break;
		}

		this.ui.requestRender();
	}

	private handleMessageStart(message: AgentMessage): void {
		if (message.role === "user") {
			this.appendTimeline({
				id: `user:${message.timestamp}:${this.timeline.length}`,
				kind: "user",
				timestamp: message.timestamp,
				text: extractMessageText(message),
			});
			this.setStatus("Operator prompt queued");
			return;
		}

		if (message.role === "assistant") {
			const content = extractAssistantContent(message);
			const entry: AssistantTimelineEntry = {
				id: `assistant:${message.timestamp}:${this.timeline.length}`,
				kind: "assistant",
				timestamp: message.timestamp,
				text: content.text,
				thinking: content.thinking,
				streaming: true,
				usage: undefined,
				toolCalls: content.toolCalls,
			};
			this.currentAssistantId = entry.id;
			this.appendTimeline(entry);
			this.setStatus("Streaming assistant analysis");
		}
	}

	private handleMessageUpdate(message: AgentMessage): void {
		if (message.role !== "assistant" || !this.currentAssistantId) {
			return;
		}

		const entry = this.timeline.find((item): item is AssistantTimelineEntry => item.id === this.currentAssistantId);
		if (!entry) {
			return;
		}

		const content = extractAssistantContent(message);
		entry.text = content.text;
		entry.thinking = content.thinking;
		entry.toolCalls = content.toolCalls;
		entry.streaming = true;
	}

	private handleMessageEnd(message: AgentMessage): void {
		if (message.role !== "assistant" || !this.currentAssistantId) {
			return;
		}

		const entry = this.timeline.find((item): item is AssistantTimelineEntry => item.id === this.currentAssistantId);
		if (!entry) {
			return;
		}

		const content = extractAssistantContent(message);
		entry.text = content.text;
		entry.thinking = content.thinking;
		entry.toolCalls = content.toolCalls;
		entry.streaming = false;
		entry.stopReason = message.stopReason;
		entry.errorMessage = message.errorMessage;
		entry.usage = message.usage;
		this.currentAssistantId = undefined;
	}

	private handleToolStart(toolCallId: string, toolName: string, args: unknown): void {
		const entry: ToolTimelineEntry = {
			id: `tool:${toolCallId}`,
			kind: "tool",
			timestamp: Date.now(),
			toolCallId,
			toolName,
			status: "running",
			args,
			output: "",
			details: undefined,
		};
		this.toolsById.set(toolCallId, entry);
		this.appendTimeline(entry);
		this.runningTools++;
		this.rememberTool(toolName);
		this.setStatus(`Running ${toolName}`);
	}

	private handleToolUpdate(toolCallId: string, partialResult: unknown): void {
		const entry = this.toolsById.get(toolCallId);
		if (!entry) {
			return;
		}
		if (isRecord(partialResult) && Array.isArray(partialResult.content)) {
			entry.output = joinTextParts(partialResult.content);
		}
	}

	private handleToolEnd(toolCallId: string, result: unknown, isError: boolean): void {
		const entry = this.toolsById.get(toolCallId);
		if (!entry) {
			return;
		}

		entry.status = isError ? "error" : "ok";
		if (isRecord(result)) {
			if (Array.isArray(result.content)) {
				entry.output = joinTextParts(result.content);
			}
			entry.details = result.details;
		}

		this.toolsById.delete(toolCallId);
		this.runningTools = Math.max(0, this.runningTools - 1);
		this.setStatus(isError ? `${entry.toolName} returned an error` : `${entry.toolName} completed successfully`);
	}

	private rememberTool(toolName: string): void {
		const normalized = toolName.trim();
		if (normalized.length === 0) {
			return;
		}
		this.recentTools = [normalized, ...this.recentTools.filter((name) => name !== normalized)].slice(0, 6);
	}

	private appendTimeline(entry: TimelineEntry): void {
		this.timeline.push(entry);
		if (this.timeline.length > 200) {
			this.timeline.splice(0, this.timeline.length - 200);
		}
	}

	private pushNotice(label: string, text: string, tone: NoticeTimelineEntry["tone"]): void {
		this.appendTimeline({
			id: `notice:${Date.now()}:${this.timeline.length}`,
			kind: "notice",
			timestamp: Date.now(),
			label,
			text,
			tone,
		});
	}

	private setStatus(text: string): void {
		void text;
	}

	private renderSnapshot(width: number): string[] {
		const sections: Array<{ title: string; lines: string[] }> = [];
		if (this.hasPlan()) {
			sections.push({
				title: `${brandBadge("PLAN")} ${styles.bright("execution")}`,
				lines: this.renderPlanLines(this.runtime.planState.current),
			});
		}
		if (this.showSurfaces) {
			sections.push({
				title: `${brandBadge("SURFACES")} ${styles.bright("priority targets")}`,
				lines: this.renderSurfaceLines(this.runtime.surfaceMap.read().surfaces),
			});
		}
		if (sections.length === 0) {
			return [];
		}
		const columnCount = width >= 110 ? 2 : 1;
		const gap = 1;
		const rows: string[] = [];
		for (let index = 0; index < sections.length; index += columnCount) {
			const chunk = sections.slice(index, index + columnCount);
			if (chunk.length === 1) {
				rows.push(...renderFilledBlock(width, chunk[0]!.title, chunk[0]!.lines, filledTones.snapshotCard));
			} else {
				const totalGap = gap * (chunk.length - 1);
				const availableWidth = Math.max(chunk.length, width - totalGap);
				const baseWidth = Math.floor(availableWidth / chunk.length);
				const widths = Array.from({ length: chunk.length }, (_, columnIndex) =>
					columnIndex === chunk.length - 1 ? availableWidth - baseWidth * (chunk.length - 1) : baseWidth,
				);
				const columns = chunk.map((section, columnIndex) =>
					renderFilledBlock(widths[columnIndex]!, section.title, section.lines, filledTones.snapshotCard),
				);
				const blankLines = widths.map((columnWidth) =>
					renderFilledLine("", columnWidth, 1, filledTones.snapshotCard.fg, filledTones.snapshotCard.bg),
				);
				const maxHeight = Math.max(...columns.map((column) => column.length));

				for (let row = 0; row < maxHeight; row++) {
					const parts = columns.map((column, columnIndex) => column[row] ?? blankLines[columnIndex]!);
					rows.push(parts.join(" ".repeat(gap)));
				}
			}
			if (index + columnCount < sections.length) {
				rows.push("");
			}
		}

		return rows;
	}

	private renderTimeline(width: number): string[] {
		if (this.timeline.length === 0) {
			return renderRailBlock(
				width,
				styles.bright("no activity yet"),
				[styles.dim("Submit a prompt to begin.")],
				tones.notice,
			);
		}

		const cards = this.timeline.map((entry) => this.renderTimelineEntry(entry, width));
		const lines: string[] = [];
		for (const card of cards) {
			if (lines[lines.length - 1] !== "") {
				lines.push("");
			}
			lines.push(...card);
		}
		return lines;
	}

	private renderTimelineEntry(entry: TimelineEntry, width: number): string[] {
		switch (entry.kind) {
			case "user":
				return this.renderUserEntry(entry, width);
			case "assistant":
				return this.renderAssistantEntry(entry, width);
			case "tool":
				return this.renderToolEntry(entry, width);
			case "notice":
				return this.renderNoticeEntry(entry, width);
		}
	}

	private renderUserEntry(entry: UserTimelineEntry, width: number): string[] {
		const bodyWidth = Math.max(1, width - 4);
		return renderRailBlock(
			width,
			`${brandBadge("OPERATOR")} ${styles.bright("prompt")}`,
			[
				styles.dim(`operator @ ${formatClock(entry.timestamp)}`),
				...limitLines(flattenWrappedLines(entry.text, bodyWidth), 8, styles.dim("... message truncated")),
			],
			tones.user,
		);
	}

	private renderAssistantEntry(entry: AssistantTimelineEntry, width: number): string[] {
		const responseTone = entry.streaming
			? filledTones.assistantPending
			: entry.stopReason === "error" || entry.stopReason === "aborted"
				? filledTones.assistantError
				: filledTones.assistantSuccess;
		const thinkingTone = filledTones.assistantPending;
		const bodyWidth = Math.max(1, width - 2);
		const stateLabel = entry.streaming
			? "streaming"
			: entry.stopReason === "error" || entry.stopReason === "aborted"
				? entry.stopReason
				: "complete";
		const blocks: string[] = [];
		const responseTitle = renderAlignedLine(
			responseTone.title("AGENT response"),
			responseTone.status(stateLabel),
			bodyWidth,
		);
		const responseLines: string[] = [
			responseTone.meta(`agent @ ${formatClock(entry.timestamp)} | ${formatUsage(entry.usage)}`),
		];

		if (entry.text.trim().length > 0) {
			responseLines.push("");
			responseLines.push(...flattenWrappedLines(entry.text, bodyWidth).map((line) => responseTone.body(line)));
		}

		if (entry.toolCalls > 0 && entry.text.trim().length === 0) {
			responseLines.push("");
			responseLines.push(
				responseTone.meta(`awaiting ${entry.toolCalls} tool execution${entry.toolCalls === 1 ? "" : "s"}`),
			);
		}

		if (entry.streaming && entry.text.trim().length === 0 && entry.thinking.trim().length === 0) {
			responseLines.push("");
			responseLines.push(responseTone.meta("awaiting model output"));
		}

		if (entry.stopReason === "error" || entry.stopReason === "aborted") {
			responseLines.push("");
			responseLines.push(responseTone.error(entry.errorMessage ?? `assistant ${entry.stopReason}`));
		}

		if (entry.thinking.trim().length > 0) {
			const thinkingTitle = renderAlignedLine(
				thinkingTone.title("THINKING trace"),
				thinkingTone.status(entry.streaming ? "live" : "captured"),
				bodyWidth,
			);
			const thinkingLines = limitLines(
				flattenWrappedLines(entry.thinking, bodyWidth),
				entry.streaming ? 10 : 6,
				thinkingTone.meta("... thinking truncated"),
			).map((line) => thinkingTone.thinking(line));
			blocks.push(...renderFilledBlock(width, thinkingTitle, thinkingLines, thinkingTone));
		}

		if (
			entry.text.trim().length > 0 ||
			entry.toolCalls > 0 ||
			(entry.streaming && entry.thinking.trim().length === 0) ||
			entry.stopReason === "error" ||
			entry.stopReason === "aborted"
		) {
			if (blocks.length > 0) {
				blocks.push("");
			}
			blocks.push(...renderFilledBlock(width, responseTitle, responseLines, responseTone));
		}

		return blocks;
	}

	private renderToolEntry(entry: ToolTimelineEntry, width: number): string[] {
		const tone =
			entry.status === "running" ? tones.tool : entry.status === "error" ? tones.toolError : tones.toolSuccess;
		const statusBadge =
			entry.status === "running"
				? styles.bgBadge("RUNNING", 232, 208)
				: entry.status === "error"
					? styles.bgBadge("ERROR", 231, 160)
					: styles.bgBadge("OK", 232, 114);
		const lines: string[] = [
			styles.dim(`tool @ ${formatClock(entry.timestamp)} | ${summarizeToolArgs(entry.toolName, entry.args)}`),
			...formatToolOutputSummary(entry.toolName, entry.details, entry.status === "error"),
		];

		if (entry.output.trim().length > 0) {
			lines.push("");
			lines.push(styles.subtle("output preview"));
			lines.push(...previewContentText(entry.output, Math.max(1, width - 4), 8).map((line) => styles.text(line)));
		}

		return renderRailBlock(
			width,
			`${styles.bgBadge(entry.toolName.toUpperCase(), 232, 226)} ${styles.bright("operation")} ${styles.dim("|")} ${statusBadge}`,
			lines,
			tone,
		);
	}

	private renderNoticeEntry(entry: NoticeTimelineEntry, width: number): string[] {
		const tone =
			entry.tone === "warning"
				? tones.warning
				: entry.tone === "error"
					? tones.error
					: entry.tone === "success"
						? tones.success
						: tones.notice;

		return renderRailBlock(
			width,
			`${styles.bgBadge(entry.label.toUpperCase(), 231, 24)} ${styles.bright("notice")}`,
			[styles.dim(formatClock(entry.timestamp)), entry.text],
			tone,
		);
	}

	private renderComposer(width: number): string[] {
		const inputWidth = Math.max(1, width - composerSurface.paddingX * 2);
		const workspaceLabel = forceTildeHome(formatFooterWorkspacePath(this.runtime.workspaceRoot));
		const modelLabel = `${this.runtime.state.model.id} ${this.runtime.state.thinkingLevel}`;
		const stateBadge = this.runtime.state.isStreaming
			? styles.bgBadge("LOCKED", 232, 208)
			: styles.bgBadge("ARMED", 232, 114);
		const editorLines = this.editor.render(inputWidth);
		if (editorLines.length > 0 && isSolidRuleLine(editorLines[0]!)) {
			editorLines.shift();
		}
		for (let index = editorLines.length - 1; index >= 0; index--) {
			if (isSolidRuleLine(editorLines[index]!)) {
				editorLines.splice(index, 1);
				break;
			}
		}
		const footer = renderAlignedLine(
			styles.dim(`${modelLabel} • ${workspaceLabel} • ${keyHint("app.exit")} exit`),
			stateBadge,
			width,
		);
		return [
			renderFilledLine("", width, composerSurface.paddingX),
			...(editorLines.length > 0 ? editorLines : [""]).map((line) =>
				renderFilledLine(line, width, composerSurface.paddingX),
			),
			renderFilledLine("", width, composerSurface.paddingX),
			footer,
		];
	}

	private hasPlan(): boolean {
		const plan = this.runtime.planState.current;
		return !!plan && plan.phases.length > 0;
	}

	private renderPlanLines(plan: ResearchPlan | undefined): string[] {
		if (!plan || plan.phases.length === 0) {
			return [
				styles.subtle("no saved execution plan"),
				styles.dim("ask the agent to call the plan tool early in the run"),
			];
		}

		const maxOffset = Math.max(0, plan.phases.length - planPanelVisibleLimit);
		const offset = Math.max(0, Math.min(this.planScrollOffset, maxOffset));
		if (offset !== this.planScrollOffset) {
			this.planScrollOffset = offset;
		}

		const visiblePhases = plan.phases.slice(offset, offset + planPanelVisibleLimit);
		const lines = [styles.dim(`${plan.createdAt.replace("T", " ").slice(0, 19)}Z`)];
		for (const [index, phase] of visiblePhases.entries()) {
			lines.push(
				`${styles.cyan(`${offset + index + 1}. ${phase.name}`)} ${styles.dim(phase.parallelSteps ? "[parallel]" : "[serial]")}`,
			);
			const leadStep = phase.steps[0];
			if (leadStep) {
				const summary = compactText(leadStep, 72);
				if (summary.length > 0) {
					lines.push(styles.dim(summary));
				}
			}
		}
		if (plan.phases.length > planPanelVisibleLimit) {
			lines.push(
				styles.dim(
					`${offset + 1}-${offset + visiblePhases.length} of ${plan.phases.length} | ${keyHint("app.plan.scrollUp")}/${keyHint("app.plan.scrollDown")}`,
				),
			);
		}
		return lines;
	}

	private renderSurfaceLines(surfaces: Record<string, SurfaceRecord>): string[] {
		const ranked = rankSurfaces(surfaces);
		if (ranked.length === 0) {
			this.surfaceScrollOffset = 0;
			return [
				styles.subtle("surface map empty"),
				styles.dim("targets will appear as the agent explores the workspace"),
			];
		}

		const maxOffset = Math.max(0, ranked.length - surfacePanelVisibleLimit);
		const offset = Math.max(0, Math.min(this.surfaceScrollOffset, maxOffset));
		if (offset !== this.surfaceScrollOffset) {
			this.surfaceScrollOffset = offset;
		}

		const visibleSurfaces = ranked.slice(offset, offset + surfacePanelVisibleLimit);
		const lines: string[] = [];
		for (const surface of visibleSurfaces) {
			const surfaceId = compactText(surface.id, 56);
			lines.push(
				`${styles.red(`s${surface.score}`)} ${colorizeSurfaceStatus(surface.status)} ${styles.text(surfaceId)}`,
			);
			if (surface.why) {
				const reason = compactText(surface.why, 64);
				if (reason.length > 0) {
					lines.push(styles.dim(reason));
				}
			}
		}
		if (ranked.length > surfacePanelVisibleLimit) {
			lines.push(
				styles.dim(
					`${offset + 1}-${offset + visibleSurfaces.length} of ${ranked.length} | ${keyHint("app.surfaces.scrollLeft")}/${keyHint("app.surfaces.scrollRight")}`,
				),
			);
		}
		return lines;
	}
}

export async function runInteractiveTui(runtime: SecurityAgentRuntime): Promise<void> {
	setKeybindings(createSecurityAgentKeybindings());

	const terminal = new ProcessTerminal();
	const ui = new TUI(terminal);
	const app = new SecurityConsoleApp(runtime, ui);

	ui.addChild(app);
	ui.setFocus(app);
	ui.terminal.setTitle("pire // red cell console");
	ui.start();

	try {
		await app.waitForExit();
	} finally {
		app.dispose();
		ui.stop();
	}
}
