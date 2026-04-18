import { URL } from "node:url";
import type { WorkspaceGraphEdgeInput, WorkspaceGraphNodeInput, WorkspaceGraphSeed } from "./store.js";

interface TextSource {
	text: string;
	source: string;
}

const AUTH_KEYWORDS = [
	"auth",
	"login",
	"session",
	"token",
	"cookie",
	"oauth",
	"jwt",
	"password",
	"reset",
	"mfa",
	"sso",
];
const UPLOAD_KEYWORDS = ["upload", "multipart", "file", "attachment", "import", "export", "avatar", "document"];
const BROWSER_KEYWORDS = [
	"browser",
	"webview",
	"dom",
	"javascript",
	"script",
	"xss",
	"postmessage",
	"origin",
	"iframe",
	"service worker",
	"csp",
];
const IPC_KEYWORDS = ["ipc", "xpc", "mach", "dbus", "message", "socket", "pipe", "rpc", "websocket", "grpc"];
const ROUTE_REGEX = /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+([/~A-Za-z0-9._:@?&=%+-]+)/g;
const URL_REGEX = /\bhttps?:\/\/[^\s"'`)<>\]]+/g;
const PATH_REGEX = /(^|\s)(\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{3,})/g;

function uniqueKey(id: string, seen: Set<string>): boolean {
	if (seen.has(id)) {
		return false;
	}
	seen.add(id);
	return true;
}

function normalizePath(value: string): string {
	if (value.length === 0) {
		return "/";
	}
	return value.endsWith("/") && value.length > 1 ? value.slice(0, -1) : value;
}

function buildSnippet(lines: string[], match: string): string {
	const lowerMatch = match.toLowerCase();
	const line = lines.find((candidate) => candidate.toLowerCase().includes(lowerMatch)) ?? match;
	return line.trim().slice(0, 240);
}

function detectPriorKinds(text: string): string[] {
	const lower = text.toLowerCase();
	const kinds: string[] = [];
	if (AUTH_KEYWORDS.some((keyword) => lower.includes(keyword))) {
		kinds.push("auth_flow");
	}
	if (UPLOAD_KEYWORDS.some((keyword) => lower.includes(keyword))) {
		kinds.push("upload_flow");
	}
	if (BROWSER_KEYWORDS.some((keyword) => lower.includes(keyword))) {
		kinds.push("browser_boundary");
	}
	if (IPC_KEYWORDS.some((keyword) => lower.includes(keyword))) {
		kinds.push("ipc_boundary");
	}
	return kinds;
}

function buildKindNode(kind: string, source: string, context: string): WorkspaceGraphNodeInput {
	const score = kind === "auth_flow" || kind === "upload_flow" ? 4 : 3;
	return {
		id: `prior:${kind}:${source}`,
		kind,
		label: `${kind.replace("_", " ")} from ${source}`,
		score,
		status: score >= 4 ? "hot" : "candidate",
		summary: context,
		text: context,
		tags: [kind, source],
		source: "live_target_prior",
	};
}

function buildEndpointNode(
	id: string,
	label: string,
	snippet: string,
	tags: string[],
	source: string,
): WorkspaceGraphNodeInput {
	const hasAuth = tags.includes("auth_flow");
	const hasUpload = tags.includes("upload_flow");
	const score = hasAuth || hasUpload ? 4 : 3;
	return {
		id,
		kind: "endpoint",
		label,
		score,
		status: score >= 4 ? "hot" : "candidate",
		summary: snippet,
		text: snippet,
		tags: ["endpoint", source, ...tags],
		path: label,
		source: "live_target_prior",
	};
}

function extractFromUrl(urlText: string): { id: string; label: string; tags: string[] } | null {
	try {
		const parsed = new URL(urlText);
		const label = `${parsed.origin}${normalizePath(parsed.pathname)}`;
		const tags = detectPriorKinds(`${parsed.pathname} ${parsed.search}`);
		return {
			id: `endpoint:${label}`,
			label,
			tags,
		};
	} catch {
		return null;
	}
}

function extractFromPath(pathText: string): { id: string; label: string; tags: string[] } {
	const label = normalizePath(pathText);
	const tags = detectPriorKinds(label);
	return {
		id: `route:${label}`,
		label,
		tags,
	};
}

export function buildLiveTargetPriorSeed(sources: TextSource[]): WorkspaceGraphSeed {
	const nodes: WorkspaceGraphNodeInput[] = [];
	const edges: WorkspaceGraphEdgeInput[] = [];
	const seenNodes = new Set<string>();
	const seenEdges = new Set<string>();

	for (const source of sources) {
		if (!source.text.trim()) {
			continue;
		}
		const lines = source.text.split("\n");
		const sourceKinds = detectPriorKinds(source.text);
		for (const kind of sourceKinds) {
			const node = buildKindNode(kind, source.source, buildSnippet(lines, kind.replace("_", " ")));
			if (uniqueKey(node.id, seenNodes)) {
				nodes.push(node);
			}
		}

		for (const match of source.text.match(URL_REGEX) ?? []) {
			const endpoint = extractFromUrl(match);
			if (!endpoint) {
				continue;
			}
			if (uniqueKey(endpoint.id, seenNodes)) {
				nodes.push(
					buildEndpointNode(endpoint.id, endpoint.label, buildSnippet(lines, match), endpoint.tags, source.source),
				);
			}
			for (const tag of endpoint.tags) {
				const priorId = `prior:${tag}:${source.source}`;
				const edgeId = `${priorId}->${endpoint.id}:prior_for`;
				if (!seenEdges.has(edgeId)) {
					seenEdges.add(edgeId);
					edges.push({ from: priorId, to: endpoint.id, relation: "prior_for", weight: 1 });
				}
			}
		}

		for (const routeMatch of source.text.matchAll(ROUTE_REGEX)) {
			if (!routeMatch[2].startsWith("/")) {
				continue;
			}
			const route = extractFromPath(routeMatch[2]);
			if (uniqueKey(route.id, seenNodes)) {
				nodes.push(
					buildEndpointNode(route.id, route.label, buildSnippet(lines, routeMatch[0]), route.tags, source.source),
				);
			}
			for (const tag of route.tags) {
				const priorId = `prior:${tag}:${source.source}`;
				const edgeId = `${priorId}->${route.id}:prior_for`;
				if (!seenEdges.has(edgeId)) {
					seenEdges.add(edgeId);
					edges.push({ from: priorId, to: route.id, relation: "prior_for", weight: 1 });
				}
			}
		}

		for (const pathMatch of source.text.matchAll(PATH_REGEX)) {
			const rawPath = pathMatch[2];
			if (rawPath.startsWith("//")) {
				continue;
			}
			const route = extractFromPath(rawPath);
			if (route.tags.length === 0) {
				continue;
			}
			if (uniqueKey(route.id, seenNodes)) {
				nodes.push(
					buildEndpointNode(route.id, route.label, buildSnippet(lines, rawPath), route.tags, source.source),
				);
			}
		}
	}

	return { nodes, edges };
}

export function buildHttpObservationSeed(input: {
	url: string;
	method: string;
	requestHeaders?: Record<string, string>;
	responseHeaders?: Record<string, string>;
	body?: string;
}): WorkspaceGraphSeed {
	const parts = [
		input.url,
		input.method,
		...Object.values(input.requestHeaders ?? {}),
		...Object.values(input.responseHeaders ?? {}),
		input.body ?? "",
	];
	return buildLiveTargetPriorSeed([{ text: parts.join("\n"), source: "http_observation" }]);
}
