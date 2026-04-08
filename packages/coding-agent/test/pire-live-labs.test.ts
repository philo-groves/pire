import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = process.cwd();
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const LABS_ROOT = join(REPO_ROOT, "labs");

async function listLabDirectories(): Promise<string[]> {
	const entries = await readdir(LABS_ROOT, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((name) => name.endsWith("-live"))
		.sort();
}

function extractSection(text: string, startMarker: string, endMarker: string): string {
	const start = text.indexOf(startMarker);
	const end = text.indexOf(endMarker, start);
	if (start < 0 || end < 0 || end <= start) {
		throw new Error(`could not extract section between "${startMarker}" and "${endMarker}"`);
	}
	return text.slice(start, end);
}

function extractLabBullets(section: string): string[] {
	return Array.from(section.matchAll(/- `([^`]+-live)`/g), (match) => match[1] ?? "").filter(Boolean);
}

async function listProofArtifacts(root: string): Promise<string[]> {
	const found: string[] = [];
	async function walk(dir: string): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(path);
				continue;
			}
			if (
				entry.name.endsWith("flag.txt") ||
				entry.name === "host_flag.txt" ||
				entry.name === "service_flag.txt" ||
				entry.name === "root_flag.txt"
			) {
				found.push(path);
			}
		}
	}
	await walk(root);
	return found.sort();
}

describe("pire live labs", () => {
	test("keeps live-lab inventory in sync across docs and filesystem", async () => {
		const labsReadme = await readFile(join(REPO_ROOT, "labs", "README.md"), "utf-8");
		const evaluationGuide = await readFile(join(REPO_ROOT, "EVALUATION.md"), "utf-8");
		const labDirs = await listLabDirectories();

		const readmeSection = extractSection(labsReadme, "Current labs:", "Recommended workflow:");
		const evaluationSection = extractSection(
			evaluationGuide,
			"Current live labs under `labs/` include:",
			"### 3. Real-Task Sessions",
		);

		expect(extractLabBullets(readmeSection).sort()).toEqual(labDirs);
		expect(extractLabBullets(evaluationSection).sort()).toEqual(labDirs);
	});

	test("builds, resets, and keeps the benign path proof-free for every live lab", async () => {
		const labDirs = await listLabDirectories();

		for (const lab of labDirs) {
			await execFileAsync("make", ["-C", join(LABS_ROOT, lab), "build"], {
				cwd: REPO_ROOT,
			});
			await execFileAsync("make", ["-C", join(LABS_ROOT, lab), "reset"], {
				cwd: REPO_ROOT,
			});
			await execFileAsync("make", ["-C", join(LABS_ROOT, lab), "run-benign"], {
				cwd: REPO_ROOT,
			});

			const proofArtifacts = await listProofArtifacts(join(LABS_ROOT, lab, "runtime"));
			expect(proofArtifacts, `${lab} emitted proof artifacts on benign path`).toEqual([]);
		}
	}, 120000);
});
