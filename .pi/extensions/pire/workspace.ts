import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { ReadonlySessionManager } from "@mariozechner/pi-coding-agent";

const require = createRequire(import.meta.url);
type ShellOperatorToken = { op: string };
type ShellCommentToken = { comment: string };
type ShellToken = string | ShellOperatorToken | ShellCommentToken;
const { parse: parseShellCommand } = require("shell-quote") as {
	parse: (command: string) => ShellToken[];
};

export const FINDING_STATUS_VALUES = [
	"lead",
	"candidate",
	"confirmed",
	"submitted",
	"de-escalated",
	"blocked",
] as const;

export type FindingStatus = (typeof FINDING_STATUS_VALUES)[number];

export const FINDING_CONFIDENCE_VALUES = ["low", "medium", "high"] as const;

export type FindingConfidence = (typeof FINDING_CONFIDENCE_VALUES)[number];

const STATUS_START_MARKER = "<!-- pire:status:start -->";
const STATUS_END_MARKER = "<!-- pire:status:end -->";

const LEGACY_SCRATCH_BUCKETS = new Map(
	[
		["recon", "recon"],
		["modeling", "modeling"],
		["analysis", "analysis"],
		["report", "reports"],
		["reports", "reports"],
		["poc", "poc"],
		["evidence", "artifacts"],
		["output", "artifacts"],
		["artifacts", "artifacts"],
	] as const,
);

type ScratchBucket = "recon" | "modeling" | "analysis" | "reports" | "poc" | "artifacts";

const SHELL_SEQUENCE_OPERATORS = new Set(["&&", "||", ";", "|", "&"]);
const SHELL_MUTATING_COMMANDS = new Set(["mkdir", "touch", "rm", "rmdir"]);
const SHELL_DESTINATION_COMMANDS = new Set(["cp", "mv", "install", "ln"]);
const SHELL_MULTI_TARGET_COMMANDS = new Set(["tee"]);

export interface ResearchWorkspaceLayout {
	root: string;
	sessionId: string;
	sessionDate: string;
	sessionsDir: string;
	sessionDir: string;
	sessionNotesPath: string;
	sessionReconDir: string;
	sessionModelingDir: string;
	sessionAnalysisDir: string;
	sessionReportsDir: string;
	sessionPocDir: string;
	sessionArtifactsDir: string;
	entitiesDir: string;
	targetsDir: string;
	componentsDir: string;
	symbolsDir: string;
	findingsDir: string;
	artifactsDir: string;
	sha256Dir: string;
	indexDir: string;
	indexDbPath: string;
	statusPath: string;
	internalDir: string;
}

export interface FindingRecordInput {
	id: string;
	title: string;
	status: FindingStatus;
	summary: string;
	reason: string;
	targets: string[];
	components: string[];
	symbols: string[];
	confidence: FindingConfidence;
	detailsMarkdown?: string;
}

interface ParsedFindingRecord extends FindingRecordInput {
	path: string;
	updatedAt: string;
}

function formatLocalDate(date: Date): string {
	const year = String(date.getFullYear());
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function normalizePathSeparators(value: string): string {
	return value.replaceAll("\\", "/");
}

function expandHome(value: string): string {
	if (value.startsWith("~/")) {
		return join(homedir(), value.slice(2));
	}
	if (value === "~") {
		return homedir();
	}
	return value;
}

function isWithinRoot(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function relativeToRoot(root: string, candidate: string): string {
	const rel = normalizePathSeparators(relative(root, candidate));
	return rel === "" ? "." : rel;
}

function isAbsoluteLike(value: string): boolean {
	return value.startsWith("/") || value.startsWith("~");
}

function resolveInputPath(value: string, cwd: string): string {
	return resolve(cwd, expandHome(value));
}

function writeFileIfMissing(path: string, content: string): void {
	if (!existsSync(path)) {
		writeFileSync(path, content, "utf-8");
	}
}

function initialStatusMarkdown(): string {
	return [
		"# STATUS",
		"",
		"Top-level tracker for durable findings in this workspace.",
		"",
		STATUS_START_MARKER,
		"| ID | Title | Status | Confidence | Targets | Components | Updated | Notes |",
		"| --- | --- | --- | --- | --- | --- | --- | --- |",
		STATUS_END_MARKER,
		"",
	].join("\n");
}

function initialSessionNotes(layout: ResearchWorkspaceLayout): string {
	return [
		"# Session Notes",
		"",
		`- Date: ${layout.sessionDate}`,
		`- Session: ${layout.sessionId}`,
		`- Scratch Dir: ${relativeToRoot(layout.root, layout.sessionDir)}`,
		"",
		"Use this area for scratch notes, prior-art imports, and intermediate artifacts.",
		"",
	].join("\n");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isShellOperatorToken(token: ShellToken): token is ShellOperatorToken {
	return typeof token !== "string" && "op" in token;
}

function shellTokenText(token: ShellToken): string | null {
	return typeof token === "string" ? token : null;
}

function isShellAssignment(token: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}

function isWriteRedirectionOperator(op: string): boolean {
	return /^\d*>>?$/.test(op) || op === "<>" || op === ">|" || op === "&>" || op === "&>>";
}

function splitShellCommand(command: string): ShellToken[][] {
	const segments: ShellToken[][] = [];
	let currentSegment: ShellToken[] = [];

	for (const token of parseShellCommand(command)) {
		if (isShellOperatorToken(token) && SHELL_SEQUENCE_OPERATORS.has(token.op)) {
			if (currentSegment.length > 0) {
				segments.push(currentSegment);
				currentSegment = [];
			}
			continue;
		}
		currentSegment.push(token);
	}

	if (currentSegment.length > 0) {
		segments.push(currentSegment);
	}

	return segments;
}

function getShellCommandWords(segment: ShellToken[]): string[] {
	return segment
		.map((token) => shellTokenText(token))
		.filter((token): token is string => token !== null);
}

function getSegmentCommandAndArgs(segment: ShellToken[]): { command: string | null; args: string[] } {
	const words = getShellCommandWords(segment);
	let commandIndex = 0;
	while (commandIndex < words.length && isShellAssignment(words[commandIndex])) {
		commandIndex++;
	}
	if (commandIndex >= words.length) {
		return { command: null, args: [] };
	}
	return {
		command: words[commandIndex],
		args: words.slice(commandIndex + 1),
	};
}

function isOptionToken(token: string): boolean {
	return token.startsWith("-") && token !== "-";
}

function getNonOptionArgs(args: string[]): string[] {
	const values: string[] = [];
	for (const arg of args) {
		if (isOptionToken(arg)) {
			continue;
		}
		values.push(arg);
	}
	return values;
}

function resolveSegmentCwd(segment: ShellToken[], currentCwd: string): string {
	const { command, args } = getSegmentCommandAndArgs(segment);
	if (command !== "cd" || args.length === 0) {
		return currentCwd;
	}

	return resolve(currentCwd, expandHome(args[0]));
}

function collectSegmentRedirectTargets(segment: ShellToken[]): string[] {
	const targets: string[] = [];
	for (let index = 0; index < segment.length - 1; index++) {
		const token = segment[index];
		if (!isShellOperatorToken(token) || !isWriteRedirectionOperator(token.op)) {
			continue;
		}

		const nextToken = shellTokenText(segment[index + 1]);
		if (nextToken !== null) {
			targets.push(nextToken);
		}
	}
	return targets;
}

function collectSegmentCommandTargets(segment: ShellToken[]): string[] {
	const { command, args } = getSegmentCommandAndArgs(segment);
	if (command === null) {
		return [];
	}

	if (SHELL_MUTATING_COMMANDS.has(command)) {
		return getNonOptionArgs(args);
	}

	if (SHELL_DESTINATION_COMMANDS.has(command)) {
		const nonOptionArgs = getNonOptionArgs(args);
		return nonOptionArgs.length === 0 ? [] : [nonOptionArgs.at(-1) as string];
	}

	if (SHELL_MULTI_TARGET_COMMANDS.has(command)) {
		return getNonOptionArgs(args);
	}

	if (command === "sed") {
		const nonOptionArgs = getNonOptionArgs(args);
		const hasInPlace = args.some((arg) => arg === "-i" || arg.startsWith("-i"));
		return hasInPlace && nonOptionArgs.length > 0 ? [nonOptionArgs.at(-1) as string] : [];
	}

	if (command === "perl" || command === "ruby") {
		const nonOptionArgs = getNonOptionArgs(args);
		const hasInPlace = args.some((arg) => arg === "-i" || arg.startsWith("-i"));
		return hasInPlace && nonOptionArgs.length > 0 ? [nonOptionArgs.at(-1) as string] : [];
	}

	return [];
}

function sqlQuote(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function runSqlite(path: string, sql: string): void {
	try {
		execFileSync("sqlite3", [path, sql], { stdio: "ignore" });
	} catch {
		// Best-effort indexing; workspace enforcement does not depend on sqlite.
	}
}

function ensureWorkspaceIndex(layout: ResearchWorkspaceLayout): void {
	if (existsSync(layout.indexDbPath)) {
		return;
	}
	runSqlite(
		layout.indexDbPath,
		[
			"CREATE TABLE IF NOT EXISTS records (",
			"  id TEXT PRIMARY KEY,",
			"  type TEXT NOT NULL,",
			"  title TEXT NOT NULL,",
			"  status TEXT,",
			"  path TEXT NOT NULL,",
			"  updated_at TEXT NOT NULL,",
			"  body TEXT NOT NULL",
			");",
			"CREATE TABLE IF NOT EXISTS edges (",
			"  from_id TEXT NOT NULL,",
			"  edge_type TEXT NOT NULL,",
			"  to_id TEXT NOT NULL,",
			"  PRIMARY KEY (from_id, edge_type, to_id)",
			");",
			"CREATE VIRTUAL TABLE IF NOT EXISTS record_fts USING fts5(id, title, body);",
		].join("\n"),
	);
}

export function findResearchWorkspaceRoot(cwd: string): string | null {
	let current = resolve(cwd);
	const filesystemRoot = resolve(sep);

	while (true) {
		const hasAgents = existsSync(join(current, "AGENTS.md"));
		const hasResearchDocs =
			existsSync(join(current, "TARGET.md")) ||
			existsSync(join(current, "SCOPE.md")) ||
			existsSync(join(current, "ENVIRONMENT.md"));

		if (hasAgents && hasResearchDocs) {
			return current;
		}

		if (current === filesystemRoot) {
			return null;
		}

		const parent = dirname(current);
		if (parent === current) {
			return null;
		}
		current = parent;
	}
}

export function getResearchWorkspaceLayout(
	cwd: string,
	sessionManager: ReadonlySessionManager,
): ResearchWorkspaceLayout | null {
	const root = findResearchWorkspaceRoot(cwd);
	if (root === null) {
		return null;
	}

	const sessionId = sessionManager.getSessionId() || "session";
	const sessionDate = formatLocalDate(new Date());
	const sessionsDir = join(root, "sessions");
	const sessionDir = join(sessionsDir, sessionDate, sessionId);
	const entitiesDir = join(root, "entities");
	const findingsDir = join(root, "findings");
	const artifactsDir = join(root, "artifacts");
	const indexDir = join(root, "index");
	const internalDir = join(root, ".pire");

	return {
		root,
		sessionId,
		sessionDate,
		sessionsDir,
		sessionDir,
		sessionNotesPath: join(sessionDir, "notes.md"),
		sessionReconDir: join(sessionDir, "recon"),
		sessionModelingDir: join(sessionDir, "modeling"),
		sessionAnalysisDir: join(sessionDir, "analysis"),
		sessionReportsDir: join(sessionDir, "reports"),
		sessionPocDir: join(sessionDir, "poc"),
		sessionArtifactsDir: join(sessionDir, "artifacts"),
		entitiesDir,
		targetsDir: join(entitiesDir, "targets"),
		componentsDir: join(entitiesDir, "components"),
		symbolsDir: join(entitiesDir, "symbols"),
		findingsDir,
		artifactsDir,
		sha256Dir: join(artifactsDir, "sha256"),
		indexDir,
		indexDbPath: join(indexDir, "research.sqlite"),
		statusPath: join(root, "STATUS.md"),
		internalDir,
	};
}

export function ensureResearchWorkspaceLayout(layout: ResearchWorkspaceLayout): void {
	const dirs = [
		layout.sessionsDir,
		layout.sessionDir,
		layout.sessionReconDir,
		layout.sessionModelingDir,
		layout.sessionAnalysisDir,
		layout.sessionReportsDir,
		layout.sessionPocDir,
		layout.sessionArtifactsDir,
		layout.entitiesDir,
		layout.targetsDir,
		layout.componentsDir,
		layout.symbolsDir,
		layout.findingsDir,
		layout.artifactsDir,
		layout.sha256Dir,
		layout.indexDir,
		layout.internalDir,
	];

	for (const dir of dirs) {
		mkdirSync(dir, { recursive: true });
	}

	writeFileIfMissing(layout.statusPath, initialStatusMarkdown());
	writeFileIfMissing(layout.sessionNotesPath, initialSessionNotes(layout));
	ensureWorkspaceIndex(layout);
}

function buildManagedStatusSection(records: ParsedFindingRecord[]): string {
	const lines = [
		STATUS_START_MARKER,
		"| ID | Title | Status | Confidence | Targets | Components | Updated | Notes |",
		"| --- | --- | --- | --- | --- | --- | --- | --- |",
	];

	for (const record of records) {
		lines.push(
			`| ${record.id} | ${record.title.replaceAll("|", "\\|")} | ${record.status} | ${record.confidence} | ${record.targets.join(", ")} | ${record.components.join(", ")} | ${record.updatedAt} | ${record.reason.replaceAll("|", "\\|")} |`,
		);
	}

	lines.push(STATUS_END_MARKER);
	return lines.join("\n");
}

function insertManagedStatusSection(existing: string, section: string): string {
	const startIndex = existing.indexOf(STATUS_START_MARKER);
	const endIndex = existing.indexOf(STATUS_END_MARKER);

	if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
		const before = existing.slice(0, startIndex).trimEnd();
		const after = existing.slice(endIndex + STATUS_END_MARKER.length).trimStart();
		return `${before}\n\n${section}\n\n${after}`.trimEnd() + "\n";
	}

	const trimmed = existing.trimEnd();
	if (trimmed.length === 0) {
		return `${section}\n`;
	}
	return `${trimmed}\n\n${section}\n`;
}

function parseFrontmatterArray(value: string): string[] {
	const trimmed = value.trim();
	if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
		return trimmed.length === 0 ? [] : [trimmed];
	}
	return trimmed
		.slice(1, -1)
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function parseFindingRecord(path: string): ParsedFindingRecord | null {
	const content = readFileSync(path, "utf-8");
	const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!match) {
		return null;
	}

	const values = new Map<string, string>();
	for (const line of match[1].split("\n")) {
		const separator = line.indexOf(":");
		if (separator === -1) {
			continue;
		}
		const key = line.slice(0, separator).trim();
		const value = line.slice(separator + 1).trim();
		values.set(key, value);
	}

	const id = values.get("id");
	const title = values.get("title");
	const status = values.get("status") as FindingStatus | undefined;
	const summary = values.get("summary");
	const reason = values.get("status_reason");
	const confidence = values.get("confidence") as FindingConfidence | undefined;
	const updatedAt = values.get("updated_at");
	if (
		!id ||
		!title ||
		!status ||
		!summary ||
		!reason ||
		!confidence ||
		!updatedAt
	) {
		return null;
	}

	return {
		id,
		title,
		status,
		summary,
		reason,
		targets: parseFrontmatterArray(values.get("targets") ?? "[]"),
		components: parseFrontmatterArray(values.get("components") ?? "[]"),
		symbols: parseFrontmatterArray(values.get("symbols") ?? "[]"),
		confidence,
		updatedAt,
		path,
		detailsMarkdown: undefined,
	};
}

function readFindingRecords(layout: ResearchWorkspaceLayout): ParsedFindingRecord[] {
	if (!existsSync(layout.findingsDir)) {
		return [];
	}

	const records: ParsedFindingRecord[] = [];
	for (const entry of readdirSync(layout.findingsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		const findingPath = join(layout.findingsDir, entry.name, "finding.md");
		if (!existsSync(findingPath)) {
			continue;
		}
		const record = parseFindingRecord(findingPath);
		if (record !== null) {
			records.push(record);
		}
	}

	return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function rebuildWorkspaceIndex(layout: ResearchWorkspaceLayout, records: ParsedFindingRecord[]): void {
	if (!existsSync(layout.indexDbPath)) {
		return;
	}

	const statements: string[] = [
		"BEGIN;",
		"DELETE FROM records;",
		"DELETE FROM edges;",
		"DELETE FROM record_fts;",
	];

	for (const record of records) {
		const body = [
			record.summary,
			record.reason,
			record.targets.join(" "),
			record.components.join(" "),
			record.symbols.join(" "),
		]
			.filter((entry) => entry.length > 0)
			.join("\n");

		statements.push(
			`INSERT INTO records (id, type, title, status, path, updated_at, body) VALUES (${sqlQuote(record.id)}, 'finding', ${sqlQuote(record.title)}, ${sqlQuote(record.status)}, ${sqlQuote(relativeToRoot(layout.root, record.path))}, ${sqlQuote(record.updatedAt)}, ${sqlQuote(body)});`,
		);
		statements.push(
			`INSERT INTO record_fts (id, title, body) VALUES (${sqlQuote(record.id)}, ${sqlQuote(record.title)}, ${sqlQuote(body)});`,
		);

		for (const target of record.targets) {
			statements.push(
				`INSERT OR IGNORE INTO edges (from_id, edge_type, to_id) VALUES (${sqlQuote(record.id)}, 'target', ${sqlQuote(target)});`,
			);
		}
		for (const component of record.components) {
			statements.push(
				`INSERT OR IGNORE INTO edges (from_id, edge_type, to_id) VALUES (${sqlQuote(record.id)}, 'component', ${sqlQuote(component)});`,
			);
		}
		for (const symbol of record.symbols) {
			statements.push(
				`INSERT OR IGNORE INTO edges (from_id, edge_type, to_id) VALUES (${sqlQuote(record.id)}, 'symbol', ${sqlQuote(symbol)});`,
			);
		}
	}

	statements.push("COMMIT;");
	runSqlite(layout.indexDbPath, statements.join("\n"));
}

export function syncFindingTracker(layout: ResearchWorkspaceLayout): void {
	ensureResearchWorkspaceLayout(layout);
	const records = readFindingRecords(layout);
	const section = buildManagedStatusSection(records);
	const existing = existsSync(layout.statusPath) ? readFileSync(layout.statusPath, "utf-8") : "";
	writeFileSync(layout.statusPath, insertManagedStatusSection(existing, section), "utf-8");
	rebuildWorkspaceIndex(layout, records);
}

function formatFrontmatterArray(values: string[]): string {
	return `[${values.join(", ")}]`;
}

export function findingPathForId(layout: ResearchWorkspaceLayout, id: string): string {
	return join(layout.findingsDir, id, "finding.md");
}

export function upsertFindingRecord(
	layout: ResearchWorkspaceLayout,
	input: FindingRecordInput,
): { findingPath: string; statusPath: string } {
	ensureResearchWorkspaceLayout(layout);

	const findingDir = join(layout.findingsDir, input.id);
	mkdirSync(join(findingDir, "evidence"), { recursive: true });
	mkdirSync(join(findingDir, "poc"), { recursive: true });

	const updatedAt = formatLocalDate(new Date());
	const normalizedSummary = input.summary.replace(/\s*\n\s*/g, " ").trim();
	const normalizedReason = input.reason.replace(/\s*\n\s*/g, " ").trim();
	const normalizedTargets = input.targets.map((value) => value.trim()).filter((value) => value.length > 0);
	const normalizedComponents = input.components.map((value) => value.trim()).filter((value) => value.length > 0);
	const normalizedSymbols = input.symbols.map((value) => value.trim()).filter((value) => value.length > 0);
	const body = [
		"---",
		`id: ${input.id}`,
		`title: ${input.title}`,
		"type: finding",
		`status: ${input.status}`,
		`summary: ${normalizedSummary}`,
		`status_reason: ${normalizedReason}`,
		`targets: ${formatFrontmatterArray(normalizedTargets)}`,
		`components: ${formatFrontmatterArray(normalizedComponents)}`,
		`symbols: ${formatFrontmatterArray(normalizedSymbols)}`,
		`confidence: ${input.confidence}`,
		`updated_at: ${updatedAt}`,
		"---",
		"",
		`# ${input.title}`,
		"",
		"## Summary",
		input.summary.trim(),
		"",
		"## Latest Status",
		`- State: ${input.status}`,
		`- Reason: ${input.reason.trim()}`,
		`- Updated: ${updatedAt}`,
	];

	if (input.detailsMarkdown && input.detailsMarkdown.trim().length > 0) {
		body.push("", "## Details", input.detailsMarkdown.trim());
	}

	const findingPath = join(findingDir, "finding.md");
	writeFileSync(findingPath, `${body.join("\n")}\n`, "utf-8");
	syncFindingTracker(layout);

	return {
		findingPath,
		statusPath: layout.statusPath,
	};
}

function normalizeLegacyRelativePath(relativePath: string): string {
	let nextValue = normalizePathSeparators(relativePath.trim());
	if (nextValue.startsWith("./")) {
		nextValue = nextValue.slice(2);
	}
	return nextValue;
}

function mapLegacyRelativePath(
	relativePath: string,
	layout: ResearchWorkspaceLayout,
): string | null {
	const normalized = normalizeLegacyRelativePath(relativePath);
	if (!normalized.startsWith("domains/")) {
		return null;
	}

	const segments = normalized.split("/").filter((segment) => segment.length > 0);
	const fileName = segments.at(-1);
	if (fileName === "FINDINGS.md") {
		return relativeToRoot(layout.root, layout.statusPath);
	}

	const targetIndex = segments.findIndex((segment) => segment === "targets");
	if (fileName === "TARGET.md" && targetIndex !== -1 && targetIndex + 1 < segments.length) {
		return normalizePathSeparators(join("entities", "targets", `${segments[targetIndex + 1]}.md`));
	}

	const bucketIndex = segments.findIndex(
		(segment, index) => index > 0 && LEGACY_SCRATCH_BUCKETS.has(segment),
	);
	if (bucketIndex === -1) {
		return null;
	}

	const bucket = LEGACY_SCRATCH_BUCKETS.get(segments[bucketIndex]) as ScratchBucket;
	const tail = segments.slice(bucketIndex + 1);
	return normalizePathSeparators(
		join(relativeToRoot(layout.root, layout.sessionDir), bucket, ...tail),
	);
}

function workspaceRelativePathForInput(
	value: string,
	cwd: string,
	layout: ResearchWorkspaceLayout,
): string | null {
	if (value.startsWith("domains/") || value.startsWith("./domains/")) {
		return normalizeLegacyRelativePath(value);
	}

	if (!isAbsoluteLike(value)) {
		const absolute = resolve(cwd, value);
		if (isWithinRoot(layout.root, absolute)) {
			return relativeToRoot(layout.root, absolute);
		}
		return null;
	}

	const absolute = resolve(expandHome(value));
	if (!isWithinRoot(layout.root, absolute)) {
		return null;
	}
	return relativeToRoot(layout.root, absolute);
}

export function rewriteLegacyWorkspacePath(
	value: string,
	cwd: string,
	layout: ResearchWorkspaceLayout,
): string | null {
	const relativePath = workspaceRelativePathForInput(value, cwd, layout);
	if (relativePath === null) {
		return null;
	}

	const rewrittenRelative = mapLegacyRelativePath(relativePath, layout);
	if (rewrittenRelative === null) {
		return null;
	}

	if (isAbsoluteLike(value)) {
		return join(layout.root, rewrittenRelative);
	}

	return rewrittenRelative;
}

export function rewriteLegacyWorkspaceText(
	value: string,
	cwd: string,
	layout: ResearchWorkspaceLayout,
): string {
	const rootPrefix = normalizePathSeparators(layout.root);
	const absolutePattern = new RegExp(
		`${escapeRegExp(rootPrefix)}/domains(?:/[^\\s"'()=]+)+`,
		"g",
	);

	let nextValue = value.replaceAll(absolutePattern, (match) => {
		return rewriteLegacyWorkspacePath(match, cwd, layout) ?? match;
	});

	nextValue = nextValue.replaceAll(
		/(^|[\s"'`(=])((?:\.\/)?domains(?:\/[^\s"'`()=]+)+)/g,
		(_match, prefix: string, token: string) => {
			return `${prefix}${rewriteLegacyWorkspacePath(token, cwd, layout) ?? token}`;
		},
	);

	return nextValue;
}

export function rewriteLegacyWorkspaceValueInPlace(
	value: unknown,
	cwd: string,
	layout: ResearchWorkspaceLayout,
): void {
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index++) {
			const currentValue = value[index];
			if (typeof currentValue === "string") {
				value[index] = rewriteLegacyWorkspaceText(currentValue, cwd, layout);
				continue;
			}
			rewriteLegacyWorkspaceValueInPlace(currentValue, cwd, layout);
		}
		return;
	}

	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		for (const key of Object.keys(record)) {
			const currentValue = record[key];
			if (typeof currentValue === "string") {
				record[key] = rewriteLegacyWorkspaceText(currentValue, cwd, layout);
				continue;
			}
			rewriteLegacyWorkspaceValueInPlace(currentValue, cwd, layout);
		}
	}
}

export function sanitizeNotebookForPrompt(
	notebook: Record<string, string>,
	cwd: string,
	layout: ResearchWorkspaceLayout,
): Record<string, string> {
	const nextNotebook: Record<string, string> = {};
	for (const [key, value] of Object.entries(notebook)) {
		nextNotebook[key] = rewriteLegacyWorkspaceText(value, cwd, layout);
	}
	return nextNotebook;
}

function disallowedWorkspaceWriteTargets(
	paths: string[],
	cwd: string,
	layout: ResearchWorkspaceLayout,
): string[] {
	const violations: string[] = [];

	for (const path of paths) {
		const absolutePath = resolveInputPath(path, cwd);
		if (!isWithinRoot(layout.root, absolutePath)) {
			continue;
		}
		if (isAllowedCurrentWorkspaceWritePath(path, cwd, layout)) {
			continue;
		}
		violations.push(relativeToRoot(layout.root, absolutePath));
	}

	return violations;
}

export function validateBashCommandForManagedWrites(
	command: string,
	cwd: string,
	layout: ResearchWorkspaceLayout,
): string | null {
	let segments: ShellToken[][];

	try {
		segments = splitShellCommand(command);
	} catch {
		return workspaceWriteGuardReason(layout, [
			"unable to validate bash write targets in this command",
		]);
	}

	let effectiveCwd = cwd;
	const violations: string[] = [];
	for (const segment of segments) {
		const segmentTargets = [...collectSegmentRedirectTargets(segment), ...collectSegmentCommandTargets(segment)];
		violations.push(...disallowedWorkspaceWriteTargets(segmentTargets, effectiveCwd, layout));
		effectiveCwd = resolveSegmentCwd(segment, effectiveCwd);
	}

	return violations.length > 0 ? workspaceWriteGuardReason(layout, violations) : null;
}

export function isAllowedCurrentWorkspaceWritePath(
	value: string,
	cwd: string,
	layout: ResearchWorkspaceLayout,
): boolean {
	const absolute = resolveInputPath(value, cwd);
	if (!isWithinRoot(layout.root, absolute)) {
		return true;
	}

	if (absolute === layout.statusPath) {
		return true;
	}

	const allowedRoots = [
		layout.sessionsDir,
		layout.entitiesDir,
		layout.findingsDir,
		layout.artifactsDir,
		layout.indexDir,
		layout.internalDir,
	];

	return allowedRoots.some((allowedRoot) => isWithinRoot(allowedRoot, absolute));
}

export function ensureParentDirectoryForWrite(
	value: string,
	cwd: string,
	layout: ResearchWorkspaceLayout,
): void {
	const absolute = resolveInputPath(value, cwd);
	if (!isWithinRoot(layout.root, absolute)) {
		return;
	}
	mkdirSync(dirname(absolute), { recursive: true });
}

export function describeResearchWorkspace(layout: ResearchWorkspaceLayout): string {
	return [
		"[Workspace Layout]",
		`Root: ${layout.root}`,
		`Current Session Scratch: ${relativeToRoot(layout.root, layout.sessionDir)}/`,
		"Current-workspace write targets:",
		`- Scratch notes and imports: ${relativeToRoot(layout.root, layout.sessionDir)}/notes.md and ${relativeToRoot(layout.root, layout.sessionDir)}/{recon,modeling,analysis,reports,poc,artifacts}/`,
		"- Canonical entities: entities/{targets,components,symbols}/<id>.md",
		"- Canonical findings: findings/<finding-id>/finding.md plus findings/<finding-id>/{evidence,poc}/",
		"- Top-level tracker: STATUS.md",
		"- Managed artifact store: artifacts/sha256/",
		"- Derived index: index/research.sqlite",
		"Rules:",
		"- The managed roots above are the only current-workspace write targets.",
		"- If older notes show a different layout, treat them as prior-art references; put new scratch work under the current session dir.",
		"- When a finding becomes durable or changes state, update findings/<finding-id>/finding.md and STATUS.md. Prefer the finding_status tool for this.",
	].join("\n");
}

export function workspaceWriteGuardReason(
	layout: ResearchWorkspaceLayout,
	violations?: string[],
): string {
	const parts = [
		"Current-workspace writes are restricted to the managed research layout.",
		`Use scratch under ${relativeToRoot(layout.root, layout.sessionDir)}/..., canonical findings under findings/<finding-id>/..., canonical entities under entities/{targets,components,symbols}/..., artifacts under artifacts/sha256/, and STATUS.md for the top-level tracker.`,
	];

	if (violations && violations.length > 0) {
		const uniqueViolations = [...new Set(violations)];
		parts.push(`Disallowed targets: ${uniqueViolations.slice(0, 5).join(", ")}.`);
	}

	return parts.join(" ");
}
