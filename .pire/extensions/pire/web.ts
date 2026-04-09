import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface WebArtifactObservation {
	path: string;
	type?: "json" | "log" | "text" | "other";
	command?: string;
	finding?: string;
}

export interface WebToolDetails {
	tool: string;
	target: string;
	command: string[];
	commandString: string;
	summary: string;
	artifacts: WebArtifactObservation[];
}

interface CdpVersionResponse {
	Browser?: string;
	"Protocol-Version"?: string;
	webSocketDebuggerUrl?: string;
	[key: string]: unknown;
}

interface CdpTargetInfo {
	id?: string;
	type?: string;
	title?: string;
	url?: string;
	webSocketDebuggerUrl?: string;
	attached?: boolean;
	[key: string]: unknown;
}

interface CdpCommandEnvelope {
	id: number;
	method: string;
	params?: Record<string, unknown>;
}

interface CdpResultEnvelope {
	id?: number;
	result?: Record<string, unknown>;
	error?: {
		code?: number;
		message?: string;
		data?: unknown;
	};
	method?: string;
	params?: Record<string, unknown>;
}

interface CdpCommandResult {
	result: Record<string, unknown>;
	transcript: CdpResultEnvelope[];
}

export interface WebCdpDiscoverOptions {
	includeTargets: boolean;
	targetType?: string;
	maxTargets: number;
}

export interface WebCdpRuntimeEvalOptions {
	targetId?: string;
	targetType?: string;
	targetUrlContains?: string;
	expression: string;
	awaitPromise: boolean;
	returnByValue: boolean;
	includeCommandLineApi: boolean;
	throwOnSideEffect: boolean;
	timeoutMs: number;
}

const PREVIEW_CHAR_LIMIT = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function quoteShellArg(value: string): string {
	if (/^[A-Za-z0-9_./:@?&=%:+,-]+$/.test(value)) {
		return value;
	}
	return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function commandToString(command: string, args: string[]): string {
	return [command, ...args].map((value) => quoteShellArg(value)).join(" ");
}

function truncatePreview(text: string): string {
	const normalized = text.trim();
	if (normalized.length <= PREVIEW_CHAR_LIMIT) {
		return normalized;
	}
	return `${normalized.slice(0, PREVIEW_CHAR_LIMIT)}\n...`;
}

function slugify(value: string): string {
	const slug = value
		.toLowerCase()
		.replace(/^[a-z]+:\/\//, "")
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug.length > 0 ? slug.slice(0, 80) : "browser";
}

function normalizeHttpEndpoint(endpoint: string): URL {
	const raw = endpoint.trim();
	const parsed = new URL(raw.includes("://") ? raw : `http://${raw}`);
	const base = new URL(parsed.origin);
	if (parsed.protocol === "ws:") {
		base.protocol = "http:";
	}
	if (parsed.protocol === "wss:") {
		base.protocol = "https:";
	}
	return base;
}

function buildCdpJsonUrl(endpoint: string, path: string): string {
	return new URL(path, normalizeHttpEndpoint(endpoint)).toString();
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
	const response = await fetch(url, { signal });
	if (!response.ok) {
		throw new Error(`request failed (${response.status} ${response.statusText}) for ${url}`);
	}
	return response.json();
}

async function makeArtifactDir(cwd: string): Promise<string> {
	const artifactDir = join(cwd, ".pire", "artifacts");
	await mkdir(artifactDir, { recursive: true });
	return artifactDir;
}

async function persistJsonArtifact(cwd: string, filename: string, value: unknown): Promise<string> {
	const artifactDir = await makeArtifactDir(cwd);
	const artifactPath = join(artifactDir, filename);
	await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
	return artifactPath;
}

function coerceVersionResponse(value: unknown): CdpVersionResponse {
	return isRecord(value) ? (value as CdpVersionResponse) : {};
}

function coerceTargetList(value: unknown): CdpTargetInfo[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter(isRecord) as CdpTargetInfo[];
}

function selectTarget(
	targets: CdpTargetInfo[],
	options: Pick<WebCdpRuntimeEvalOptions, "targetId" | "targetType" | "targetUrlContains">,
): CdpTargetInfo {
	let filtered = targets.filter((target) => typeof target.webSocketDebuggerUrl === "string");
	if (options.targetId) {
		filtered = filtered.filter((target) => target.id === options.targetId);
	}
	if (options.targetType) {
		filtered = filtered.filter((target) => target.type === options.targetType);
	}
	if (options.targetUrlContains) {
		filtered = filtered.filter((target) => target.url?.includes(options.targetUrlContains ?? ""));
	}
	const preferred = filtered.find((target) => target.type === "page") ?? filtered[0];
	if (!preferred || typeof preferred.webSocketDebuggerUrl !== "string") {
		throw new Error("no matching CDP target with webSocketDebuggerUrl found");
	}
	return preferred;
}

function formatTargetLabel(target: CdpTargetInfo): string {
	return [
		target.type ?? "unknown",
		target.id ?? "unknown-id",
		target.title ? `"${target.title}"` : undefined,
		target.url ?? undefined,
	]
		.filter((value): value is string => Boolean(value))
		.join(" ");
}

function describeRemoteObject(result: Record<string, unknown> | undefined): string {
	if (!result) {
		return "no result";
	}
	if ("value" in result) {
		return truncatePreview(JSON.stringify(result.value));
	}
	const parts = [
		typeof result.type === "string" ? `type=${result.type}` : undefined,
		typeof result.subtype === "string" ? `subtype=${result.subtype}` : undefined,
		typeof result.description === "string" ? truncatePreview(result.description) : undefined,
	].filter((value): value is string => value !== undefined);
	return parts.join(" ") || truncatePreview(JSON.stringify(result));
}

class CdpClient {
	private readonly socket: WebSocket;
	private readonly abortHandler: () => void;
	private readonly pending = new Map<
		number,
		{
			resolve: (value: Record<string, unknown>) => void;
			reject: (error: Error) => void;
		}
	>();
	private readonly transcript: CdpResultEnvelope[] = [];
	private nextId = 1;

	private constructor(socket: WebSocket, abortHandler: () => void) {
		this.socket = socket;
		this.abortHandler = abortHandler;
	}

	static async connect(url: string, signal?: AbortSignal): Promise<CdpClient> {
		const socket = new WebSocket(url);

		return new Promise((resolve, reject) => {
			const abortHandler = (): void => {
				reject(new Error("CDP command aborted"));
				socket.close(1000, "aborted");
			};
			if (signal) {
				if (signal.aborted) {
					abortHandler();
					return;
				}
				signal.addEventListener("abort", abortHandler, { once: true });
			}

			socket.addEventListener(
				"open",
				() => {
					resolve(new CdpClient(socket, abortHandler));
				},
				{ once: true },
			);
			socket.addEventListener(
				"error",
				() => {
					reject(new Error(`failed to connect to CDP websocket ${url}`));
				},
				{ once: true },
			);
		});
	}

	private decodeMessage(data: unknown): string {
		if (typeof data === "string") {
			return data;
		}
		if (data instanceof ArrayBuffer) {
			return new TextDecoder().decode(new Uint8Array(data));
		}
		return String(data);
	}

	private handleMessage = (event: MessageEvent): void => {
		const decoded = this.decodeMessage(event.data);
		const envelope = JSON.parse(decoded) as CdpResultEnvelope;
		this.transcript.push(envelope);
		if (typeof envelope.id !== "number") {
			return;
		}
		const pending = this.pending.get(envelope.id);
		if (!pending) {
			return;
		}
		this.pending.delete(envelope.id);
		if (envelope.error) {
			pending.reject(new Error(`CDP ${envelope.error.code ?? "error"}: ${envelope.error.message ?? "unknown error"}`));
			return;
		}
		pending.resolve(envelope.result ?? {});
	};

	private handleClose = (): void => {
		for (const pending of this.pending.values()) {
			pending.reject(new Error("CDP websocket closed before command completed"));
		}
		this.pending.clear();
	};

	async send(method: string, params?: Record<string, unknown>): Promise<CdpCommandResult> {
		const id = this.nextId++;
		const envelope: CdpCommandEnvelope = { id, method, params };
		const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.socket.send(JSON.stringify(envelope));
		});
		return {
			result,
			transcript: [...this.transcript],
		};
	}

	async close(): Promise<void> {
		this.socket.removeEventListener("message", this.handleMessage);
		this.socket.removeEventListener("close", this.handleClose);
		this.socket.close(1000, "done");
	}

	start(): void {
		this.socket.addEventListener("message", this.handleMessage);
		this.socket.addEventListener("close", this.handleClose);
	}

	dispose(signal?: AbortSignal): void {
		if (signal) {
			signal.removeEventListener("abort", this.abortHandler);
		}
	}
}

export async function runWebCdpDiscover(
	cwd: string,
	endpoint: string,
	options: WebCdpDiscoverOptions,
	signal?: AbortSignal,
): Promise<WebToolDetails> {
	const versionUrl = buildCdpJsonUrl(endpoint, "/json/version");
	const listUrl = buildCdpJsonUrl(endpoint, "/json/list");
	const version = coerceVersionResponse(await fetchJson(versionUrl, signal));
	const targets = options.includeTargets ? coerceTargetList(await fetchJson(listUrl, signal)) : [];
	const filteredTargets = options.targetType ? targets.filter((target) => target.type === options.targetType) : targets;
	const previewTargets = filteredTargets.slice(0, Math.max(1, options.maxTargets));

	const versionPath = await persistJsonArtifact(cwd, `cdp-version-${slugify(endpoint)}.json`, version);
	const targetPath =
		options.includeTargets && filteredTargets.length > 0
			? await persistJsonArtifact(cwd, `cdp-targets-${slugify(endpoint)}.json`, filteredTargets)
			: undefined;

	const lines = [
		"web_cdp_discover: ok",
		`endpoint: ${normalizeHttpEndpoint(endpoint).toString()}`,
		`browser: ${version.Browser ?? "unknown"}`,
		`protocol: ${version["Protocol-Version"] ?? "unknown"}`,
		`browser websocket: ${typeof version.webSocketDebuggerUrl === "string" ? version.webSocketDebuggerUrl : "unavailable"}`,
	];
	if (options.includeTargets) {
		lines.push(`targets: ${filteredTargets.length}`);
		for (const target of previewTargets) {
			lines.push(`- ${formatTargetLabel(target)}`);
		}
	}

	const artifacts: WebArtifactObservation[] = [
		{
			path: versionPath,
			type: "json",
			command: commandToString("GET", [versionUrl]),
			finding: `CDP version metadata for ${endpoint}`,
		},
	];
	if (targetPath) {
		artifacts.push({
			path: targetPath,
			type: "json",
			command: commandToString("GET", [listUrl]),
			finding: `CDP target inventory for ${endpoint}`,
		});
	}

	return {
		tool: "web_cdp_discover",
		target: normalizeHttpEndpoint(endpoint).toString(),
		command: ["GET", versionUrl, ...(options.includeTargets ? [listUrl] : [])],
		commandString: options.includeTargets ? `${commandToString("GET", [versionUrl])} && ${commandToString("GET", [listUrl])}` : commandToString("GET", [versionUrl]),
		summary: lines.join("\n"),
		artifacts,
	};
}

export async function runWebCdpRuntimeEval(
	cwd: string,
	endpoint: string,
	options: WebCdpRuntimeEvalOptions,
	signal?: AbortSignal,
): Promise<WebToolDetails> {
	const targets = coerceTargetList(await fetchJson(buildCdpJsonUrl(endpoint, "/json/list"), signal));
	const target = selectTarget(targets, options);
	const websocketUrl = target.webSocketDebuggerUrl;
	if (!websocketUrl) {
		throw new Error("selected CDP target did not expose webSocketDebuggerUrl");
	}

	const client = await CdpClient.connect(websocketUrl, signal);
	client.start();
	try {
		const evaluation = await client.send("Runtime.evaluate", {
			expression: options.expression,
			awaitPromise: options.awaitPromise,
			returnByValue: options.returnByValue,
			includeCommandLineAPI: options.includeCommandLineApi,
			throwOnSideEffect: options.throwOnSideEffect,
			timeout: options.timeoutMs,
		});

		const artifactPath = await persistJsonArtifact(cwd, `cdp-runtime-eval-${slugify(target.id ?? endpoint)}.json`, {
			endpoint: normalizeHttpEndpoint(endpoint).toString(),
			target,
			expression: options.expression,
			response: evaluation.result,
			transcript: evaluation.transcript,
		});

		const resultObject = isRecord(evaluation.result.result) ? evaluation.result.result : undefined;
		const exceptionObject = isRecord(evaluation.result.exceptionDetails) ? evaluation.result.exceptionDetails : undefined;
		const lines = [
			"web_cdp_runtime_eval: ok",
			`endpoint: ${normalizeHttpEndpoint(endpoint).toString()}`,
			`target: ${formatTargetLabel(target)}`,
			`expression: ${options.expression}`,
			`result: ${describeRemoteObject(resultObject)}`,
		];
		if (exceptionObject) {
			lines.push(`exception: ${truncatePreview(JSON.stringify(exceptionObject))}`);
		}

		return {
			tool: "web_cdp_runtime_eval",
			target: target.url ?? target.id ?? normalizeHttpEndpoint(endpoint).toString(),
			command: ["CDP", "Runtime.evaluate"],
			commandString: commandToString("CDP", ["Runtime.evaluate", websocketUrl]),
			summary: lines.join("\n"),
			artifacts: [
				{
					path: artifactPath,
					type: "json",
					command: commandToString("CDP", ["Runtime.evaluate", websocketUrl]),
					finding: `Runtime.evaluate transcript for ${formatTargetLabel(target)}`,
				},
			],
		};
	} finally {
		await client.close();
		client.dispose(signal);
	}
}
