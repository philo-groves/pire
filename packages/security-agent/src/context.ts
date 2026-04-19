import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface WorkspaceContextFile {
	path: string;
	content: string;
}

export const CONTEXT_FILENAMES = ["AGENTS.md", "CLAUDE.md", "SECURITY.md", "SCOPE.md"] as const;
const CONTEXT_FILENAME_PATTERN = new RegExp(`(^|[\\\\/:\\s])(${CONTEXT_FILENAMES.join("|")})\\b`, "i");
const WORKSPACE_ROOT_MARKERS = [
	".git",
	".pire",
	"build.sh",
	"CMakeLists.txt",
	"Makefile",
	"meson.build",
	"package.json",
	"Cargo.toml",
	"go.mod",
	"pyproject.toml",
	"setup.py",
];

function loadContextFileFromDir(dir: string): WorkspaceContextFile | null {
	for (const filename of CONTEXT_FILENAMES) {
		const filePath = join(dir, filename);
		if (!existsSync(filePath)) {
			continue;
		}

		try {
			return {
				path: filePath,
				content: readFileSync(filePath, "utf-8"),
			};
		} catch {
			return null;
		}
	}

	return null;
}

function hasWorkspaceMarker(dir: string): boolean {
	for (const marker of WORKSPACE_ROOT_MARKERS) {
		if (existsSync(join(dir, marker))) {
			return true;
		}
	}
	return false;
}

export function containsWorkspaceContextReference(value: string): boolean {
	return CONTEXT_FILENAME_PATTERN.test(value);
}

export function isWorkspaceContextPath(filePath: string): boolean {
	return containsWorkspaceContextReference(filePath);
}

export function detectWorkspaceRoot(cwd: string): string {
	const resolvedCwd = resolve(cwd);
	const root = resolve("/");
	let currentDir = resolvedCwd;

	while (true) {
		if (hasWorkspaceMarker(currentDir) || loadContextFileFromDir(currentDir)) {
			return currentDir;
		}

		if (currentDir === root) {
			return resolvedCwd;
		}

		const parentDir = resolve(currentDir, "..");
		if (parentDir === currentDir) {
			return resolvedCwd;
		}
		currentDir = parentDir;
	}
}

export function loadWorkspaceContextFiles(cwd: string, workspaceRoot?: string): WorkspaceContextFile[] {
	const resolvedCwd = resolve(cwd);
	const resolvedWorkspaceRoot = workspaceRoot ? resolve(workspaceRoot) : detectWorkspaceRoot(resolvedCwd);
	const files: WorkspaceContextFile[] = [];
	const seen = new Set<string>();
	let currentDir = resolvedCwd;

	while (true) {
		const contextFile = loadContextFileFromDir(currentDir);
		if (contextFile && !seen.has(contextFile.path)) {
			files.unshift(contextFile);
			seen.add(contextFile.path);
		}

		if (currentDir === resolvedWorkspaceRoot) {
			break;
		}

		const parentDir = resolve(currentDir, "..");
		if (parentDir === currentDir) {
			break;
		}
		currentDir = parentDir;
	}

	return files;
}

export interface InjectedContextOptions {
	cwd: string;
	contextFiles: WorkspaceContextFile[];
	recommendedActionsText?: string;
	notebookText: string;
	surfaceMapText: string;
	logicMapText: string;
	workspaceGraphText: string;
}

export function resolveWorkspaceRoot(
	cwd: string,
	contextFiles: WorkspaceContextFile[],
	workspaceRoot?: string,
): string {
	const explicitRoot = workspaceRoot;
	if (explicitRoot) {
		return resolve(explicitRoot);
	}

	const detectedRoot = detectWorkspaceRoot(cwd);
	if (contextFiles.length === 0) {
		return detectedRoot;
	}

	const contextRoot = dirname(contextFiles[0].path);
	if (contextRoot.startsWith(detectedRoot)) {
		return contextRoot;
	}
	return detectedRoot;
}

export function formatInjectedContext(options: InjectedContextOptions): string {
	const sections = ["[Workspace Context]", `Current working directory: ${options.cwd}`];

	if (options.contextFiles.length === 0) {
		sections.push("", "No workspace context files found.");
	} else {
		sections.push("", "Context files:");
		for (const file of options.contextFiles) {
			sections.push("", `## ${file.path}`, "", file.content);
		}
	}

	if (options.recommendedActionsText?.trim()) {
		sections.push(
			"",
			"[Recommended Actions]",
			"Use these option labels if the user refers to a startup recommendation by letter or number. Numeric aliases follow list order: 1=A, 2=B, 3=C, and so on.",
			"",
			options.recommendedActionsText,
		);
	}

	sections.push("", options.notebookText);
	sections.push("", options.surfaceMapText);
	sections.push("", options.logicMapText);
	sections.push("", options.workspaceGraphText);

	return sections.join("\n");
}
