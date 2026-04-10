import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	addEvidence,
	addFinding,
	addHypothesis,
	addQuestion,
	buildArtifactRef,
	buildFindingsPromptSummary,
	buildFindingsTrackerSummary,
	buildFindingsWidgetLines,
	createEmptyFindingsTracker,
	loadFindingsTracker,
	saveFindingsTracker,
	summarizeFindingsTracker,
	updateHypothesis,
} from "../../../.pire/extensions/pire/findings.js";

describe("pire findings tracker helpers", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir) {
				await rm(dir, { recursive: true, force: true });
			}
		}
	});

	test("creates linked tracker records and summaries", () => {
		const tracker = createEmptyFindingsTracker();
		const question = addQuestion(tracker, { prompt: "Can attacker input reach parse_frame()?", status: "blocked" });
		const hypothesis = addHypothesis(tracker, {
			title: "Length field reaches parser copy loop",
			claim: "The packet length field can drive an unchecked copy.",
			relatedQuestionIds: [question.id],
		});
		const evidence = addEvidence(tracker, {
			summary: "binary_objdump shows memcpy reached from parse_frame",
			commandId: "tool:binary_objdump:toolu_01",
			artifactIds: [buildArtifactRef("/tmp/sample.bin")],
			supports: [hypothesis.id],
		});
		updateHypothesis(tracker, {
			id: hypothesis.id,
			status: "supported",
			addEvidenceIds: [evidence.id],
			addArtifactIds: [buildArtifactRef("/tmp/sample.bin")],
		});
		addFinding(tracker, {
			title: "Out-of-bounds read in parse_frame()",
			statement: "A crafted frame triggers an out-of-bounds read before checksum validation.",
			status: "confirmed",
			severity: "high",
			reproStatus: "reproduced",
			relatedEvidenceIds: [evidence.id],
			relatedArtifactIds: [buildArtifactRef("/tmp/sample.bin")],
			basis: [evidence.id],
		});

		const summary = buildFindingsTrackerSummary(tracker);
		expect(summary.openHypotheses).toBe(0);
		expect(summary.supportedHypotheses).toBe(1);
		expect(summary.confirmedFindings).toBe(1);
		expect(summary.blockedQuestions).toBe(1);

		const text = summarizeFindingsTracker(tracker);
		expect(text).toContain("hypotheses: 1");
		expect(text).toContain(hypothesis.id);
		expect(text).toContain(evidence.id);

		const widgetLines = buildFindingsWidgetLines(tracker);
		expect(widgetLines[0]).toBe("Pire Tracker");
		expect(widgetLines.some((line) => line.includes("confirmed: 1"))).toBe(true);

		const promptSummary = buildFindingsPromptSummary(tracker, {
			activeHypothesisIds: [hypothesis.id],
			activeQuestionIds: [question.id],
		});
		expect(promptSummary).toContain("[PIRE TRACKER]");
		expect(promptSummary).toContain("Active focus:");
		expect(promptSummary).toContain(`hypothesis ${hypothesis.id}`);
		expect(promptSummary).toContain(`question ${question.id}`);
		expect(promptSummary).toContain("Confirmed findings:");
		expect(promptSummary).toContain(question.id);
		expect(promptSummary).toContain("Evidence linked to active focus:");
		expect(promptSummary).toContain(evidence.id);
	});

	test("saves JSON and markdown mirrors", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pire-findings-"));
		tempDirs.push(tempDir);
		const tracker = createEmptyFindingsTracker();
		addHypothesis(tracker, {
			title: "Header parser trusts count field",
			claim: "The count field controls a loop without a guard.",
		});

		const paths = await saveFindingsTracker(tempDir, tracker);
		const reloaded = await loadFindingsTracker(tempDir);
		const markdown = await readFile(paths.markdownPath, "utf-8");

		expect(paths.jsonPath).toContain(".pire/session/findings.json");
		expect(paths.markdownPath).toContain(".pire/session/findings.md");
		expect(reloaded.hypotheses).toHaveLength(1);
		expect(markdown).toContain("# Pire Tracker");
		expect(markdown).toContain("Header parser trusts count field");
	});
});
