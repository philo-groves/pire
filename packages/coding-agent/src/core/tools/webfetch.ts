import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Text } from "@mariozechner/pi-tui";
import { type Static, Type } from "@sinclair/typebox";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.js";
import { getTextOutput, invalidArgText, replaceTabs, str } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult, truncateHead } from "./truncate.js";

const DEFAULT_WEBFETCH_TIMEOUT_SECONDS = 20;

const webfetchSchema = Type.Object({
	url: Type.String({ description: "HTTP or HTTPS URL to fetch" }),
	method: Type.Optional(
		Type.Union([Type.Literal("GET"), Type.Literal("HEAD")], {
			description: "HTTP method to use. Defaults to GET.",
		}),
	),
	timeout: Type.Optional(
		Type.Number({
			description: `Timeout in seconds. Defaults to ${DEFAULT_WEBFETCH_TIMEOUT_SECONDS}.`,
		}),
	),
});

export type WebfetchToolInput = Static<typeof webfetchSchema>;

export interface WebfetchToolDetails {
	status: number;
	statusText: string;
	finalUrl: string;
	contentType: string | null;
	truncation?: TruncationResult;
}

export interface WebfetchResponse {
	url: string;
	status: number;
	statusText: string;
	headers: Iterable<[string, string]>;
	text(): Promise<string>;
}

export interface WebfetchOperations {
	fetch: (url: string, init: { method: "GET" | "HEAD"; signal?: AbortSignal }) => Promise<WebfetchResponse>;
}

const defaultWebfetchOperations: WebfetchOperations = {
	fetch: async (url, init) => {
		const response = await fetch(url, init);
		return {
			url: response.url,
			status: response.status,
			statusText: response.statusText,
			headers: response.headers.entries(),
			text: () => response.text(),
		};
	},
};

export interface WebfetchToolOptions {
	operations?: WebfetchOperations;
}

function normalizeMethod(method: "GET" | "HEAD" | undefined): "GET" | "HEAD" {
	return method ?? "GET";
}

function assertSupportedUrl(rawUrl: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new Error(`Invalid URL: ${rawUrl}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`webfetch only supports http:// and https:// URLs: ${rawUrl}`);
	}
	return parsed;
}

function isTextualContentType(contentType: string | null): boolean {
	if (!contentType) {
		return true;
	}
	const normalized = contentType.toLowerCase();
	return (
		normalized.startsWith("text/") ||
		normalized.includes("json") ||
		normalized.includes("xml") ||
		normalized.includes("javascript") ||
		normalized.includes("svg") ||
		normalized.includes("x-www-form-urlencoded")
	);
}

function formatHeaderBlock(headers: Iterable<[string, string]>): string {
	return Array.from(headers, ([key, value]) => `${key}: ${value}`).join("\n");
}

function formatWebfetchCall(
	args: { url?: string; method?: "GET" | "HEAD"; timeout?: number } | undefined,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
): string {
	const rawUrl = str(args?.url);
	const method = normalizeMethod(args?.method);
	const timeout = args?.timeout;
	const urlDisplay =
		rawUrl === null ? invalidArgText(theme) : rawUrl ? theme.fg("accent", rawUrl) : theme.fg("toolOutput", "...");
	let text = `${theme.fg("toolTitle", theme.bold("webfetch"))} ${theme.fg("toolOutput", method)} ${urlDisplay}`;
	if (timeout !== undefined) {
		text += theme.fg("muted", ` (${timeout}s)`);
	}
	return text;
}

function formatWebfetchResult(
	result: { content: Array<{ type: string; text?: string }>; details?: WebfetchToolDetails },
	options: ToolRenderResultOptions,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
): string {
	const output = getTextOutput(result, false);
	const lines = output.split("\n");
	const maxLines = options.expanded ? lines.length : 12;
	const displayLines = lines.slice(0, maxLines);
	const remaining = lines.length - maxLines;
	let text = `\n${displayLines.map((line) => theme.fg("toolOutput", replaceTabs(line))).join("\n")}`;
	if (remaining > 0) {
		text += `\n${theme.fg("muted", `... (${remaining} more lines)`)}`;
	}

	const truncation = result.details?.truncation;
	if (truncation?.truncated) {
		if (truncation.truncatedBy === "lines") {
			text += `\n${theme.fg("warning", `[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines]`)}`;
		} else {
			text += `\n${theme.fg("warning", `[Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)]`)}`;
		}
	}
	return text;
}

export function createWebfetchToolDefinition(
	_options?: WebfetchToolOptions,
): ToolDefinition<typeof webfetchSchema, WebfetchToolDetails | undefined> {
	const ops = _options?.operations ?? defaultWebfetchOperations;
	return {
		name: "webfetch",
		label: "webfetch",
		description: `Fetch an HTTP/HTTPS page directly without spawning python, curl, or wget. Returns response status, headers, and textual body content. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
		promptSnippet: "Fetch HTTP/HTTPS pages directly",
		promptGuidelines: ["Use webfetch for HTTP/HTTPS page retrieval instead of python, curl, or wget."],
		parameters: webfetchSchema,
		async execute(
			_toolCallId,
			{
				url,
				method,
				timeout,
			}: {
				url: string;
				method?: "GET" | "HEAD";
				timeout?: number;
			},
			signal?: AbortSignal,
		) {
			const parsedUrl = assertSupportedUrl(url);
			const resolvedMethod = normalizeMethod(method);
			const timeoutSeconds = timeout ?? DEFAULT_WEBFETCH_TIMEOUT_SECONDS;
			const timeoutController = new AbortController();
			const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutSeconds * 1000);
			const abortController = new AbortController();
			const forwardAbort = () => abortController.abort();
			try {
				signal?.addEventListener("abort", forwardAbort, { once: true });
				timeoutController.signal.addEventListener("abort", forwardAbort, { once: true });
				const response = await ops.fetch(parsedUrl.toString(), {
					method: resolvedMethod,
					signal: abortController.signal,
				});
				const contentType =
					Array.from(response.headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] ?? null;
				const headerBlock = formatHeaderBlock(response.headers);
				let bodyText = "";
				if (resolvedMethod !== "HEAD") {
					if (isTextualContentType(contentType)) {
						bodyText = await response.text();
					} else {
						bodyText = `[Body omitted for non-text content type: ${contentType ?? "unknown"}]`;
					}
				}
				const sections = [
					`URL: ${response.url || parsedUrl.toString()}`,
					`Status: ${response.status} ${response.statusText}`,
					contentType ? `Content-Type: ${contentType}` : undefined,
					headerBlock ? `Headers:\n${headerBlock}` : "Headers: (none)",
					resolvedMethod === "HEAD" ? "Body: (HEAD request, no body fetched)" : `Body:\n${bodyText}`,
				].filter((section): section is string => section !== undefined);
				const combined = sections.join("\n\n");
				const truncation = truncateHead(combined);
				let outputText = truncation.content;
				if (truncation.truncated) {
					if (truncation.truncatedBy === "lines") {
						outputText += `\n\n[Showing first ${truncation.outputLines} of ${truncation.totalLines} lines.]`;
					} else {
						outputText += `\n\n[Showing first ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(DEFAULT_MAX_BYTES)} limit).]`;
					}
				}
				return {
					content: [{ type: "text", text: outputText }],
					details: {
						status: response.status,
						statusText: response.statusText,
						finalUrl: response.url || parsedUrl.toString(),
						contentType,
						truncation: truncation.truncated ? truncation : undefined,
					},
				};
			} catch (error) {
				if (abortController.signal.aborted) {
					if (signal?.aborted) {
						throw new Error("Operation aborted");
					}
					throw new Error(`webfetch timed out after ${timeoutSeconds} seconds`);
				}
				throw error;
			} finally {
				clearTimeout(timeoutHandle);
				signal?.removeEventListener("abort", forwardAbort);
			}
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatWebfetchCall(args, theme));
			return text;
		},
		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatWebfetchResult(result as any, options, theme));
			return text;
		},
	};
}

export function createWebfetchTool(options?: WebfetchToolOptions): AgentTool<typeof webfetchSchema> {
	return wrapToolDefinition(createWebfetchToolDefinition(options));
}

export const webfetchToolDefinition = createWebfetchToolDefinition();
export const webfetchTool = createWebfetchTool();
