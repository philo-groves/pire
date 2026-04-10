import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ArtifactManifest } from "../../../.pire/extensions/pire/artifacts.js";
import {
	buildCampaignLedgerSummary,
	createEmptyCampaignLedger,
	upsertCampaignFinding,
} from "../../../.pire/extensions/pire/campaign.js";
import { addEvidence, addFinding, createEmptyFindingsTracker } from "../../../.pire/extensions/pire/findings.js";
import {
	assessReproBundle,
	buildNotebookDocument,
	generateReproBundle,
	ReproBundleAssessmentError,
	renderNotebookHtml,
	renderNotebookMarkdown,
	writeNotebookExport,
} from "../../../.pire/extensions/pire/reporting.js";
import { createDefaultSafetyPosture } from "../../../.pire/extensions/pire/safety.js";

describe("pire reporting helpers", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir) {
				await rm(dir, { recursive: true, force: true });
			}
		}
	});

	test("renders and writes notebook exports", async () => {
		const tracker = createEmptyFindingsTracker();
		const evidence = addEvidence(tracker, {
			summary: "binary_file captured ELF metadata",
			commandId: "tool:binary_file:toolu_01",
			artifactIds: ["artifact:/tmp/sample.bin"],
		});
		addFinding(tracker, {
			title: "Bounds check missing",
			statement: "A crafted frame can bypass bounds validation.",
			status: "confirmed",
			severity: "high",
			reproStatus: "reproduced",
			relatedEvidenceIds: [evidence.id],
			relatedArtifactIds: ["artifact:/tmp/sample.bin"],
			basis: [evidence.id],
		});
		const manifest: ArtifactManifest = {
			version: 1,
			updatedAt: "2026-04-06T00:00:00.000Z",
			artifacts: [
				{
					path: "/tmp/sample.bin",
					type: "binary",
					firstSeenAt: "2026-04-06T00:00:00.000Z",
					lastSeenAt: "2026-04-06T00:00:00.000Z",
					provenance: ["tool:binary_file"],
					relatedCommands: ["file -b /tmp/sample.bin"],
					relatedFindings: ["Bounds check missing"],
				},
			],
		};
		const campaign = createEmptyCampaignLedger();
		upsertCampaignFinding(campaign, {
			finding: tracker.findings[0]!,
			tracker,
			artifacts: manifest.artifacts,
		});

		const doc = buildNotebookDocument({
			cwd: "/tmp/project",
			mode: "report",
			safety: createDefaultSafetyPosture(),
			tracker,
			trackerSummary: {
				totalHypotheses: 0,
				openHypotheses: 0,
				supportedHypotheses: 0,
				refutedHypotheses: 0,
				totalFindings: 1,
				candidateFindings: 0,
				leadFindings: 0,
				activeFindings: 0,
				deEscalatedFindings: 0,
				reportCandidateFindings: 0,
				confirmedFindings: 1,
				closedFindings: 0,
				totalQuestions: 0,
				openQuestions: 0,
				blockedQuestions: 0,
				totalEvidence: 1,
				totalDeadEnds: 0,
				recentHypotheses: [],
				recentFindings: ["find-001 Bounds check missing"],
				recentQuestions: [],
			},
			manifest,
			activities: [
				{
					recordedAt: "2026-04-06T00:00:00.000Z",
					tool: "binary_file",
					target: "/tmp/sample.bin",
					summary: "Captured file metadata",
					artifacts: ["/tmp/sample.bin"],
				},
			],
			campaign,
			campaignSummary: buildCampaignLedgerSummary(campaign),
		});

		expect(renderNotebookMarkdown(doc)).toContain("## Campaign");
		expect(renderNotebookMarkdown(doc)).toContain("Bounds check missing");
		expect(renderNotebookMarkdown(doc)).toContain("## Timeline of Actions");
		expect(renderNotebookMarkdown(doc)).toContain("## Scope");
		expect(renderNotebookMarkdown(doc)).toContain("## Findings");
		expect(renderNotebookHtml(doc)).toContain("<h2>Campaign</h2>");
		expect(renderNotebookHtml(doc)).toContain("<details>");
		expect(renderNotebookHtml(doc)).toContain("Remediation Draft");

		const tempDir = mkdtempSync(join(tmpdir(), "pire-notebook-"));
		tempDirs.push(tempDir);
		const markdown = await writeNotebookExport(tempDir, doc, "markdown");
		const json = await writeNotebookExport(tempDir, doc, "json");
		const html = await writeNotebookExport(tempDir, doc, "html");
		expect(existsSync(markdown.path)).toBe(true);
		expect(existsSync(json.path)).toBe(true);
		expect(existsSync(html.path)).toBe(true);
	});

	test("generates a repro bundle with copied inputs when available", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pire-repro-"));
		tempDirs.push(tempDir);
		const samplePath = join(tempDir, "sample.bin");
		writeFileSync(samplePath, "pire sample\n", "utf-8");

		const tracker = createEmptyFindingsTracker();
		const evidence = addEvidence(tracker, {
			summary: "binary_file captured ELF metadata",
			commandId: "tool:binary_file:toolu_01",
			artifactIds: [`artifact:${samplePath}`],
		});
		const finding = addFinding(tracker, {
			title: "Bounds check missing",
			statement: "A crafted frame can bypass bounds validation.",
			status: "confirmed",
			severity: "high",
			reproStatus: "reproduced",
			relatedEvidenceIds: [evidence.id],
			relatedArtifactIds: [`artifact:${samplePath}`],
			basis: [evidence.id],
		});
		const manifest: ArtifactManifest = {
			version: 1,
			updatedAt: "2026-04-06T00:00:00.000Z",
			artifacts: [
				{
					path: samplePath,
					type: "binary",
					firstSeenAt: "2026-04-06T00:00:00.000Z",
					lastSeenAt: "2026-04-06T00:00:00.000Z",
					provenance: ["tool:binary_file"],
					relatedCommands: ["file -b sample.bin"],
					relatedFindings: ["Bounds check missing"],
				},
			],
		};

		const bundle = await generateReproBundle({
			cwd: tempDir,
			mode: "proofing",
			safety: createDefaultSafetyPosture(),
			tracker,
			manifest,
			finding,
		});
		expect(existsSync(bundle.readmePath)).toBe(true);
		expect(existsSync(bundle.commandsPath)).toBe(true);
		expect(existsSync(bundle.manifestPath)).toBe(true);
		expect(bundle.files[0]?.bundledPath).toBeTruthy();
		expect(bundle.files[0]?.status).toBe("bundled");
		expect(bundle.assessment.readiness).toBe("ready");
		expect(bundle.assessment.validationNotes.some((note) => note.includes("artifact"))).toBe(true);
		const readme = await readFile(bundle.readmePath, "utf-8");
		expect(readme).toContain("Bounds check missing");
		expect(readme).toContain("Readiness: ready");
		expect(readme).toContain("## Validation Notes");
	});

	test("assesses incomplete findings and refuses repro bundles by default", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pire-repro-"));
		tempDirs.push(tempDir);

		const tracker = createEmptyFindingsTracker();
		const finding = addFinding(tracker, {
			title: "Suspicious parser state",
			statement: "Static review suggests unsafe parser behavior.",
			status: "lead",
			severity: "medium",
			reproStatus: "not-reproduced",
		});
		const manifest: ArtifactManifest = {
			version: 1,
			updatedAt: "2026-04-06T00:00:00.000Z",
			artifacts: [],
		};

		const assessment = assessReproBundle({
			tracker,
			manifest,
			finding,
		});
		expect(assessment.readiness).toBe("insufficient");
		expect(assessment.issues.some((issue) => issue.includes("require confirmed"))).toBe(true);

		await expect(
			generateReproBundle({
				cwd: tempDir,
				mode: "proofing",
				safety: createDefaultSafetyPosture(),
				tracker,
				manifest,
				finding,
			}),
		).rejects.toBeInstanceOf(ReproBundleAssessmentError);
	});
});
