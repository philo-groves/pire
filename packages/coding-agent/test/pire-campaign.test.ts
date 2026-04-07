import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ArtifactRecord } from "../../../.pire/extensions/pire/artifacts.js";
import {
	appendCampaignJournalEntry,
	buildCampaignLedgerSummary,
	createEmptyCampaignLedger,
	loadCampaignLedger,
	mapFindingStatusToCampaignStatus,
	renderCampaignDetail,
	saveCampaignLedger,
	summarizeCampaignLedger,
	updateCampaignFindingStatus,
	upsertCampaignFinding,
} from "../../../.pire/extensions/pire/campaign.js";
import {
	addEvidence,
	addFinding,
	buildArtifactRef,
	createEmptyFindingsTracker,
} from "../../../.pire/extensions/pire/findings.js";

describe("pire campaign ledger helpers", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir) {
				await rm(dir, { recursive: true, force: true });
			}
		}
	});

	test("syncs session findings into a mutable campaign ledger", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pire-campaign-"));
		tempDirs.push(tempDir);
		const tracker = createEmptyFindingsTracker();
		const evidence = addEvidence(tracker, {
			summary: "Observed parser read past the bounded sample buffer",
			commandId: "tool:binary_file:toolu_01",
			artifactIds: [buildArtifactRef("/tmp/sample.bin")],
		});
		const finding = addFinding(tracker, {
			title: "Out-of-bounds read in parse_frame()",
			statement: "A crafted frame reads past the parser buffer.",
			status: "confirmed",
			severity: "high",
			reproStatus: "reproduced",
			relatedEvidenceIds: [evidence.id],
			relatedArtifactIds: [buildArtifactRef("/tmp/sample.bin")],
			basis: [evidence.id],
		});
		const artifacts: ArtifactRecord[] = [
			{
				path: "/tmp/sample.bin",
				type: "binary",
				firstSeenAt: "2026-04-06T00:00:00.000Z",
				lastSeenAt: "2026-04-06T00:00:00.000Z",
				provenance: ["tool:binary_file"],
				relatedCommands: ["binary_file /tmp/sample.bin"],
				relatedFindings: [finding.id],
			},
		];

		const ledger = createEmptyCampaignLedger();
		const synced = upsertCampaignFinding(ledger, { finding, tracker, artifacts });
		expect(synced.created).toBe(true);
		expect(mapFindingStatusToCampaignStatus(finding)).toBe("confirmed");
		expect(ledger.findings[0]).toMatchObject({
			id: finding.id,
			status: "confirmed",
			title: "Out-of-bounds read in parse_frame()",
		});
		expect(ledger.findings[0]?.relatedEvidenceIds).toEqual([evidence.id]);
		expect(ledger.findings[0]?.relatedArtifactIds).toEqual(["/tmp/sample.bin"]);

		const changed = updateCampaignFindingStatus(ledger, {
			id: finding.id,
			status: "de-escalated",
			note: "Refuted after reproducer proved the read stayed in-bounds on device.",
		});
		expect(changed?.status).toBe("de-escalated");
		expect(changed?.note).toContain("Refuted");

		const journal = await appendCampaignJournalEntry(tempDir, ledger, {
			findingId: finding.id,
			action: "status",
			summary: "Set find-001 to de-escalated",
			details: changed?.note,
		});
		const paths = await saveCampaignLedger(tempDir, ledger);
		const reloaded = await loadCampaignLedger(tempDir);
		const statusMarkdown = await readFile(paths.statusPath, "utf-8");
		const journalMarkdown = await readFile(journal.path, "utf-8");

		expect(paths.jsonPath).toContain(".pire/campaign.json");
		expect(paths.statusPath).toContain(".pire/STATUS.md");
		expect(reloaded.findings[0]?.status).toBe("de-escalated");
		expect(buildCampaignLedgerSummary(reloaded).deEscalatedFindings).toBe(1);
		expect(summarizeCampaignLedger(reloaded)).toContain("de-escalated: 1");
		expect(renderCampaignDetail(reloaded, finding.id)).toContain("Refuted after reproducer");
		expect(statusMarkdown).toContain("Pire Campaign Status");
		expect(statusMarkdown).toContain("de-escalated");
		expect(journalMarkdown).toContain("# Pire Campaign Journal");
		expect(journalMarkdown).toContain("Set find-001 to de-escalated");
	});
});
