import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { isWorkspaceContextPath } from "../context.js";
import type { WorkspaceGraphEdgeInput, WorkspaceGraphNodeInput, WorkspaceGraphSeed } from "./store.js";

const IGNORED_DIRS = new Set([
	".git",
	".hg",
	".svn",
	".pire",
	"node_modules",
	"dist",
	"build",
	"out",
	"coverage",
	".next",
	".nuxt",
	".cache",
	"vendor",
	"target",
	".idea",
	".vscode",
]);

const INTERESTING_EXTENSIONS = new Set([
	".c",
	".cc",
	".cpp",
	".cxx",
	".h",
	".hh",
	".hpp",
	".hxx",
	".m",
	".mm",
	".rs",
	".go",
	".java",
	".kt",
	".swift",
	".py",
	".js",
	".jsx",
	".ts",
	".tsx",
	".php",
	".rb",
	".sh",
	".bash",
	".zsh",
	".l",
	".lex",
	".y",
	".yy",
	".json",
	".yml",
	".yaml",
	".toml",
	".xml",
	".html",
	".sql",
	".proto",
	".cfg",
	".conf",
	".ini",
	".md",
	".txt",
]);

const INTERESTING_FILENAMES = new Set([
	"makefile",
	"dockerfile",
	"build.sh",
	"cmakelists.txt",
	"meson.build",
	"cargo.toml",
	"go.mod",
	"package.json",
	"pom.xml",
	"security.md",
	"scope.md",
	"agents.md",
	"claude.md",
]);

const MAX_DIRS = 240;
const MAX_FILES = 900;
const MAX_SEEDED_FILES = 18;
const MAX_FILE_BYTES = 128 * 1024;
const SNIPPET_BYTES = 12 * 1024;
const LOW_SIGNAL_PATH_SEGMENTS = [
	"test",
	"tests",
	"testing",
	"regress",
	"regression",
	"example",
	"examples",
	"fixture",
	"fixtures",
	"mock",
	"mocks",
	"docs",
	"doc",
];
const PARSER_EXTENSIONS = new Set([".l", ".lex", ".y", ".yy"]);

interface PriorDefinition {
	kind: string;
	baseScore: number;
	patterns: string[];
}

interface SeedCandidate {
	node: WorkspaceGraphNodeInput;
	dir: string;
}

interface DirectoryAggregate {
	score: number;
	count: number;
	maxScore: number;
	tags: Set<string>;
	kindScores: Map<string, number>;
	files: string[];
}

const PRIOR_DEFINITIONS: PriorDefinition[] = [
	{
		kind: "auth_flow",
		baseScore: 3,
		patterns: ["auth", "login", "session", "token", "cookie", "oauth", "jwt", "password", "reset", "mfa", "sso"],
	},
	{
		kind: "parser",
		baseScore: 3,
		patterns: [
			"parse",
			"parser",
			"gram",
			"lex",
			"lexer",
			"grammar",
			"decode",
			"deserialize",
			"read",
			"load",
			"import",
			"upload",
			"pdf",
			"xml",
			"json",
			"yaml",
			"cmap",
			"image",
			"jpeg",
			"png",
			"zip",
			"tar",
		],
	},
	{
		kind: "entrypoint",
		baseScore: 2,
		patterns: ["fuzz", "main", "server", "daemon", "listener", "worker", "driver", "cli"],
	},
	{
		kind: "endpoint",
		baseScore: 2,
		patterns: ["route", "router", "handler", "controller", "request", "response", "http", "api", "rpc", "webhook"],
	},
	{
		kind: "boundary",
		baseScore: 3,
		patterns: [
			"admin",
			"root",
			"sudo",
			"setuid",
			"priv",
			"permission",
			"acl",
			"role",
			"sandbox",
			"daemon",
			"helper",
			"ipc",
			"xpc",
			"mach",
			"dbus",
			"bridge",
			"exec",
			"spawn",
			"shell",
			"command",
		],
	},
	{
		kind: "crypto",
		baseScore: 2,
		patterns: ["crypto", "cipher", "encrypt", "decrypt", "tls", "ssl", "cert", "key", "signature", "verify"],
	},
];

function clampScore(score: number): number {
	if (score >= 10) {
		return 5;
	}
	if (score >= 7) {
		return 4;
	}
	if (score >= 4) {
		return 3;
	}
	if (score >= 2) {
		return 2;
	}
	return 1;
}

function kindPriority(kind: string): number {
	switch (kind) {
		case "parser":
			return 5;
		case "auth_flow":
		case "endpoint":
		case "entrypoint":
			return 4;
		case "boundary":
		case "crypto":
			return 3;
		default:
			return 1;
	}
}

function unique(values: Iterable<string>): string[] {
	const seen = new Set<string>();
	const items: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		if (trimmed.length === 0) {
			continue;
		}
		const normalized = trimmed.toLowerCase();
		if (seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		items.push(trimmed);
	}
	return items;
}

function isInterestingFile(name: string): boolean {
	const lowerName = name.toLowerCase();
	return INTERESTING_FILENAMES.has(lowerName) || INTERESTING_EXTENSIONS.has(extname(lowerName));
}

function countMatches(haystack: string, patterns: string[]): string[] {
	return patterns.filter((pattern) => haystack.includes(pattern));
}

function applyLowSignalPenalty(path: string, score: number): number {
	const penalty = Math.min(countMatches(path, LOW_SIGNAL_PATH_SEGMENTS).length, 2);
	return Math.max(0, score - penalty);
}

function analyzeCandidate(workspaceRoot: string, filePath: string): SeedCandidate | null {
	const resolvedRoot = resolve(workspaceRoot);
	const resolvedFile = resolve(filePath);
	const relativePath = relative(resolvedRoot, resolvedFile);
	if (relativePath.startsWith("..")) {
		return null;
	}

	const stats = statSync(resolvedFile);
	if (stats.size > MAX_FILE_BYTES) {
		return null;
	}

	const lowerPath = relativePath.toLowerCase();
	if (isWorkspaceContextPath(relativePath)) {
		return null;
	}
	const kindScores = new Map<string, number>();
	const tags = new Set<string>();
	const reasons: string[] = [];

	for (const prior of PRIOR_DEFINITIONS) {
		const pathMatches = countMatches(lowerPath, prior.patterns);
		if (pathMatches.length === 0) {
			continue;
		}
		const contribution = prior.baseScore + Math.min(pathMatches.length - 1, 2);
		kindScores.set(prior.kind, (kindScores.get(prior.kind) ?? 0) + contribution);
		for (const match of pathMatches) {
			tags.add(match);
		}
		reasons.push(`${prior.kind}:${pathMatches.slice(0, 3).join("/")}`);
	}

	const lowerFileName = relativePath.split("/").at(-1)?.toLowerCase() ?? relativePath.toLowerCase();
	const fileExtension = extname(lowerFileName);
	if (PARSER_EXTENSIONS.has(fileExtension)) {
		tags.add("grammar");
		reasons.push(`parser-ext:${fileExtension}`);
		kindScores.set("parser", (kindScores.get("parser") ?? 0) + 4);
	}
	if (lowerFileName.includes("fuzz")) {
		tags.add("fuzz");
		reasons.push(`entry:${lowerFileName}`);
		kindScores.set("entrypoint", (kindScores.get("entrypoint") ?? 0) + 3);
	}
	if (INTERESTING_FILENAMES.has(lowerFileName)) {
		tags.add("build");
		reasons.push(`build:${lowerFileName}`);
		kindScores.set("boundary", (kindScores.get("boundary") ?? 0) + 1);
	}

	let snippet = "";
	if (kindScores.size > 0 || INTERESTING_FILENAMES.has(lowerFileName)) {
		try {
			snippet = readFileSync(resolvedFile, "utf-8").slice(0, SNIPPET_BYTES);
		} catch {
			snippet = "";
		}
	}

	if (snippet.length > 0) {
		const lowerSnippet = snippet.toLowerCase();
		for (const prior of PRIOR_DEFINITIONS) {
			const contentMatches = countMatches(lowerSnippet, prior.patterns);
			if (contentMatches.length === 0) {
				continue;
			}
			const contribution = Math.min(contentMatches.length, 3);
			kindScores.set(prior.kind, (kindScores.get(prior.kind) ?? 0) + contribution);
			for (const match of contentMatches.slice(0, 4)) {
				tags.add(match);
			}
		}
	}

	if (kindScores.size === 0) {
		return null;
	}

	const rankedKinds = [...kindScores.entries()].sort((left, right) => {
		if (right[1] !== left[1]) {
			return right[1] - left[1];
		}
		return left[0].localeCompare(right[0]);
	});
	const [kind, rankedScore] = rankedKinds[0];
	const rawScore = applyLowSignalPenalty(lowerPath, rankedScore);
	if (rawScore <= 0) {
		return null;
	}
	const score = clampScore(rawScore);
	const summary = `Seeded from workspace structure and priors: ${unique(reasons).join(", ")}`;
	const dir = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : ".";

	return {
		node: {
			id: `file:${relativePath}`,
			kind,
			label: relativePath,
			score,
			status: score >= 4 ? "hot" : "candidate",
			summary,
			text: snippet,
			tags: unique([kind, ...tags]),
			path: relativePath,
			source: "workspace_seed",
		},
		dir,
	};
}

function chooseDirectoryKind(kindScores: Map<string, number>): string {
	const ranked = [...kindScores.entries()].sort((left, right) => {
		if (right[1] !== left[1]) {
			return right[1] - left[1];
		}
		return left[0].localeCompare(right[0]);
	});
	return ranked[0]?.[0] ?? "module";
}

export function buildWorkspaceGraphSeed(workspaceRoot: string): WorkspaceGraphSeed {
	const resolvedRoot = resolve(workspaceRoot);
	const candidates: SeedCandidate[] = [];
	const directories = [resolvedRoot];
	let scannedDirs = 0;
	let scannedFiles = 0;

	while (directories.length > 0 && scannedDirs < MAX_DIRS && scannedFiles < MAX_FILES) {
		const currentDir = directories.shift();
		if (!currentDir) {
			break;
		}
		scannedDirs++;

		let entries: Dirent[];
		try {
			entries = readdirSync(currentDir, { withFileTypes: true });
		} catch {
			continue;
		}

		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (!IGNORED_DIRS.has(entry.name)) {
					directories.push(resolve(currentDir, entry.name));
				}
				continue;
			}
			if (!entry.isFile()) {
				continue;
			}
			if (!isInterestingFile(entry.name)) {
				continue;
			}

			const filePath = resolve(currentDir, entry.name);
			scannedFiles++;
			const candidate = analyzeCandidate(resolvedRoot, filePath);
			if (candidate) {
				candidates.push(candidate);
			}
			if (scannedFiles >= MAX_FILES) {
				break;
			}
		}
	}

	candidates.sort((left, right) => {
		const leftScore = left.node.score ?? 0;
		const rightScore = right.node.score ?? 0;
		if (rightScore !== leftScore) {
			return rightScore - leftScore;
		}
		const leftPriority = kindPriority(left.node.kind);
		const rightPriority = kindPriority(right.node.kind);
		if (rightPriority !== leftPriority) {
			return rightPriority - leftPriority;
		}
		return left.node.label.localeCompare(right.node.label);
	});

	const topCandidates = candidates.slice(0, MAX_SEEDED_FILES);
	const directoryAggregates = new Map<string, DirectoryAggregate>();
	for (const candidate of topCandidates) {
		if (candidate.dir === ".") {
			continue;
		}
		const aggregate = directoryAggregates.get(candidate.dir) ?? {
			score: 0,
			count: 0,
			maxScore: 0,
			tags: new Set<string>(),
			kindScores: new Map<string, number>(),
			files: [],
		};
		aggregate.score += candidate.node.score ?? 0;
		aggregate.count++;
		aggregate.maxScore = Math.max(aggregate.maxScore, candidate.node.score ?? 0);
		aggregate.files.push(candidate.node.id);
		for (const tag of candidate.node.tags ?? []) {
			aggregate.tags.add(tag);
		}
		aggregate.kindScores.set(
			candidate.node.kind,
			(aggregate.kindScores.get(candidate.node.kind) ?? 0) + (candidate.node.score ?? 0),
		);
		directoryAggregates.set(candidate.dir, aggregate);
	}

	const nodes: WorkspaceGraphNodeInput[] = topCandidates.map((candidate) => candidate.node);
	const edges: WorkspaceGraphEdgeInput[] = [];

	for (const [dir, aggregate] of [...directoryAggregates.entries()]
		.sort((left, right) => {
			if (right[1].score !== left[1].score) {
				return right[1].score - left[1].score;
			}
			return left[0].localeCompare(right[0]);
		})
		.slice(0, 8)) {
		if (aggregate.count < 2 && aggregate.maxScore < 4) {
			continue;
		}
		const moduleRawScore = aggregate.maxScore + Math.min(aggregate.count - 1, 2);
		const moduleId = `module:${dir}`;
		nodes.push({
			id: moduleId,
			kind: chooseDirectoryKind(aggregate.kindScores),
			label: dir,
			score: clampScore(moduleRawScore),
			status: moduleRawScore >= 5 ? "hot" : "candidate",
			summary: `Directory seeded from ${aggregate.count} nearby hot files`,
			tags: unique(aggregate.tags),
			path: dir,
			source: "workspace_seed",
		});
		for (const fileId of aggregate.files) {
			edges.push({
				from: moduleId,
				to: fileId,
				relation: "contains",
				weight: 1,
			});
			edges.push({
				from: fileId,
				to: moduleId,
				relation: "in_module",
				weight: 1,
			});
		}
	}

	return { nodes, edges };
}
