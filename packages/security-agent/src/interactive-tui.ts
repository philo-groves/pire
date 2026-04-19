import { spawn } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { basename, resolve } from "node:path";
import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { OAuthProviderInterface } from "@mariozechner/pi-ai/oauth";
import {
	CombinedAutocompleteProvider,
	type Component,
	type DefaultTextStyle,
	Editor,
	type EditorTheme,
	type Focusable,
	getKeybindings,
	hyperlink,
	Input,
	Markdown,
	type MarkdownTheme,
	ProcessTerminal,
	setKeybindings,
	TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import {
	getAvailableOAuthProviders,
	getConfiguredOAuthProviderIds,
	getDefaultAuthPath,
	loginWithOAuthProvider,
	logoutOAuthProvider,
} from "./auth.js";
import { createSecurityAgentKeybindings } from "./keybindings.js";
import { parseThinkingLevel, resolveModelCommandInput } from "./models.js";
import type { SecurityAgentRuntime } from "./runtime.js";
import type { SessionInfo } from "./session-manager.js";
import type { SurfaceRecord } from "./surface-map/store.js";
import { stripPlanCompletionMarker } from "./tools/plan.js";

type TimelineEntry =
	| BannerTimelineEntry
	| UserTimelineEntry
	| AssistantTimelineEntry
	| ToolTimelineEntry
	| NoticeTimelineEntry;
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
	title?: string;
	metaText?: string | null;
	statusLabel?: string | null;
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

interface BannerTimelineEntry extends TimelineEntryBase {
	kind: "banner";
	lines: string[];
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

type ColorMode = "truecolor" | "256color";
type RgbColor = { r: number; g: number; b: number };

interface OAuthSelectorState {
	mode: "login" | "logout";
	providers: OAuthProviderInterface[];
	selectedIndex: number;
}

interface OAuthDialogState {
	providerId: string;
	providerName: string;
	input: Input;
	abortController: AbortController;
	authUrl?: string;
	instructions?: string;
	waitingMessage?: string;
	progressMessages: string[];
	promptMessage?: string;
	promptPlaceholder?: string;
	pendingInput?:
		| {
				resolve: (value: string) => void;
				reject: (error: Error) => void;
		  }
		| undefined;
	cancelling: boolean;
}

interface ResumeSelectorState {
	sessions: SessionInfo[];
	selectedIndex: number;
}

function sgr(codes: string, text: string): string {
	return `\x1b[${codes}m${text}\x1b[0m`;
}

const styles = {
	text: (text: string) => sgr("38;5;252", text),
	bright: (text: string) => sgr("1;38;5;231", text),
	dim: (text: string) => sgr("2;38;5;244", text),
	subtle: (text: string) => sgr("38;5;246", text),
	primary: (text: string) => sgr("38;5;24", text),
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

const brandBadge = (label: string): string => styles.bgBadge(label, 231, 24);

const composerSurface = {
	bg: 235,
	fg: 252,
	paddingX: 1,
} as const;

const planPanelVisibleLimit = 2;
const surfacePanelVisibleLimit = 3;
const resumePanelVisibleLimit = 8;
const planAnimationIntervalMs = 160;

const tones = {
	user: { border: styles.primary, accent: styles.primary, muted: styles.subtle },
	assistant: { border: styles.cyan, accent: styles.cyan, muted: styles.subtle },
	tool: { border: styles.amber, accent: styles.amber, muted: styles.subtle },
	toolError: { border: styles.red, accent: styles.red, muted: styles.subtle },
	toolSuccess: { border: styles.green, accent: styles.green, muted: styles.subtle },
	notice: { border: styles.blue, accent: styles.blue, muted: styles.subtle },
	warning: { border: styles.amber, accent: styles.yellow, muted: styles.subtle },
	error: { border: styles.red, accent: styles.red, muted: styles.subtle },
	success: { border: styles.green, accent: styles.green, muted: styles.subtle },
	card: { border: styles.subtle, accent: styles.primary, muted: styles.subtle },
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
		bg: "48;2;10;14;20",
		title: (text: string) => sgr("1;38;5;231", text),
		meta: (text: string) => sgr("38;5;152", text),
		label: (text: string) => sgr("38;5;189", text),
		body: (text: string) => sgr("38;5;255", text),
		status: (text: string) => sgr("1;38;5;117", text),
		thinking: (text: string) => sgr("3;38;5;153", text),
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
	toolPending: {
		fg: 231,
		bg: "48;2;24;18;10",
		title: (text: string) => sgr("1;38;5;231", text),
		meta: (text: string) => sgr("38;5;248", text),
		label: (text: string) => sgr("38;5;223", text),
		body: (text: string) => sgr("38;5;252", text),
		status: (text: string) => sgr("1;38;5;215", text),
		thinking: (text: string) => sgr("3;38;5;250", text),
		error: (text: string) => sgr("38;5;217", text),
	},
	toolSuccess: {
		fg: 231,
		bg: "48;2;11;16;20",
		title: (text: string) => sgr("1;38;5;231", text),
		meta: (text: string) => sgr("38;5;151", text),
		label: (text: string) => sgr("38;5;189", text),
		body: (text: string) => sgr("38;5;255", text),
		status: (text: string) => sgr("1;38;5;114", text),
		thinking: (text: string) => sgr("3;38;5;153", text),
		error: (text: string) => sgr("38;5;224", text),
	},
	toolError: {
		fg: 231,
		bg: "48;2;38;12;14",
		title: (text: string) => sgr("1;38;5;231", text),
		meta: (text: string) => sgr("38;5;224", text),
		label: (text: string) => sgr("38;5;217", text),
		body: (text: string) => sgr("38;5;224", text),
		status: (text: string) => sgr("1;38;5;210", text),
		thinking: (text: string) => sgr("3;38;5;224", text),
		error: (text: string) => sgr("1;38;5;231", text),
	},
	thinkingCard: {
		fg: 252,
		bg: "48;2;12;12;14",
		title: (text: string) => sgr("1;38;5;250", text),
		meta: (text: string) => sgr("38;5;243", text),
		label: (text: string) => sgr("38;5;247", text),
		body: (text: string) => sgr("38;5;246", text),
		status: (text: string) => sgr("38;5;246", text),
		thinking: (text: string) => sgr("3;38;5;246", text),
		error: (text: string) => sgr("38;5;217", text),
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

const startupBannerLines = [
	"██████╗ ██╗    ███████╗ ██████╗ ██████╗     ██████╗ ███████╗",
	"██╔══██╗██║    ██╔════╝██╔═══██╗██╔══██╗    ██╔══██╗██╔════╝",
	"██████╔╝██║    █████╗  ██║   ██║██████╔╝    ██████╔╝█████╗  ",
	"██╔═══╝ ██║    ██╔══╝  ██║   ██║██╔══██╗    ██╔══██╗██╔══╝  ",
	"██║     ██║    ██║     ╚██████╔╝██║  ██║    ██║  ██║███████╗",
	"╚═╝     ╚═╝    ╚═╝      ╚═════╝ ╚═╝  ╚═╝    ╚═╝  ╚═╝╚══════╝",
] as const;

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

function createMarkdownTheme(textStyle: (text: string) => string): MarkdownTheme {
	return {
		heading: textStyle,
		link: textStyle,
		linkUrl: styles.subtle,
		code: textStyle,
		codeBlock: textStyle,
		codeBlockBorder: styles.subtle,
		quote: textStyle,
		quoteBorder: styles.subtle,
		hr: styles.subtle,
		listBullet: (text: string) => textStyle(text.replace(/^- /, "• ")),
		bold: (text: string) => sgr("1", text),
		italic: (text: string) => sgr("3", text),
		strikethrough: (text: string) => sgr("9", text),
		underline: (text: string) => sgr("4", text),
	};
}

function renderMarkdownLines(
	text: string,
	width: number,
	textStyle: (text: string) => string,
	defaultTextStyle?: DefaultTextStyle,
): string[] {
	if (text.trim().length === 0) {
		return [""];
	}

	const markdown = new Markdown(text, 0, 0, createMarkdownTheme(textStyle), defaultTextStyle);
	return markdown.render(Math.max(1, width));
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

function formatSessionTimestamp(timestamp: Date): string {
	return timestamp.toISOString().slice(0, 16).replace("T", " ");
}

function getTimelineTimestamp(message: AgentMessage): number {
	return typeof (message as { timestamp?: unknown }).timestamp === "number"
		? ((message as { timestamp: number }).timestamp ?? Date.now())
		: Date.now();
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

function openExternalUrl(url: string): void {
	try {
		if (process.platform === "win32") {
			const child = spawn("cmd", ["/c", "start", "", url], {
				detached: true,
				stdio: "ignore",
			});
			child.unref();
			return;
		}

		const command = process.platform === "darwin" ? "open" : "xdg-open";
		const child = spawn(command, [url], {
			detached: true,
			stdio: "ignore",
		});
		child.unref();
	} catch {
		// Browser open failures are non-fatal; the URL stays visible in the TUI.
	}
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

function renderCompactFilledBlock(
	width: number,
	title: string,
	lines: string[],
	tone: FilledTone,
	paddingX = 1,
): string[] {
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
		renderFilledLine(title, width, paddingX, tone.fg, tone.bg),
		...wrappedLines.map((line) => renderFilledLine(line, width, paddingX, tone.fg, tone.bg)),
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

function padBlockLines(lines: string[], width: number, paddingX = 1): string[] {
	const innerWidth = Math.max(1, width - paddingX * 2);
	const padding = " ".repeat(Math.max(0, paddingX));
	return lines.map((line) => `${padding}${fitLine(line, innerWidth)}${padding}`);
}

function detectColorMode(): ColorMode {
	const colorterm = process.env.COLORTERM;
	if (colorterm === "truecolor" || colorterm === "24bit") {
		return "truecolor";
	}
	if (process.env.WT_SESSION) {
		return "truecolor";
	}
	const term = process.env.TERM || "";
	if (term === "dumb" || term === "" || term === "linux") {
		return "256color";
	}
	if (process.env.TERM_PROGRAM === "Apple_Terminal") {
		return "256color";
	}
	if (term === "screen" || term.startsWith("screen-") || term.startsWith("screen.")) {
		return "256color";
	}
	return "truecolor";
}

const colorMode = detectColorMode();
const cubeValues = [0, 95, 135, 175, 215, 255];
const grayValues = Array.from({ length: 24 }, (_, index) => 8 + index * 10);
const phaseGradientStops: readonly RgbColor[] = [
	{ r: 190, g: 197, b: 208 },
	{ r: 118, g: 148, b: 194 },
	{ r: 126, g: 187, b: 255 },
	{ r: 195, g: 221, b: 255 },
	{ r: 118, g: 148, b: 194 },
	{ r: 190, g: 197, b: 208 },
];
const stepGradientStops: readonly RgbColor[] = [
	{ r: 124, g: 132, b: 144 },
	{ r: 92, g: 119, b: 158 },
	{ r: 112, g: 166, b: 226 },
	{ r: 168, g: 196, b: 231 },
	{ r: 92, g: 119, b: 158 },
	{ r: 124, g: 132, b: 144 },
];

function findClosestCubeIndex(value: number): number {
	let minDistance = Infinity;
	let minIndex = 0;
	for (const [index, candidate] of cubeValues.entries()) {
		const distance = Math.abs(value - candidate);
		if (distance < minDistance) {
			minDistance = distance;
			minIndex = index;
		}
	}
	return minIndex;
}

function findClosestGrayIndex(value: number): number {
	let minDistance = Infinity;
	let minIndex = 0;
	for (const [index, candidate] of grayValues.entries()) {
		const distance = Math.abs(value - candidate);
		if (distance < minDistance) {
			minDistance = distance;
			minIndex = index;
		}
	}
	return minIndex;
}

function colorDistance(left: RgbColor, right: RgbColor): number {
	const red = left.r - right.r;
	const green = left.g - right.g;
	const blue = left.b - right.b;
	return red * red * 0.299 + green * green * 0.587 + blue * blue * 0.114;
}

function rgbTo256(color: RgbColor): number {
	const redIndex = findClosestCubeIndex(color.r);
	const greenIndex = findClosestCubeIndex(color.g);
	const blueIndex = findClosestCubeIndex(color.b);
	const cubeColor = {
		r: cubeValues[redIndex]!,
		g: cubeValues[greenIndex]!,
		b: cubeValues[blueIndex]!,
	};
	const cubeDistance = colorDistance(color, cubeColor);
	const grayValue = Math.round(0.299 * color.r + 0.587 * color.g + 0.114 * color.b);
	const grayIndex = findClosestGrayIndex(grayValue);
	const grayColor = {
		r: grayValues[grayIndex]!,
		g: grayValues[grayIndex]!,
		b: grayValues[grayIndex]!,
	};
	const grayDistance = colorDistance(color, grayColor);
	const spread = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
	if (spread < 10 && grayDistance < cubeDistance) {
		return 232 + grayIndex;
	}
	return 16 + 36 * redIndex + 6 * greenIndex + blueIndex;
}

function colorTextRgb(text: string, color: RgbColor, bold = false): string {
	if (colorMode === "truecolor") {
		return sgr(`${bold ? "1;" : ""}38;2;${color.r};${color.g};${color.b}`, text);
	}
	return sgr(`${bold ? "1;" : ""}38;5;${rgbTo256(color)}`, text);
}

function mixChannel(left: number, right: number, ratio: number): number {
	return Math.round(left + (right - left) * ratio);
}

function mixRgb(left: RgbColor, right: RgbColor, ratio: number): RgbColor {
	return {
		r: mixChannel(left.r, right.r, ratio),
		g: mixChannel(left.g, right.g, ratio),
		b: mixChannel(left.b, right.b, ratio),
	};
}

function sampleGradient(stops: readonly RgbColor[], position: number): RgbColor {
	if (stops.length === 0) {
		return { r: 255, g: 255, b: 255 };
	}
	if (stops.length === 1) {
		return stops[0]!;
	}
	const normalizedPosition = ((position % 1) + 1) % 1;
	const scaledPosition = normalizedPosition * (stops.length - 1);
	const leftIndex = Math.floor(scaledPosition);
	const rightIndex = Math.min(stops.length - 1, leftIndex + 1);
	const ratio = scaledPosition - leftIndex;
	return mixRgb(stops[leftIndex]!, stops[rightIndex]!, ratio);
}

function renderAnimatedGradientText(text: string, frame: number, stops: readonly RgbColor[], bold = false): string {
	const chars = Array.from(text);
	if (chars.length === 0) {
		return "";
	}
	const phase = frame * 0.07;
	const span = Math.max(8, chars.length + 10);
	return chars
		.map((char, index) => {
			const position = (index / span + phase) % 1;
			return colorTextRgb(char, sampleGradient(stops, position), bold);
		})
		.join("");
}

function formatUsage(usage: AssistantMessage["usage"] | undefined): string {
	if (!usage) {
		return "usage unavailable";
	}
	const cacheRead = usage.cacheRead ?? 0;
	const cacheWrite = usage.cacheWrite ?? 0;
	if (usage.input === 0 && usage.output === 0 && cacheRead === 0 && cacheWrite === 0 && usage.cost.total === 0) {
		return "usage unavailable";
	}
	return `${formatCount(usage.input)} in | ${formatCount(usage.output)} out | $${usage.cost.total.toFixed(3)}`;
}

function formatUsageMetrics(usage: AssistantMessage["usage"] | undefined): string | undefined {
	if (!usage) {
		return undefined;
	}
	const cacheRead = usage.cacheRead ?? 0;
	const cacheWrite = usage.cacheWrite ?? 0;
	if (usage.input === 0 && usage.output === 0 && cacheRead === 0 && cacheWrite === 0 && usage.cost.total === 0) {
		return undefined;
	}
	return formatUsage(usage);
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
		case "notebook_write":
			if (typeof args.key === "string") {
				return clampText(`write ${args.key}`, 220);
			}
			break;
		case "notebook_append":
			if (typeof args.key === "string") {
				return clampText(`append ${args.key}`, 220);
			}
			break;
		case "notebook_read":
			return typeof args.key === "string" ? clampText(`read ${args.key}`, 220) : "read notebook";
		case "notebook_delete":
			if (typeof args.key === "string") {
				return clampText(`delete ${args.key}`, 220);
			}
			break;
		case "surface_map":
		case "logic_map":
		case "workspace_graph":
		case "finding_gate": {
			const action = typeof args.action === "string" ? args.action : "run";
			const target =
				typeof args.id === "string"
					? args.id
					: typeof args.label === "string"
						? args.label
						: typeof args.query === "string"
							? args.query
							: undefined;
			return clampText(target ? `${action} ${target}` : action, 220);
		}
		case "plan":
			if (args.clear === true) {
				return "clear plan";
			}
			if (Array.isArray(args.phases)) {
				return `${args.phases.length} phases`;
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
		if (details.cleared === true) {
			return [styles.green("plan cleared")];
		}
		return [];
	}

	if (
		toolName === "notebook_write" ||
		toolName === "notebook_append" ||
		toolName === "notebook_delete" ||
		toolName === "notebook_read"
	) {
		const key = typeof details.key === "string" ? `"${details.key}"` : "notebook";
		const entries = typeof details.entries === "number" ? `${details.entries} entries` : undefined;
		return [entries ? `${styles.text(key)} ${styles.dim(`| ${entries}`)}` : styles.text(key)];
	}

	if (toolName === "surface_map") {
		const id = typeof details.id === "string" ? details.id : "surface map";
		const surfaces = typeof details.surfaces === "number" ? `${details.surfaces} tracked` : undefined;
		return [surfaces ? `${styles.text(id)} ${styles.dim(`| ${surfaces}`)}` : styles.text(id)];
	}

	if (toolName === "logic_map") {
		const id = typeof details.id === "string" ? details.id : "logic map";
		const rules = typeof details.rules === "number" ? `${details.rules} rules` : undefined;
		return [rules ? `${styles.text(id)} ${styles.dim(`| ${rules}`)}` : styles.text(id)];
	}

	if (toolName === "workspace_graph") {
		const nodes = typeof details.nodes === "number" ? `${details.nodes} nodes` : "workspace graph";
		const exact = typeof details.exact === "number" ? `${details.exact} exact` : undefined;
		const related = typeof details.related === "number" ? `${details.related} related` : undefined;
		const parts = [nodes, exact, related].filter((part) => typeof part === "string");
		return [styles.text(parts.join(" | "))];
	}

	if (toolName === "finding_gate") {
		const recommendation =
			typeof details.recommendation === "string" ? details.recommendation.replaceAll("_", " ") : "reviewed";
		const findingId = typeof details.findingId === "string" ? details.findingId : undefined;
		return [
			findingId ? `${styles.text(recommendation)} ${styles.dim(`| ${findingId}`)}` : styles.text(recommendation),
		];
	}

	return [isError ? styles.red("execution failed") : styles.green("execution complete")];
}

function shouldShowToolPreview(entry: ToolTimelineEntry): boolean {
	if (entry.output.trim().length === 0) {
		return false;
	}

	if (
		entry.toolName === "notebook_write" ||
		entry.toolName === "notebook_append" ||
		entry.toolName === "notebook_delete" ||
		entry.toolName === "logic_map" ||
		entry.toolName === "surface_map" ||
		entry.toolName === "plan"
	) {
		return false;
	}

	return true;
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
		| "tui.select.up"
		| "tui.select.down"
		| "tui.select.confirm"
		| "tui.select.cancel"
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
	private resumeSelector?: ResumeSelectorState;
	private oauthSelector?: OAuthSelectorState;
	private oauthDialog?: OAuthDialogState;
	private planAnimationTimer?: NodeJS.Timeout;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.editor.focused = value;
		if (this.oauthDialog) {
			this.oauthDialog.input.focused = value;
		}
	}

	constructor(
		private readonly runtime: SecurityAgentRuntime,
		private readonly ui: TUI,
	) {
		const editorTheme: EditorTheme = {
			borderColor: styles.primary,
			selectList: {
				selectedPrefix: (text) => styles.primary(text),
				selectedText: (text) => sgr("1;38;5;231;48;5;24", text),
				description: (text) => styles.subtle(text),
				scrollInfo: (text) => styles.subtle(text),
				noMatch: (text) => styles.subtle(text),
			},
		};

		this.editor = new Editor(ui, editorTheme, { paddingX: 0, autocompleteMaxVisible: 6 });
		this.editor.setAutocompleteProvider(
			new CombinedAutocompleteProvider(
				[
					{ name: "login", description: "Login with an OAuth provider" },
					{ name: "logout", description: "Logout from an OAuth provider" },
					{ name: "new", description: "Start a new conversation" },
					{ name: "option", description: "Choose a recommended option" },
					{ name: "graph", description: "Export the current research graph to HTML" },
					{ name: "resume", description: "Resume a stored conversation" },
					{ name: "status", description: "Ask the agent for a status summary" },
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

		this.pushStartupBanner();
		this.pushStartupRecommendations();
		if (this.runtime.validationSpec) {
			this.pushNotice(
				"validation",
				`Validator ${this.runtime.validationSpec.name} is armed and the proof repair loop is active.`,
				"success",
			);
		}
		this.syncPlanAnimation();
	}

	waitForExit(): Promise<void> {
		return this.exitPromise;
	}

	dispose(): void {
		this.unsubscribe();
		this.stopPlanAnimation();
	}

	invalidate(): void {
		this.editor.invalidate();
		this.oauthDialog?.input.invalidate();
	}

	handleInput(data: string): void {
		const keybindings = getKeybindings();

		if (this.oauthDialog) {
			this.handleOAuthDialogInput(data);
			return;
		}

		if (this.oauthSelector) {
			this.handleOAuthSelectorInput(data);
			return;
		}

		if (this.resumeSelector) {
			this.handleResumeSelectorInput(data);
			return;
		}

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
		this.syncPlanAnimation();
		const effectiveWidth = Math.max(48, width);
		const planPanel = this.renderPlanPanel(effectiveWidth);
		const snapshot = this.renderSnapshot(effectiveWidth);
		this.editor.disableSubmit = this.runtime.state.isStreaming;
		this.editor.borderColor = styles.subtle;
		const composer = this.renderActiveInputSection(effectiveWidth);
		const timeline = this.renderTimeline(effectiveWidth);
		const bottomSections: string[] = [];
		if (planPanel.length > 0) {
			bottomSections.push("", ...planPanel);
		}
		if (snapshot.length > 0) {
			bottomSections.push("", ...snapshot);
		}
		bottomSections.push("", ...composer);
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
		await this.dispatchPrompt(prompt);
	}

	private async dispatchPrompt(prompt: string): Promise<void> {
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
			case "/login":
				this.handleLoginCommand(args);
				return true;
			case "/logout":
				this.handleLogoutCommand(args);
				return true;
			case "/new":
				this.handleNewCommand();
				return true;
			case "/option":
				this.handleOptionCommand(args);
				return true;
			case "/graph":
				void this.handleGraphCommand(args);
				return true;
			case "/resume":
				this.handleResumeCommand(args);
				return true;
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

	private handleOptionCommand(args: string): void {
		const option = args.trim();
		if (option.length === 0) {
			this.pushNotice("option", "Usage: /option <letter|number>", "warning");
			return;
		}

		if (!/^[a-z0-9]+$/i.test(option)) {
			this.pushNotice("option", `Invalid option "${option}". Use a letter or number.`, "error");
			return;
		}

		void this.dispatchPrompt(`Let's go with option ${option}`);
	}

	private async handleGraphCommand(args: string): Promise<void> {
		if (args.trim().length > 0) {
			this.pushNotice("graph", "Usage: /graph", "warning");
			this.ui.requestRender();
			return;
		}

		try {
			const result = await this.runtime.exportResearchGraphHtml();
			const statsLabel = `${result.nodeCount} nodes | ${result.edgeCount} edges`;
			this.pushNotice(
				"graph",
				`Research graph exported to ${hyperlink(result.displayPath, result.url)} (${statsLabel}).`,
				result.nodeCount === 0 ? "warning" : "success",
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.pushNotice("graph", `Failed to export research graph: ${message}`, "error");
		}

		this.ui.requestRender();
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

	private handleLoginCommand(args: string): void {
		const providerId = args.trim();
		if (providerId.length === 0) {
			this.openOAuthSelector("login");
			return;
		}

		const provider = getAvailableOAuthProviders().find((candidate) => candidate.id === providerId);
		if (!provider) {
			const availableProviders = getAvailableOAuthProviders()
				.map((candidate) => candidate.id)
				.join(", ");
			this.pushNotice(
				"login",
				`Unknown OAuth provider "${providerId}". Available providers: ${availableProviders}.`,
				"error",
			);
			return;
		}

		void this.beginOAuthLogin(provider.id);
	}

	private handleLogoutCommand(args: string): void {
		const providerId = args.trim();
		if (providerId.length === 0) {
			this.openOAuthSelector("logout");
			return;
		}

		this.performLogout(providerId);
	}

	private handleNewCommand(): void {
		if (this.runtime.state.isStreaming) {
			this.pushNotice("new", "Wait for the active run to finish before starting a new conversation.", "warning");
			return;
		}
		if (this.oauthDialog || this.oauthSelector || this.resumeSelector) {
			this.pushNotice(
				"new",
				"Finish the active selector or OAuth flow before starting a new conversation.",
				"warning",
			);
			return;
		}

		this.runtime.startNewConversation();
		this.resetConversationView();
		this.pushNotice(
			"session",
			`Started a new stored conversation in ${basename(this.runtime.workspaceRoot)}. Workspace notes and surface state were preserved.`,
			"neutral",
		);
		this.pushStartupRecommendations();
		this.ui.requestRender();
	}

	private handleResumeCommand(args: string): void {
		if (this.runtime.state.isStreaming) {
			this.pushNotice(
				"resume",
				"Wait for the active run to finish before resuming another conversation.",
				"warning",
			);
			return;
		}
		if (this.oauthDialog || this.oauthSelector) {
			this.pushNotice("resume", "Finish the active OAuth flow before resuming another conversation.", "warning");
			return;
		}

		const sessionArg = args.trim();
		if (sessionArg.length === 0) {
			this.openResumeSelector();
			return;
		}

		const session = this.runtime.resolveStoredConversation(sessionArg);
		if (!session) {
			this.pushNotice("resume", `No stored conversation matched "${sessionArg}".`, "error");
			return;
		}

		this.resumeStoredConversation(session.path);
	}

	private openResumeSelector(): void {
		const sessions = this.runtime.listStoredConversations();
		if (sessions.length === 0) {
			this.pushNotice("resume", "No stored conversations were found for this workspace.", "warning");
			return;
		}

		this.resumeSelector = {
			sessions,
			selectedIndex: 0,
		};
		this.ui.requestRender();
	}

	private handleResumeSelectorInput(data: string): void {
		const selector = this.resumeSelector;
		if (!selector) {
			return;
		}

		const keybindings = getKeybindings();
		if (keybindings.matches(data, "tui.select.up")) {
			selector.selectedIndex = Math.max(0, selector.selectedIndex - 1);
			this.ui.requestRender();
			return;
		}

		if (keybindings.matches(data, "tui.select.down")) {
			selector.selectedIndex = Math.min(selector.sessions.length - 1, selector.selectedIndex + 1);
			this.ui.requestRender();
			return;
		}

		if (keybindings.matches(data, "tui.select.confirm")) {
			const session = selector.sessions[selector.selectedIndex];
			this.resumeSelector = undefined;
			this.ui.requestRender();
			if (session) {
				this.resumeStoredConversation(session.path);
			}
			return;
		}

		if (keybindings.matches(data, "tui.select.cancel")) {
			this.resumeSelector = undefined;
			this.ui.requestRender();
		}
	}

	private resumeStoredConversation(sessionPath: string): void {
		try {
			const session = this.runtime.resumeStoredConversation(sessionPath);
			this.resetConversationView();
			this.restoreConversationTimeline();
			this.pushNotice(
				"resume",
				`Resumed conversation ${session.id.slice(0, 8)} from ${formatSessionTimestamp(session.modified)}.`,
				"success",
			);
			this.ui.requestRender();
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.pushNotice("resume", message, "error");
		}
	}

	private openOAuthSelector(mode: "login" | "logout"): void {
		if (this.oauthDialog || this.resumeSelector) {
			this.pushNotice("auth", "Finish the active OAuth flow before opening another auth command.", "warning");
			return;
		}

		const loggedInProviders = new Set(getConfiguredOAuthProviderIds());
		const providers = getAvailableOAuthProviders().filter(
			(provider) => mode === "login" || loggedInProviders.has(provider.id),
		);
		if (providers.length === 0) {
			this.pushNotice(
				mode,
				mode === "login" ? "No OAuth providers are available." : "No OAuth providers are currently logged in.",
				"warning",
			);
			return;
		}

		this.oauthSelector = { mode, providers, selectedIndex: 0 };
		this.ui.requestRender();
	}

	private handleOAuthSelectorInput(data: string): void {
		const selector = this.oauthSelector;
		if (!selector) {
			return;
		}

		const keybindings = getKeybindings();
		if (keybindings.matches(data, "tui.select.up")) {
			selector.selectedIndex = Math.max(0, selector.selectedIndex - 1);
			this.ui.requestRender();
			return;
		}

		if (keybindings.matches(data, "tui.select.down")) {
			selector.selectedIndex = Math.min(selector.providers.length - 1, selector.selectedIndex + 1);
			this.ui.requestRender();
			return;
		}

		if (keybindings.matches(data, "tui.select.confirm")) {
			const provider = selector.providers[selector.selectedIndex];
			this.oauthSelector = undefined;
			this.ui.requestRender();
			if (!provider) {
				return;
			}
			if (selector.mode === "login") {
				void this.beginOAuthLogin(provider.id);
			} else {
				this.performLogout(provider.id);
			}
			return;
		}

		if (keybindings.matches(data, "tui.select.cancel")) {
			this.oauthSelector = undefined;
			this.ui.requestRender();
		}
	}

	private createOAuthDialogState(providerId: string, providerName: string): OAuthDialogState {
		const dialog: OAuthDialogState = {
			providerId,
			providerName,
			input: new Input(),
			abortController: new AbortController(),
			progressMessages: [],
			cancelling: false,
		};

		dialog.input.useHardwareCursor = this.ui.getShowHardwareCursor();
		dialog.input.focused = this.focused;
		dialog.input.onSubmit = (value) => {
			const pendingInput = dialog.pendingInput;
			if (!pendingInput) {
				return;
			}
			dialog.pendingInput = undefined;
			dialog.promptMessage = undefined;
			dialog.promptPlaceholder = undefined;
			dialog.waitingMessage = "Waiting for authentication to complete...";
			pendingInput.resolve(value);
			this.ui.requestRender();
		};
		dialog.input.onEscape = () => {
			this.cancelOAuthDialog(dialog);
		};

		return dialog;
	}

	private requestOAuthDialogInput(dialog: OAuthDialogState, message: string, placeholder?: string): Promise<string> {
		dialog.promptMessage = message;
		dialog.promptPlaceholder = placeholder;
		dialog.waitingMessage = undefined;
		dialog.input.setValue("");
		dialog.input.focused = this.focused;
		this.ui.requestRender();

		return new Promise<string>((resolve, reject) => {
			dialog.pendingInput = { resolve, reject };
		});
	}

	private cancelOAuthDialog(dialog: OAuthDialogState): void {
		if (this.oauthDialog !== dialog || dialog.cancelling) {
			return;
		}

		dialog.cancelling = true;
		dialog.waitingMessage = "Cancelling login...";
		dialog.abortController.abort();
		if (dialog.pendingInput) {
			dialog.pendingInput.reject(new Error("Login cancelled"));
			dialog.pendingInput = undefined;
		}
		dialog.promptMessage = undefined;
		dialog.promptPlaceholder = undefined;
		this.ui.requestRender();
	}

	private handleOAuthDialogInput(data: string): void {
		const dialog = this.oauthDialog;
		if (!dialog) {
			return;
		}

		if (dialog.pendingInput) {
			dialog.input.handleInput(data);
			return;
		}

		if (getKeybindings().matches(data, "tui.select.cancel")) {
			this.cancelOAuthDialog(dialog);
		}
	}

	private appendOAuthProgress(dialog: OAuthDialogState, message: string): void {
		dialog.progressMessages = [...dialog.progressMessages, message].slice(-6);
		dialog.waitingMessage = message;
		this.ui.requestRender();
	}

	private async beginOAuthLogin(providerId: string): Promise<void> {
		const provider = getAvailableOAuthProviders().find((candidate) => candidate.id === providerId);
		if (!provider) {
			this.pushNotice("login", `Unknown OAuth provider "${providerId}".`, "error");
			return;
		}
		if (this.oauthDialog) {
			this.pushNotice("login", "An OAuth login flow is already active.", "warning");
			return;
		}

		const dialog = this.createOAuthDialogState(provider.id, provider.name);
		this.oauthDialog = dialog;
		this.ui.requestRender();

		let manualCodePromise: Promise<string> | undefined;
		try {
			await loginWithOAuthProvider(provider.id, {
				onAuth: (info) => {
					dialog.authUrl = info.url;
					dialog.instructions = info.instructions;
					dialog.waitingMessage =
						provider.usesCallbackServer || provider.id === "github-copilot"
							? "Waiting for browser authentication..."
							: undefined;
					openExternalUrl(info.url);
					if (provider.usesCallbackServer) {
						manualCodePromise ??= this.requestOAuthDialogInput(
							dialog,
							"Paste the final redirect URL below, or complete login in the browser:",
						);
					}
					this.ui.requestRender();
				},
				onPrompt: async (prompt) => {
					return this.requestOAuthDialogInput(dialog, prompt.message, prompt.placeholder);
				},
				onProgress: (message) => {
					this.appendOAuthProgress(dialog, message);
				},
				onManualCodeInput: () =>
					manualCodePromise ??
					this.requestOAuthDialogInput(
						dialog,
						"Paste the final redirect URL below, or complete login in the browser:",
					),
				signal: dialog.abortController.signal,
			});

			this.oauthDialog = undefined;
			this.ui.requestRender();
			this.pushNotice(
				"login",
				`Logged in to ${provider.name}. Credentials saved to ${getDefaultAuthPath()}.`,
				"success",
			);
		} catch (error: unknown) {
			this.oauthDialog = undefined;
			this.ui.requestRender();
			const message = error instanceof Error ? error.message : String(error);
			if (message !== "Login cancelled") {
				this.pushNotice("login", `Failed to login to ${provider.name}: ${message}`, "error");
			}
		}
	}

	private performLogout(providerId: string): void {
		const provider = getAvailableOAuthProviders().find((candidate) => candidate.id === providerId);
		const providerName = provider?.name ?? providerId;

		try {
			logoutOAuthProvider(providerId);
			const isCurrentProvider = this.runtime.model.provider === providerId;
			this.pushNotice(
				"logout",
				isCurrentProvider
					? `Logged out of ${providerName}. Credentials removed from ${getDefaultAuthPath()}. Current model still targets that provider; switch models or /login again before the next turn.`
					: `Logged out of ${providerName}. Credentials removed from ${getDefaultAuthPath()}.`,
				isCurrentProvider ? "warning" : "success",
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.pushNotice("logout", `Failed to logout of ${providerName}: ${message}`, "error");
		}
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

	private resetConversationView(): void {
		this.timeline.length = 0;
		this.toolsById.clear();
		this.currentAssistantId = undefined;
		this.runningTools = 0;
		this.planScrollOffset = 0;
		this.surfaceScrollOffset = 0;
		this.editor.setText("");
	}

	private restoreConversationTimeline(): void {
		for (const message of this.runtime.conversationMessages) {
			if (!("role" in message)) {
				continue;
			}

			if (message.role === "user") {
				this.appendTimeline({
					id: `user:${getTimelineTimestamp(message)}:${this.timeline.length}`,
					kind: "user",
					timestamp: getTimelineTimestamp(message),
					text: extractMessageText(message),
				});
				continue;
			}

			if (message.role !== "assistant") {
				continue;
			}

			const content = extractAssistantContent(message);
			this.appendTimeline({
				id: `assistant:${getTimelineTimestamp(message)}:${this.timeline.length}`,
				kind: "assistant",
				timestamp: getTimelineTimestamp(message),
				text: content.text,
				thinking: content.thinking,
				streaming: false,
				stopReason: message.stopReason,
				errorMessage: message.errorMessage,
				usage: message.usage,
				toolCalls: content.toolCalls,
			});
		}
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

	private pushStartupBanner(): void {
		this.appendTimeline({
			id: `banner:${Date.now()}:${this.timeline.length}`,
			kind: "banner",
			timestamp: Date.now(),
			lines: startupBannerLines.map((line) => styles.primary(line)),
		});
	}

	private pushStartupRecommendations(): void {
		const text = this.runtime.getStartupRecommendedActions();
		if (!text) {
			return;
		}

		this.appendTimeline({
			id: `recommended:${Date.now()}:${this.timeline.length}`,
			kind: "assistant",
			timestamp: Date.now(),
			text,
			thinking: "",
			streaming: false,
			title: "Recommended Actions",
			metaText: null,
			statusLabel: null,
			toolCalls: 0,
		});
	}

	private setStatus(text: string): void {
		void text;
	}

	private renderSnapshot(width: number): string[] {
		const sections: Array<{ title: string; lines: string[]; tone: FilledTone }> = [];
		if (this.showSurfaces) {
			sections.push({
				title: `${brandBadge("SURFACES")} ${styles.bright("priority targets")}`,
				lines: this.renderSurfaceLines(this.runtime.surfaceMap.read().surfaces),
				tone: filledTones.snapshotCard,
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
				rows.push(...renderFilledBlock(width, chunk[0]!.title, chunk[0]!.lines, chunk[0]!.tone));
			} else {
				const totalGap = gap * (chunk.length - 1);
				const availableWidth = Math.max(chunk.length, width - totalGap);
				const baseWidth = Math.floor(availableWidth / chunk.length);
				const widths = Array.from({ length: chunk.length }, (_, columnIndex) =>
					columnIndex === chunk.length - 1 ? availableWidth - baseWidth * (chunk.length - 1) : baseWidth,
				);
				const columns = chunk.map((section, columnIndex) =>
					renderFilledBlock(widths[columnIndex]!, section.title, section.lines, section.tone),
				);
				const blankLines = chunk.map((section, columnIndex) =>
					renderFilledLine("", widths[columnIndex]!, 1, section.tone.fg, section.tone.bg),
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

	private renderPlanPanel(width: number): string[] {
		const plan = this.runtime.planState.current;
		if (!plan || plan.phases.length === 0) {
			return [];
		}

		const maxOffset = Math.max(0, plan.phases.length - planPanelVisibleLimit);
		const offset = Math.max(0, Math.min(this.planScrollOffset, maxOffset));
		if (offset !== this.planScrollOffset) {
			this.planScrollOffset = offset;
		}

		const visiblePhases = plan.phases.slice(offset, offset + planPanelVisibleLimit);
		const animationFrame = Math.floor(Date.now() / planAnimationIntervalMs);
		const lines: string[] = [];
		for (const phase of visiblePhases) {
			const animateParallelSteps = phase.parallelSteps && phase.status === "in_progress";
			const normalizedSteps = phase.steps.map((step) => ({
				text: stripPlanCompletionMarker(step.text),
				status: step.status,
			}));
			const phaseComplete = phase.status === "completed";
			const phaseMarker = phaseComplete ? styles.green("■") : styles.subtle("■");
			const phaseLabel =
				phase.status === "in_progress"
					? renderAnimatedGradientText(phase.name, animationFrame, phaseGradientStops, true)
					: styles.bright(phase.name);
			lines.push(
				phase.parallelSteps
					? `${phaseMarker} ${phaseLabel} ${styles.dim("[parallel]")}`
					: `${phaseMarker} ${phaseLabel}`,
			);
			for (const step of normalizedSteps) {
				const stepMarker = step.status === "completed" ? styles.green("■") : styles.subtle("■");
				const stepPrefix = `  ${stepMarker} `;
				const stepIndent = "    ";
				const stepText = step.text.length > 0 ? step.text : "Untitled step";
				const wrappedSteps = wrapTextWithAnsi(stepText, Math.max(1, width - visibleWidth(stepPrefix)));
				if (wrappedSteps.length === 0) {
					continue;
				}
				const animateStep = step.status === "in_progress" || (animateParallelSteps && step.status !== "completed");
				let charOffset = 0;
				for (const [stepIndex, wrappedStep] of wrappedSteps.entries()) {
					const renderedStep = animateStep
						? renderAnimatedGradientText(wrappedStep, animationFrame + charOffset, stepGradientStops)
						: styles.subtle(wrappedStep);
					lines.push(stepIndex === 0 ? `${stepPrefix}${renderedStep}` : `${stepIndent}${renderedStep}`);
					charOffset += Array.from(wrappedStep).length;
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

	private hasAnimatedPlan(): boolean {
		const plan = this.runtime.planState.current;
		return !!plan?.phases.some(
			(phase) => phase.status === "in_progress" || phase.steps.some((step) => step.status === "in_progress"),
		);
	}

	private syncPlanAnimation(): void {
		if (this.hasAnimatedPlan()) {
			this.startPlanAnimation();
			return;
		}
		this.stopPlanAnimation();
	}

	private startPlanAnimation(): void {
		if (this.planAnimationTimer) {
			return;
		}
		this.planAnimationTimer = setInterval(() => {
			this.ui.requestRender();
		}, planAnimationIntervalMs);
	}

	private stopPlanAnimation(): void {
		if (!this.planAnimationTimer) {
			return;
		}
		clearInterval(this.planAnimationTimer);
		this.planAnimationTimer = undefined;
	}

	private renderTimeline(width: number): string[] {
		const contentWidth = Math.max(1, width - 2);
		if (this.timeline.length === 0) {
			return padBlockLines(
				renderRailBlock(
					contentWidth,
					styles.bright("no activity yet"),
					[styles.dim("Submit a prompt to begin.")],
					tones.notice,
				),
				width,
			);
		}

		const cards = this.timeline
			.map((entry) => this.renderTimelineEntry(entry, contentWidth))
			.filter((card) => card.length > 0);
		const lines: string[] = [];
		for (const card of cards) {
			if (lines[lines.length - 1] !== "") {
				lines.push("");
			}
			lines.push(...card);
		}
		return padBlockLines(lines, width);
	}

	private renderTimelineEntry(entry: TimelineEntry, width: number): string[] {
		switch (entry.kind) {
			case "banner":
				return this.renderBannerEntry(entry, width);
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

	private renderBannerEntry(entry: BannerTimelineEntry, width: number): string[] {
		void width;
		return entry.lines;
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
		const bodyWidth = Math.max(1, width - 2);
		const responseUsage = formatUsageMetrics(entry.usage);
		const responseMetaText = `response @ ${formatClock(entry.timestamp)}${responseUsage ? ` | ${responseUsage}` : ""}`;
		const thoughtMetaText = `thought @ ${formatClock(entry.timestamp)}${responseUsage ? ` | ${responseUsage}` : ""}`;
		const stateLabel = entry.streaming
			? "streaming"
			: entry.stopReason === "error" || entry.stopReason === "aborted"
				? entry.stopReason
				: "complete";
		const blocks: string[] = [];
		const defaultMetaText = entry.metaText ?? responseMetaText;
		const useMetaHeader = entry.title === undefined && entry.metaText !== null;
		const usePlainResponse = entry.title === undefined && entry.metaText !== null;
		const responseLabel = useMetaHeader
			? responseTone.meta(defaultMetaText)
			: responseTone.title(entry.title ?? "AGENT response");
		const responseTitle = usePlainResponse
			? renderAlignedLine("", responseTone.meta(defaultMetaText), width)
			: entry.statusLabel === null
				? fitLine(responseLabel, usePlainResponse ? width : bodyWidth)
				: renderAlignedLine(
						responseLabel,
						responseTone.status(entry.statusLabel ?? stateLabel),
						usePlainResponse ? width : bodyWidth,
					);
		const responseLines: string[] = [];
		if (entry.metaText !== null && !useMetaHeader) {
			responseLines.push(responseTone.meta(defaultMetaText));
		}

		if (entry.text.trim().length > 0) {
			if (responseLines.length > 0) {
				responseLines.push("");
			}
			responseLines.push(
				...renderMarkdownLines(entry.text, bodyWidth, responseTone.body, {
					color: responseTone.body,
				}),
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
			const thinkingLines = limitLines(
				renderMarkdownLines(entry.thinking, bodyWidth, filledTones.thinkingCard.body, {
					color: filledTones.thinkingCard.body,
				}),
				entry.streaming ? 10 : 6,
				filledTones.thinkingCard.meta("... thinking truncated"),
			);
			const thinkingTitle = renderAlignedLine(
				styles.bgBadge("THOUGHT", 231, 245),
				filledTones.thinkingCard.meta(thoughtMetaText),
				bodyWidth,
			);
			blocks.push(...renderCompactFilledBlock(width, thinkingTitle, thinkingLines, filledTones.thinkingCard));
		}

		if (
			entry.text.trim().length > 0 ||
			(entry.streaming && entry.thinking.trim().length === 0) ||
			entry.stopReason === "error" ||
			entry.stopReason === "aborted"
		) {
			if (blocks.length > 0) {
				blocks.push("");
			}
			if (usePlainResponse) {
				blocks.push(responseTitle);
				if (responseLines.length > 0) {
					blocks.push(...padBlockLines(responseLines, width));
				}
			} else {
				blocks.push(...renderFilledBlock(width, responseTitle, responseLines, responseTone));
			}
		}

		return blocks;
	}

	private renderToolEntry(entry: ToolTimelineEntry, width: number): string[] {
		const tone =
			entry.status === "running"
				? filledTones.toolPending
				: entry.status === "error"
					? filledTones.toolError
					: filledTones.toolSuccess;
		const statusBadge =
			entry.status === "running"
				? styles.bgBadge("RUNNING", 232, 208)
				: entry.status === "error"
					? styles.bgBadge("ERROR", 231, 160)
					: styles.bgBadge("OK", 232, 114);
		const bodyWidth = Math.max(1, width - 2);
		const title = renderAlignedLine(
			styles.bgBadge(entry.toolName.toUpperCase(), 231, 24),
			`${tone.meta(`tool @ ${formatClock(entry.timestamp)}`)} ${styles.dim("|")} ${statusBadge}`,
			bodyWidth,
		);
		const summarizedArgs = summarizeToolArgs(entry.toolName, entry.args);
		const lines: string[] = [
			styles.bright(summarizedArgs),
			...formatToolOutputSummary(entry.toolName, entry.details, entry.status === "error"),
		];

		if (shouldShowToolPreview(entry)) {
			lines.push("");
			lines.push(...previewContentText(entry.output, bodyWidth, 8).map((line) => tone.body(line)));
		}

		return renderCompactFilledBlock(width, title, lines, tone);
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

	private renderActiveInputSection(width: number): string[] {
		if (this.oauthDialog) {
			return this.renderOAuthDialog(width);
		}
		if (this.oauthSelector) {
			return this.renderOAuthSelector(width);
		}
		if (this.resumeSelector) {
			return this.renderResumeSelector(width);
		}
		return this.renderComposer(width);
	}

	private renderAppFooter(): string {
		const workspaceLabel = forceTildeHome(formatFooterWorkspacePath(this.runtime.workspaceRoot));
		const modelLabel = `${this.runtime.state.model.id} ${this.runtime.state.thinkingLevel}`;
		return styles.dim(` ${modelLabel} • ${workspaceLabel} • ${keyHint("app.exit")} exit`);
	}

	private renderComposer(width: number): string[] {
		const inputWidth = Math.max(1, width - composerSurface.paddingX * 2);
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
		return [
			renderFilledLine("", width, composerSurface.paddingX),
			...(editorLines.length > 0 ? editorLines : [""]).map((line) =>
				renderFilledLine(line, width, composerSurface.paddingX),
			),
			renderFilledLine("", width, composerSurface.paddingX),
			this.renderAppFooter(),
		];
	}

	private renderOAuthSelector(width: number): string[] {
		const selector = this.oauthSelector;
		if (!selector) {
			return this.renderComposer(width);
		}

		const loggedInProviders = new Set(getConfiguredOAuthProviderIds());
		const lines =
			selector.providers.length > 0
				? selector.providers.map((provider, index) => {
						const prefix = index === selector.selectedIndex ? styles.primary("> ") : "  ";
						const name =
							index === selector.selectedIndex ? styles.bright(provider.name) : styles.text(provider.name);
						const providerId = styles.dim(`(${provider.id})`);
						const status = loggedInProviders.has(provider.id) ? ` ${styles.green("logged in")}` : "";
						return `${prefix}${name} ${providerId}${status}`;
					})
				: [
						selector.mode === "login"
							? styles.dim("no OAuth providers available")
							: styles.dim("no OAuth providers are currently logged in"),
					];

		lines.push("");
		lines.push(
			styles.dim(
				`${keyHint("tui.select.up")}/${keyHint("tui.select.down")} move • ${keyHint("tui.select.confirm")} select • ${keyHint("tui.select.cancel")} cancel`,
			),
		);

		return [
			...renderFilledBlock(
				width,
				`${brandBadge(selector.mode === "login" ? "LOGIN" : "LOGOUT")} ${styles.bright("select provider")}`,
				lines,
				filledTones.snapshotCard,
			),
			this.renderAppFooter(),
		];
	}

	private renderOAuthDialog(width: number): string[] {
		const dialog = this.oauthDialog;
		if (!dialog) {
			return this.renderComposer(width);
		}

		const bodyWidth = Math.max(1, width - composerSurface.paddingX * 2);
		const lines: string[] = [styles.dim(`provider ${dialog.providerId}`)];

		if (dialog.authUrl) {
			lines.push("");
			lines.push(styles.cyan(dialog.authUrl));
			lines.push(styles.dim("If your browser did not open automatically, copy this URL manually."));
		}
		if (dialog.instructions) {
			lines.push("");
			lines.push(styles.amber(dialog.instructions));
		}
		if (dialog.promptMessage) {
			lines.push("");
			lines.push(styles.text(dialog.promptMessage));
			if (dialog.promptPlaceholder) {
				lines.push(styles.dim(`e.g. ${dialog.promptPlaceholder}`));
			}
			lines.push(...dialog.input.render(bodyWidth));
		} else if (dialog.waitingMessage) {
			lines.push("");
			lines.push(styles.dim(dialog.waitingMessage));
		}
		if (dialog.progressMessages.length > 0) {
			lines.push("");
			lines.push(styles.subtle("progress"));
			lines.push(...dialog.progressMessages.map((message) => styles.dim(message)));
		}
		lines.push("");
		lines.push(styles.dim(`${keyHint("tui.select.cancel")} cancel`));

		return [
			...renderFilledBlock(
				width,
				`${brandBadge("LOGIN")} ${styles.bright(dialog.providerName)}`,
				lines,
				filledTones.snapshotCard,
			),
			this.renderAppFooter(),
		];
	}

	private renderResumeSelector(width: number): string[] {
		const selector = this.resumeSelector;
		if (!selector) {
			return this.renderComposer(width);
		}

		const maxOffset = Math.max(0, selector.sessions.length - resumePanelVisibleLimit);
		const offset = Math.max(0, Math.min(selector.selectedIndex - Math.floor(resumePanelVisibleLimit / 2), maxOffset));
		const visibleSessions = selector.sessions.slice(offset, offset + resumePanelVisibleLimit);
		const lines = visibleSessions.flatMap((session, index) => {
			const sessionIndex = offset + index;
			const prefix = sessionIndex === selector.selectedIndex ? styles.primary("> ") : "  ";
			const title =
				sessionIndex === selector.selectedIndex
					? styles.bright(compactText(session.name ?? session.firstMessage, 72))
					: styles.text(compactText(session.name ?? session.firstMessage, 72));
			const meta = styles.dim(
				`${session.id.slice(0, 8)} • ${formatSessionTimestamp(session.modified)} • ${session.messageCount} msg`,
			);
			return [`${prefix}${title}`, `  ${meta}`];
		});

		if (selector.sessions.length > resumePanelVisibleLimit) {
			lines.push(
				styles.dim(
					`${offset + 1}-${offset + visibleSessions.length} of ${selector.sessions.length} | ${keyHint("tui.select.up")}/${keyHint("tui.select.down")}`,
				),
			);
		}
		lines.push("");
		lines.push(
			styles.dim(
				`${keyHint("tui.select.up")}/${keyHint("tui.select.down")} move • ${keyHint("tui.select.confirm")} select • ${keyHint("tui.select.cancel")} cancel`,
			),
		);

		return [
			...renderFilledBlock(
				width,
				`${brandBadge("RESUME")} ${styles.bright("stored conversations")}`,
				lines,
				filledTones.snapshotCard,
			),
			this.renderAppFooter(),
		];
	}

	private hasPlan(): boolean {
		const plan = this.runtime.planState.current;
		return !!plan && plan.phases.length > 0;
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
	ui.setShowHardwareCursor(true);
	const app = new SecurityConsoleApp(runtime, ui);

	ui.addChild(app);
	ui.setFocus(app);
	ui.terminal.setTitle("pire // security agent");
	ui.start();

	try {
		await app.waitForExit();
	} finally {
		app.dispose();
		ui.stop();
	}
}
