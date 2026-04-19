import { randomUUID } from "node:crypto";
import {
	appendFileSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Message, TextContent } from "@mariozechner/pi-ai";

export const CURRENT_SESSION_VERSION = 3;

export interface SessionHeader {
	type: "session";
	version?: number;
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
}

export interface NewSessionOptions {
	id?: string;
	parentSession?: string;
}

export interface SessionEntryBase {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
}

export interface SessionMessageEntry extends SessionEntryBase {
	type: "message";
	message: AgentMessage;
}

export interface ThinkingLevelChangeEntry extends SessionEntryBase {
	type: "thinking_level_change";
	thinkingLevel: string;
}

export interface ModelChangeEntry extends SessionEntryBase {
	type: "model_change";
	provider: string;
	modelId: string;
}

export interface CompactionEntry extends SessionEntryBase {
	type: "compaction";
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
}

export interface SessionInfoEntry extends SessionEntryBase {
	type: "session_info";
	name?: string;
}

export type SessionEntry =
	| SessionMessageEntry
	| ThinkingLevelChangeEntry
	| ModelChangeEntry
	| CompactionEntry
	| SessionInfoEntry;
export type FileEntry = SessionHeader | SessionEntry;

export interface PersistedCompactionSummary {
	summary: string;
	tokensBefore: number;
	timestamp: string;
	firstKeptEntryId: string;
}

export interface SessionContext {
	messages: AgentMessage[];
	messageEntryIds: string[];
	thinkingLevel: ThinkingLevel;
	model: { provider: string; modelId: string } | null;
	compaction?: PersistedCompactionSummary;
}

export interface SessionInfo {
	path: string;
	id: string;
	cwd: string;
	name?: string;
	parentSessionPath?: string;
	created: Date;
	modified: Date;
	messageCount: number;
	firstMessage: string;
}

interface MutableSessionEntry extends Omit<SessionEntry, "id" | "parentId"> {
	id?: string;
	parentId?: string | null;
}

const VALID_THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);

function createSessionId(): string {
	return randomUUID();
}

function generateEntryId(existingIds: { has(id: string): boolean }): string {
	for (let attempt = 0; attempt < 100; attempt++) {
		const id = randomUUID().slice(0, 8);
		if (!existingIds.has(id)) {
			return id;
		}
	}
	return randomUUID();
}

function isMessageWithContent(message: AgentMessage): message is Message {
	return typeof (message as Message).role === "string" && "content" in message;
}

function extractTextContent(message: Message): string {
	const content = message.content;
	if (typeof content === "string") {
		return content;
	}
	return content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join(" ");
}

function parseStoredThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
	if (!value || !VALID_THINKING_LEVELS.has(value as ThinkingLevel)) {
		return undefined;
	}
	return value as ThinkingLevel;
}

function getLastActivityTime(entries: FileEntry[]): number | undefined {
	let lastActivityTime: number | undefined;

	for (const entry of entries) {
		if (entry.type === "session") {
			continue;
		}

		const entryTime = new Date(entry.timestamp).getTime();
		if (!Number.isNaN(entryTime)) {
			lastActivityTime = Math.max(lastActivityTime ?? 0, entryTime);
		}

		if (entry.type !== "message") {
			continue;
		}

		const message = entry.message;
		if (!isMessageWithContent(message)) {
			continue;
		}
		if (message.role !== "user" && message.role !== "assistant") {
			continue;
		}

		const messageTimestamp = (message as { timestamp?: number }).timestamp;
		if (typeof messageTimestamp === "number") {
			lastActivityTime = Math.max(lastActivityTime ?? 0, messageTimestamp);
		}
	}

	return lastActivityTime;
}

function getSessionModifiedDate(entries: FileEntry[], header: SessionHeader, statsModified: Date): Date {
	const lastActivityTime = getLastActivityTime(entries);
	if (typeof lastActivityTime === "number" && lastActivityTime > 0) {
		return new Date(lastActivityTime);
	}

	const headerTime = new Date(header.timestamp).getTime();
	return !Number.isNaN(headerTime) ? new Date(headerTime) : statsModified;
}

function normalizeLoadedEntries(entries: FileEntry[]): boolean {
	const ids = new Set<string>();
	let previousId: string | null = null;
	let changed = false;

	for (const entry of entries) {
		if (entry.type === "session") {
			if (entry.version !== CURRENT_SESSION_VERSION) {
				entry.version = CURRENT_SESSION_VERSION;
				changed = true;
			}
			continue;
		}

		const mutableEntry = entry as MutableSessionEntry;
		if (!mutableEntry.id) {
			mutableEntry.id = generateEntryId(ids);
			changed = true;
		}
		ids.add(mutableEntry.id);

		if (mutableEntry.parentId === undefined) {
			mutableEntry.parentId = previousId;
			changed = true;
		}

		previousId = mutableEntry.id;
	}

	return changed;
}

export function getSharedSessionsDir(): string {
	return join(homedir(), ".pi", "agent", "sessions");
}

export function getDefaultSessionDir(cwd: string): string {
	const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(getSharedSessionsDir(), safePath);
}

export function loadEntriesFromFile(filePath: string): FileEntry[] {
	if (!existsSync(filePath)) {
		return [];
	}

	const content = readFileSync(filePath, "utf8");
	const entries: FileEntry[] = [];
	for (const line of content.trim().split("\n")) {
		if (!line.trim()) {
			continue;
		}
		try {
			entries.push(JSON.parse(line) as FileEntry);
		} catch {
			// Ignore malformed lines while preserving valid content.
		}
	}

	if (entries.length === 0) {
		return entries;
	}

	const header = entries[0];
	if (header.type !== "session" || typeof header.id !== "string") {
		return [];
	}

	return entries;
}

export function readSessionHeader(filePath: string): SessionHeader | undefined {
	const header = loadEntriesFromFile(filePath)[0];
	return header?.type === "session" ? header : undefined;
}

function isValidSessionFile(filePath: string): boolean {
	try {
		const fd = openSync(filePath, "r");
		const buffer = Buffer.alloc(512);
		const bytesRead = readSync(fd, buffer, 0, 512, 0);
		closeSync(fd);
		const firstLine = buffer.toString("utf8", 0, bytesRead).split("\n")[0];
		if (!firstLine) {
			return false;
		}
		const header = JSON.parse(firstLine) as { type?: string; id?: unknown };
		return header.type === "session" && typeof header.id === "string";
	} catch {
		return false;
	}
}

export function findMostRecentSession(sessionDir: string): string | null {
	try {
		const files = readdirSync(sessionDir)
			.filter((fileName) => fileName.endsWith(".jsonl"))
			.map((fileName) => join(sessionDir, fileName))
			.filter(isValidSessionFile)
			.map((filePath) => ({ filePath, modified: statSync(filePath).mtime }))
			.sort((left, right) => right.modified.getTime() - left.modified.getTime());

		return files[0]?.filePath ?? null;
	} catch {
		return null;
	}
}

export function buildSessionContext(
	entries: SessionEntry[],
	leafId?: string | null,
	byId?: Map<string, SessionEntry>,
): SessionContext {
	const entryById = byId ?? new Map(entries.map((entry) => [entry.id, entry]));

	if (leafId === null) {
		return { messages: [], messageEntryIds: [], thinkingLevel: "off", model: null };
	}

	let leaf = leafId ? entryById.get(leafId) : undefined;
	if (!leaf) {
		leaf = entries[entries.length - 1];
	}

	if (!leaf) {
		return { messages: [], messageEntryIds: [], thinkingLevel: "off", model: null };
	}

	const path: SessionEntry[] = [];
	let current: SessionEntry | undefined = leaf;
	while (current) {
		path.unshift(current);
		current = current.parentId ? entryById.get(current.parentId) : undefined;
	}

	let thinkingLevel: ThinkingLevel = "off";
	let model: { provider: string; modelId: string } | null = null;
	let latestCompaction: CompactionEntry | undefined;
	const messages: AgentMessage[] = [];
	const messageEntryIds: string[] = [];

	for (const entry of path) {
		if (entry.type === "thinking_level_change") {
			const parsedThinking = parseStoredThinkingLevel(entry.thinkingLevel);
			if (parsedThinking) {
				thinkingLevel = parsedThinking;
			}
			continue;
		}

		if (entry.type === "model_change") {
			model = { provider: entry.provider, modelId: entry.modelId };
			continue;
		}

		if (entry.type === "compaction") {
			latestCompaction = entry;
		}
	}

	const appendMessage = (entry: SessionMessageEntry) => {
		messages.push(entry.message);
		messageEntryIds.push(entry.id);

		if (entry.message.role === "assistant") {
			const provider = (entry.message as { provider?: unknown }).provider;
			const modelId = (entry.message as { model?: unknown }).model;
			if (typeof provider === "string" && typeof modelId === "string") {
				model = { provider, modelId };
			}
		}
	};

	if (latestCompaction) {
		let foundFirstKept = false;
		for (const entry of path) {
			if (entry.id === latestCompaction.firstKeptEntryId) {
				foundFirstKept = true;
			}
			if (!foundFirstKept || entry.type !== "message") {
				continue;
			}
			appendMessage(entry);
		}
		if (!foundFirstKept) {
			for (const entry of path) {
				if (entry.type !== "message") {
					continue;
				}
				appendMessage(entry);
			}
		}
	} else {
		for (const entry of path) {
			if (entry.type !== "message") {
				continue;
			}
			appendMessage(entry);
		}
	}

	return {
		messages,
		messageEntryIds,
		thinkingLevel,
		model,
		compaction: latestCompaction
			? {
					summary: latestCompaction.summary,
					tokensBefore: latestCompaction.tokensBefore,
					timestamp: latestCompaction.timestamp,
					firstKeptEntryId: latestCompaction.firstKeptEntryId,
				}
			: undefined,
	};
}

export function readSessionInfo(filePath: string): SessionInfo | undefined {
	try {
		const entries = loadEntriesFromFile(filePath);
		if (entries.length === 0) {
			return undefined;
		}

		const header = entries[0];
		if (header?.type !== "session") {
			return undefined;
		}

		const stats = statSync(filePath);
		let messageCount = 0;
		let firstMessage = "";
		let name: string | undefined;

		for (const entry of entries) {
			if (entry.type === "session_info") {
				name = entry.name?.trim() || undefined;
				continue;
			}
			if (entry.type !== "message") {
				continue;
			}

			messageCount++;
			const message = entry.message;
			if (!isMessageWithContent(message)) {
				continue;
			}
			if (message.role !== "user" && message.role !== "assistant") {
				continue;
			}

			const textContent = extractTextContent(message);
			if (!textContent || firstMessage) {
				continue;
			}
			if (message.role === "user") {
				firstMessage = textContent;
			}
		}

		return {
			path: filePath,
			id: header.id,
			cwd: header.cwd,
			name,
			parentSessionPath: header.parentSession,
			created: new Date(header.timestamp),
			modified: getSessionModifiedDate(entries, header, stats.mtime),
			messageCount,
			firstMessage: firstMessage || "(no messages)",
		};
	} catch {
		return undefined;
	}
}

export function listSessions(cwd: string, sessionDir?: string): SessionInfo[] {
	const resolvedSessionDir = sessionDir ?? getDefaultSessionDir(cwd);
	if (!existsSync(resolvedSessionDir)) {
		return [];
	}

	try {
		const sessions = readdirSync(resolvedSessionDir)
			.filter((fileName) => fileName.endsWith(".jsonl"))
			.map((fileName) => join(resolvedSessionDir, fileName))
			.map((filePath) => readSessionInfo(filePath))
			.filter((info): info is SessionInfo => info !== undefined)
			.sort((left, right) => right.modified.getTime() - left.modified.getTime());
		return sessions;
	} catch {
		return [];
	}
}

export function readMostRecentThinkingLevel(cwd: string, sessionDir?: string): ThinkingLevel | undefined {
	const normalizedCwd = resolve(cwd);
	const session = listSessions(cwd, sessionDir).find((entry) => resolve(entry.cwd) === normalizedCwd);
	if (!session) {
		return undefined;
	}

	const fileEntries = loadEntriesFromFile(session.path);
	if (fileEntries.length === 0) {
		return undefined;
	}

	const entries = fileEntries.filter((entry): entry is SessionEntry => entry.type !== "session");
	if (!entries.some((entry) => entry.type === "thinking_level_change")) {
		return undefined;
	}

	return buildSessionContext(entries).thinkingLevel;
}

export class SessionManager {
	private sessionId = "";
	private sessionFile: string | undefined;
	private readonly sessionDir: string;
	private readonly cwd: string;
	private readonly persist: boolean;
	private flushed = false;
	private fileEntries: FileEntry[] = [];
	private byId = new Map<string, SessionEntry>();
	private leafId: string | null = null;

	private constructor(cwd: string, sessionDir: string, sessionFile: string | undefined, persist: boolean) {
		this.cwd = cwd;
		this.sessionDir = sessionDir;
		this.persist = persist;
		if (persist && !existsSync(sessionDir)) {
			mkdirSync(sessionDir, { recursive: true });
		}

		if (sessionFile) {
			this.setSessionFile(sessionFile);
		} else {
			this.newSession();
		}
	}

	private setSessionFile(sessionFile: string): void {
		this.sessionFile = resolve(sessionFile);
		if (!existsSync(this.sessionFile)) {
			const explicitPath = this.sessionFile;
			this.newSession();
			this.sessionFile = explicitPath;
			return;
		}

		this.fileEntries = loadEntriesFromFile(this.sessionFile);
		if (this.fileEntries.length === 0) {
			const explicitPath = this.sessionFile;
			this.newSession();
			this.sessionFile = explicitPath;
			this.rewriteFile();
			this.flushed = true;
			return;
		}

		const header = this.fileEntries.find((entry) => entry.type === "session");
		this.sessionId = header?.id ?? createSessionId();

		if (normalizeLoadedEntries(this.fileEntries)) {
			this.rewriteFile();
		}

		this.buildIndex();
		this.flushed = true;
	}

	private buildIndex(): void {
		this.byId.clear();
		this.leafId = null;

		for (const entry of this.fileEntries) {
			if (entry.type === "session") {
				continue;
			}
			this.byId.set(entry.id, entry);
			this.leafId = entry.id;
		}
	}

	private rewriteFile(): void {
		if (!this.persist || !this.sessionFile) {
			return;
		}
		const content = `${this.fileEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
		writeFileSync(this.sessionFile, content);
	}

	private appendEntry(entry: SessionEntry): void {
		this.fileEntries.push(entry);
		this.byId.set(entry.id, entry);
		this.leafId = entry.id;
		this.persistEntry(entry);
	}

	private persistEntry(entry: SessionEntry): void {
		if (!this.persist || !this.sessionFile) {
			return;
		}

		const hasAssistant = this.fileEntries.some(
			(fileEntry) => fileEntry.type === "message" && fileEntry.message.role === "assistant",
		);
		if (!hasAssistant) {
			this.flushed = false;
			return;
		}

		if (!this.flushed) {
			this.rewriteFile();
			this.flushed = true;
			return;
		}

		appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
	}

	newSession(options?: NewSessionOptions): string | undefined {
		this.sessionId = options?.id ?? createSessionId();
		const timestamp = new Date().toISOString();
		const header: SessionHeader = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: this.sessionId,
			timestamp,
			cwd: this.cwd,
			parentSession: options?.parentSession,
		};
		this.fileEntries = [header];
		this.byId.clear();
		this.leafId = null;
		this.flushed = false;

		if (this.persist) {
			const fileTimestamp = timestamp.replace(/[:.]/g, "-");
			this.sessionFile = join(this.sessionDir, `${fileTimestamp}_${this.sessionId}.jsonl`);
		} else {
			this.sessionFile = undefined;
		}

		return this.sessionFile;
	}

	appendMessage(message: AgentMessage): string {
		const entry: SessionMessageEntry = {
			type: "message",
			id: generateEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			message,
		};
		this.appendEntry(entry);
		return entry.id;
	}

	appendThinkingLevelChange(thinkingLevel: ThinkingLevel): string {
		const entry: ThinkingLevelChangeEntry = {
			type: "thinking_level_change",
			id: generateEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			thinkingLevel,
		};
		this.appendEntry(entry);
		return entry.id;
	}

	appendModelChange(provider: string, modelId: string): string {
		const entry: ModelChangeEntry = {
			type: "model_change",
			id: generateEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			provider,
			modelId,
		};
		this.appendEntry(entry);
		return entry.id;
	}

	appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number): string {
		const entry: CompactionEntry = {
			type: "compaction",
			id: generateEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			summary,
			firstKeptEntryId,
			tokensBefore,
		};
		this.appendEntry(entry);
		return entry.id;
	}

	hasEntryType(type: SessionEntry["type"]): boolean {
		return this.fileEntries.some((entry) => entry.type === type);
	}

	buildSessionContext(): SessionContext {
		return buildSessionContext(this.getEntries(), this.leafId, this.byId);
	}

	getLatestCompaction(): PersistedCompactionSummary | undefined {
		const entries = this.getEntries();
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index];
			if (entry?.type !== "compaction") {
				continue;
			}
			return {
				summary: entry.summary,
				tokensBefore: entry.tokensBefore,
				timestamp: entry.timestamp,
				firstKeptEntryId: entry.firstKeptEntryId,
			};
		}
		return undefined;
	}

	getEntries(): SessionEntry[] {
		return this.fileEntries.filter((entry): entry is SessionEntry => entry.type !== "session");
	}

	getSessionId(): string {
		return this.sessionId;
	}

	getParentSessionFile(): string | undefined {
		const header = this.fileEntries[0];
		return header?.type === "session" ? header.parentSession : undefined;
	}

	getSessionLineageIds(): string[] {
		const lineage: string[] = [];
		const visitedPaths = new Set<string>();

		const appendHeader = (header: SessionHeader | undefined) => {
			if (!header?.id || lineage.includes(header.id)) {
				return;
			}
			lineage.push(header.id);
		};

		const currentHeader = this.fileEntries[0];
		if (currentHeader?.type === "session") {
			appendHeader(currentHeader);
			let parentPath = currentHeader.parentSession;
			while (parentPath) {
				const resolvedPath = resolve(parentPath);
				if (visitedPaths.has(resolvedPath)) {
					break;
				}
				visitedPaths.add(resolvedPath);
				const parentHeader = readSessionHeader(resolvedPath);
				if (!parentHeader) {
					break;
				}
				appendHeader(parentHeader);
				parentPath = parentHeader.parentSession;
			}
		} else if (this.sessionId) {
			lineage.push(this.sessionId);
		}

		return lineage.reverse();
	}

	getSessionFile(): string | undefined {
		return this.sessionFile;
	}

	getSessionDir(): string {
		return this.sessionDir;
	}

	flush(): void {
		if (!this.persist || !this.sessionFile) {
			return;
		}
		this.rewriteFile();
		this.flushed = true;
	}

	getCwd(): string {
		return this.cwd;
	}

	static create(cwd: string, sessionDir?: string): SessionManager {
		return new SessionManager(cwd, sessionDir ?? getDefaultSessionDir(cwd), undefined, true);
	}

	static open(filePath: string, sessionDir?: string): SessionManager {
		const entries = loadEntriesFromFile(filePath);
		const header = entries.find((entry) => entry.type === "session");
		const cwd = header?.cwd ?? process.cwd();
		return new SessionManager(cwd, sessionDir ?? resolve(filePath, ".."), filePath, true);
	}

	static continueRecent(cwd: string, sessionDir?: string): SessionManager {
		const resolvedSessionDir = sessionDir ?? getDefaultSessionDir(cwd);
		const mostRecentSession = findMostRecentSession(resolvedSessionDir);
		if (mostRecentSession) {
			return new SessionManager(cwd, resolvedSessionDir, mostRecentSession, true);
		}
		return new SessionManager(cwd, resolvedSessionDir, undefined, true);
	}
}
