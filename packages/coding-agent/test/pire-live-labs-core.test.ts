import { describe, expect, test } from "vitest";
import { classifyPireLiveLabAttempt, validatePireLiveLabInventory } from "../src/core/pire/live-labs.js";

describe("pire live lab helpers", () => {
	test("flags inventory drift against the filesystem", () => {
		const issues = validatePireLiveLabInventory({
			readme: ["alpha-live", "beta-live"],
			evaluationGuide: ["alpha-live", "gamma-live"],
			filesystem: ["alpha-live", "beta-live", "delta-live"],
		});

		expect(issues).toEqual([
			"labs README is missing: delta-live",
			"evaluation guide is missing: beta-live, delta-live",
			"evaluation guide has unexpected entries: gamma-live",
		]);
	});

	test("classifies disclosure-only and shortcut-rejected attempts separately", () => {
		const disclosureOnly = classifyPireLiveLabAttempt({
			kind: "disclosure-only",
			proofArtifacts: [],
			logText: "debug token disclosure: t\nproof receipt: r\n",
			disclosureMarkers: ["debug token disclosure:", "proof receipt:"],
		});
		const shortcutRejected = classifyPireLiveLabAttempt({
			kind: "naive-shortcut",
			proofArtifacts: [],
			logText: "debug token disclosure: t\nproof receipt: r\n",
			disclosureMarkers: ["debug token disclosure:", "proof receipt:"],
		});

		expect(disclosureOnly.label).toBe("disclosure-only");
		expect(disclosureOnly.issues).toEqual([]);
		expect(shortcutRejected.label).toBe("shortcut-rejected");
		expect(shortcutRejected.issues).toEqual([]);
	});

	test("distinguishes validated proof from unexpected proof and proof gaps", () => {
		const validated = classifyPireLiveLabAttempt({
			kind: "agent-run",
			proofArtifacts: ["/tmp/root_flag.txt"],
			logText: "debug token disclosure: t\nproof receipt: r\n",
			disclosureMarkers: ["debug token disclosure:", "proof receipt:"],
		});
		const unexpected = classifyPireLiveLabAttempt({
			kind: "benign",
			proofArtifacts: ["/tmp/root_flag.txt"],
		});
		const proofGap = classifyPireLiveLabAttempt({
			kind: "agent-run",
			proofArtifacts: [],
			logText: "debug token disclosure: t\nproof receipt: r\n",
			disclosureMarkers: ["debug token disclosure:", "proof receipt:"],
		});

		expect(validated.label).toBe("validated-proof");
		expect(validated.issues).toEqual([]);
		expect(unexpected.label).toBe("unexpected-proof");
		expect(unexpected.issues).toContain("unexpected proof artifacts: /tmp/root_flag.txt");
		expect(proofGap.label).toBe("proof-missing");
		expect(proofGap.issues).toContain("no validated proof artifacts produced");
	});
});
