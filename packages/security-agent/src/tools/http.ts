import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@mariozechner/pi-ai";
import { buildHttpObservationSeed } from "../workspace-graph/live-priors.js";
import type { WorkspaceGraphStore } from "../workspace-graph/store.js";

const DEFAULT_MAX_RESPONSE_BYTES = 100 * 1024;

export interface HttpToolDetails {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: string;
	contentType: string;
	truncated: boolean;
	timingMs: number;
}

const httpToolSchema = Type.Object({
	method: Type.Union(
		[
			Type.Literal("GET"),
			Type.Literal("POST"),
			Type.Literal("PUT"),
			Type.Literal("DELETE"),
			Type.Literal("PATCH"),
			Type.Literal("HEAD"),
			Type.Literal("OPTIONS"),
		],
		{ description: "HTTP method" },
	),
	url: Type.String({ description: "Full target URL" }),
	headers: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Request headers" })),
	body: Type.Optional(Type.String({ description: "Request body" })),
	content_type: Type.Optional(Type.String({ description: "Content-Type shortcut header" })),
	follow_redirects: Type.Optional(Type.Boolean({ description: "Follow redirects; default true" })),
	timeout_ms: Type.Optional(Type.Number({ description: "Request timeout in milliseconds" })),
	max_response_bytes: Type.Optional(Type.Number({ description: "Maximum response body bytes to keep" })),
});

type HttpToolParams = Static<typeof httpToolSchema>;

function truncateText(text: string, maxBytes: number): { body: string; truncated: boolean } {
	if (Buffer.byteLength(text, "utf-8") <= maxBytes) {
		return { body: text, truncated: false };
	}

	const head = text.slice(0, 5000);
	const tail = text.slice(-2000);
	return {
		body: `${head}\n\n[... truncated ...]\n\n${tail}`,
		truncated: true,
	};
}

export function createHttpTool(
	workspaceGraph?: WorkspaceGraphStore,
): AgentTool<typeof httpToolSchema, HttpToolDetails> {
	return {
		name: "http",
		label: "HTTP Request",
		description:
			"Make a structured HTTP request for recon, exploitation, or validation. Returns status, headers, timing, and a truncated body.",
		parameters: httpToolSchema,
		async execute(_toolCallId: string, params: HttpToolParams) {
			const requestHeaders: Record<string, string> = { ...(params.headers ?? {}) };
			if (params.content_type && !requestHeaders["Content-Type"] && !requestHeaders["content-type"]) {
				requestHeaders["Content-Type"] = params.content_type;
			}

			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), params.timeout_ms ?? 30000);
			try {
				const startedAt = Date.now();
				const response = await fetch(params.url, {
					method: params.method,
					headers: requestHeaders,
					body: params.body,
					redirect: params.follow_redirects === false ? "manual" : "follow",
					signal: controller.signal,
				});
				const timingMs = Date.now() - startedAt;

				const headers: Record<string, string> = {};
				response.headers.forEach((value, key) => {
					headers[key] = value;
				});

				const contentType = response.headers.get("content-type") ?? "";
				const isBinary =
					contentType.startsWith("image/") ||
					contentType.startsWith("audio/") ||
					contentType.startsWith("video/") ||
					contentType.includes("octet-stream") ||
					contentType.includes("font");

				let body: string;
				let truncated = false;
				if (isBinary) {
					const buffer = await response.arrayBuffer();
					body = `[binary content, ${buffer.byteLength} bytes, ${contentType || "unknown content-type"}]`;
				} else {
					const text = await response.text();
					const truncatedText = truncateText(text, params.max_response_bytes ?? DEFAULT_MAX_RESPONSE_BYTES);
					body = truncatedText.body;
					truncated = truncatedText.truncated;
				}

				const headerLines =
					Object.keys(headers).length === 0
						? "  (none)"
						: Object.entries(headers)
								.map(([key, value]) => `  ${key}: ${value}`)
								.join("\n");

				if (workspaceGraph) {
					const observationSeed = buildHttpObservationSeed({
						url: params.url,
						method: params.method,
						requestHeaders,
						responseHeaders: headers,
						body,
					});
					if (observationSeed.nodes.length > 0 || (observationSeed.edges?.length ?? 0) > 0) {
						await workspaceGraph.mergeSeed(observationSeed);
					}
				}

				return {
					content: [
						{
							type: "text",
							text: [
								`HTTP ${response.status} ${response.statusText} (${timingMs}ms)`,
								`Headers:\n${headerLines}`,
								truncated ? "Body (truncated):" : "Body:",
								body,
							].join("\n"),
						},
					],
					details: {
						status: response.status,
						statusText: response.statusText,
						headers,
						body,
						contentType,
						truncated,
						timingMs,
					},
				};
			} finally {
				clearTimeout(timeout);
			}
		},
	};
}
