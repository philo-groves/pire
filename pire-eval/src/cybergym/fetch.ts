/**
 * Lazy-fetch data for a single CyberGym task
 *
 * Downloads HuggingFace data files and pulls Docker images on demand.
 * Provides cleanup functions to free disk after each task.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWriteStream, mkdirSync, existsSync, rmSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, extname, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { CyberGymTask, DifficultyLevel, TaskImages, TaskWorkspace } from "./types.js";

const execFileAsync = promisify(execFile);

const HF_BASE_URL =
	"https://huggingface.co/datasets/sunblaze-ucb/cybergym/resolve/main";

const SOURCE_FILE_EXTENSIONS = new Set([".c", ".cc", ".cpp", ".cxx", ".h", ".hpp"]);
const MAX_HINT_FILE_SIZE = 256 * 1024;

interface EntrypointCandidate {
	path: string;
	score: number;
}

function tokenizeBuildTargetLine(line: string): string[] {
	return line
		.replace(/#.*/, "")
		.trim()
		.split(/\s+/)
		.map((token) => token.replace(/^["']|["']$/g, "").trim())
		.filter((token) => token.length > 0);
}

function extractBuildTargets(scriptContent: string): string[] {
	const targets = new Set<string>();
	const lines = scriptContent.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]?.replace(/#.*/, "").trim();
		if (!line) continue;

		const arrayStart = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=\($/);
		if (arrayStart) {
			const variableName = arrayStart[1]?.toLowerCase() ?? "";
			const arrayItems: string[] = [];
			while (++i < lines.length) {
				const entryLine = lines[i]?.replace(/#.*/, "").trim() ?? "";
				if (entryLine === ")") break;
				arrayItems.push(...tokenizeBuildTargetLine(entryLine));
			}
			if (/fuzzer|target|binar/.test(variableName)) {
				for (const item of arrayItems) {
					if (!/[${}[@]]/.test(item)) targets.add(item);
				}
			}
			continue;
		}

		const ninjaMatch = line.match(/^ninja\s+(.+)$/);
		if (ninjaMatch?.[1]) {
			for (const item of tokenizeBuildTargetLine(ninjaMatch[1])) {
				if (item !== "clean" && !item.startsWith("-") && !/[${}[@]]/.test(item)) {
					targets.add(item);
				}
			}
		}

		for (const match of line.matchAll(/\btools\/([A-Za-z0-9_.-]+)/g)) {
			const target = match[1]?.trim();
			if (target) targets.add(target);
		}
	}

	return [...targets].sort((left, right) => left.localeCompare(right));
}

function getImageNames(task: CyberGymTask): TaskImages {
	if (task.taskType === "arvo") {
		return {
			vul: `n132/arvo:${task.numericId}-vul`,
			fix: `n132/arvo:${task.numericId}-fix`,
		};
	}
	// oss-fuzz and oss-fuzz-latest
	return {
		vul: `cybergym/oss-fuzz:${task.numericId}-vul`,
		fix: `cybergym/oss-fuzz:${task.numericId}-fix`,
	};
}

/**
 * Download a single file from HuggingFace to a local path.
 */
async function downloadFile(hfPath: string, destPath: string): Promise<void> {
	const url = `${HF_BASE_URL}/${hfPath}`;
	const response = await fetch(url, { redirect: "follow" });
	if (!response.ok) {
		throw new Error(`Failed to download ${hfPath}: ${response.status}`);
	}
	if (!response.body) throw new Error(`No response body for ${hfPath}`);

	const dir = join(destPath, "..");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const dest = createWriteStream(destPath);
	await pipeline(Readable.fromWeb(response.body as any), dest);
}

function listFilesRecursive(rootDir: string): string[] {
	const files: string[] = [];
	const pending = [rootDir];

	while (pending.length > 0) {
		const dir = pending.pop();
		if (!dir) continue;

		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				pending.push(fullPath);
				continue;
			}
			if (entry.isFile()) files.push(fullPath);
		}
	}

	return files;
}

function toRelativePath(rootDir: string, filePath: string): string {
	return relative(rootDir, filePath).replace(/\\/g, "/");
}

function scoreEntrypointCandidate(
	rootDir: string,
	filePath: string,
	buildTargets: Set<string>,
): EntrypointCandidate | undefined {
	const relPath = toRelativePath(rootDir, filePath);
	const lowerRelPath = relPath.toLowerCase();
	const lowerName = basename(filePath).toLowerCase();
	const lowerStem = basename(filePath, extname(filePath)).toLowerCase();
	let score = 0;

	if (/fuzz|fuzzer|harness|driver/.test(lowerName)) score += 20;
	if (/fuzz|fuzzer|harness|driver/.test(lowerRelPath)) score += 10;
	if (buildTargets.has(lowerStem)) score += 200;
	if (buildTargets.has(lowerName)) score += 100;
	if (lowerRelPath.includes("/tools/") && buildTargets.has(lowerStem)) score += 40;

	if (!SOURCE_FILE_EXTENSIONS.has(extname(lowerName))) {
		return score > 0 ? { path: relPath, score } : undefined;
	}

	try {
		const content = readFileSync(filePath, "utf-8");
		if (/LLVMFuzzerTestOneInput/.test(content)) score += 100;
		if (/LLVMFuzzerInitialize/.test(content)) score += 40;
		if (/\bmain\s*\(/.test(content)) score += 10;
		if (/honggfuzz|libfuzzer|afl/i.test(content)) score += 10;
	} catch {
		return score > 0 ? { path: relPath, score } : undefined;
	}

	return score > 0 ? { path: relPath, score } : undefined;
}

function discoverWorkspaceHints(
	sourceDir: string,
): Pick<TaskWorkspace, "buildScripts" | "buildTargets" | "entrypointHints"> {
	const buildScripts: string[] = [];
	const candidates: EntrypointCandidate[] = [];
	const buildTargets = new Set<string>();
	const files = listFilesRecursive(sourceDir);

	for (const filePath of files) {
		const relPath = toRelativePath(sourceDir, filePath);
		if (basename(filePath) === "build.sh") {
			buildScripts.push(relPath);
			try {
				for (const target of extractBuildTargets(readFileSync(filePath, "utf-8"))) {
					buildTargets.add(target.toLowerCase());
				}
			} catch {
				// Ignore build script parse failures.
			}
		}
	}

	for (const filePath of files) {
		let size = 0;
		try {
			size = statSync(filePath).size;
		} catch {
			continue;
		}
		if (size > MAX_HINT_FILE_SIZE) continue;

		const candidate = scoreEntrypointCandidate(sourceDir, filePath, buildTargets);
		if (candidate) candidates.push(candidate);
	}

	candidates.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
	buildScripts.sort((left, right) => left.localeCompare(right));

	return {
		buildScripts,
		buildTargets: [...buildTargets].sort((left, right) => left.localeCompare(right)),
		entrypointHints: candidates.slice(0, 5).map((candidate) => candidate.path),
	};
}

/**
 * Download all data files for a task at a given difficulty level.
 * Extracts tar.gz archives. Returns the workspace layout.
 */
export async function fetchTaskData(
	task: CyberGymTask,
	difficulty: DifficultyLevel,
	workDir: string,
): Promise<TaskWorkspace> {
	const taskDir = join(workDir, task.taskId.replace(":", "-"));
	if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true });

	const filePaths = task.filePaths[difficulty];
	const sourceDir = join(taskDir, "source");
	let description: string | undefined;
	let errorTrace: string | undefined;
	let patchPath: string | undefined;

	for (const hfPath of filePaths) {
		const filename = basename(hfPath);
		const localPath = join(taskDir, filename);

		process.stderr.write(`  Downloading ${filename}...`);
		await downloadFile(hfPath, localPath);
		process.stderr.write(" done\n");

		if (filename === "repo-vul.tar.gz") {
			if (!existsSync(sourceDir)) mkdirSync(sourceDir, { recursive: true });
			await execFileAsync("tar", ["xzf", localPath, "-C", sourceDir], { timeout: 120000 });
		} else if (filename === "repo-fix.tar.gz") {
			const fixDir = join(taskDir, "source-fix");
			if (!existsSync(fixDir)) mkdirSync(fixDir, { recursive: true });
			await execFileAsync("tar", ["xzf", localPath, "-C", fixDir], { timeout: 120000 });
		} else if (filename === "description.txt") {
			description = readFileSync(localPath, "utf-8");
		} else if (filename === "error.txt") {
			errorTrace = readFileSync(localPath, "utf-8");
		} else if (filename === "patch.diff") {
			patchPath = localPath;
		}
	}

	const { buildScripts, buildTargets, entrypointHints } = discoverWorkspaceHints(sourceDir);

	return {
		dir: taskDir,
		sourceDir,
		pocPath: join(taskDir, "poc"),
		description,
		errorTrace,
		patchPath,
		buildScripts,
		buildTargets,
		entrypointHints,
	};
}

/**
 * Pull Docker images for a task. Returns the image names.
 */
export async function pullImages(task: CyberGymTask): Promise<TaskImages> {
	const images = getImageNames(task);

	process.stderr.write(`  Pulling ${images.vul}...`);
	await execFileAsync("docker", ["pull", images.vul], { timeout: 600000 });
	process.stderr.write(" done\n");

	process.stderr.write(`  Pulling ${images.fix}...`);
	await execFileAsync("docker", ["pull", images.fix], { timeout: 600000 });
	process.stderr.write(" done\n");

	return images;
}

/**
 * Remove Docker images for a task to free disk space.
 */
export async function removeImages(images: TaskImages): Promise<void> {
	try {
		await execFileAsync("docker", ["rmi", "-f", images.vul, images.fix], {
			timeout: 30000,
		});
	} catch {
		// Best effort
	}
}

/**
 * Remove workspace data files for a task.
 */
export function removeWorkspace(workspace: TaskWorkspace): void {
	try {
		rmSync(workspace.dir, { recursive: true, force: true });
	} catch {
		// Best effort
	}
}

export { getImageNames };
