import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
	auditPireLiveLabSessionFile,
	classifyPireLiveLabAttempt,
	validatePireLiveLabInventory,
} from "../src/core/pire/live-labs.js";

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

	test("flags proof achieved via forbidden source reads as shortcut-proof", () => {
		const assessment = classifyPireLiveLabAttempt({
			kind: "agent-run",
			proofArtifacts: ["/tmp/root_flag.txt"],
			shortcutFindings: [
				{
					kind: "source-read",
					entryId: "entry-1",
					toolName: "read",
					path: "/tmp/src/vm_bytecode_snapshot.c",
					summary: "read tool accessed forbidden source path /tmp/src/vm_bytecode_snapshot.c",
				},
			],
		});

		expect(assessment.label).toBe("shortcut-proof");
		expect(assessment.issues).toContain("read tool accessed forbidden source path /tmp/src/vm_bytecode_snapshot.c");
	});

	test("audits session files for forbidden source reads", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "pire-live-lab-audit-"));
		const sessionPath = join(tempDir, "session.jsonl");
		await writeFile(
			sessionPath,
			[
				JSON.stringify({
					type: "session",
					version: 3,
					id: "session-1",
					timestamp: "2026-04-08T00:00:00.000Z",
					cwd: "/tmp/lab",
				}),
				JSON.stringify({
					type: "message",
					id: "entry-1",
					parentId: null,
					timestamp: "2026-04-08T00:00:01.000Z",
					message: {
						role: "assistant",
						content: [
							{
								type: "toolCall",
								name: "read",
								arguments: { path: "src/vm_bytecode_snapshot.c" },
							},
							{
								type: "toolCall",
								name: "bash",
								arguments: { command: "objdump -d src/vm_bytecode_snapshot.c" },
							},
						],
					},
				}),
			].join("\n"),
			"utf-8",
		);

		const findings = await auditPireLiveLabSessionFile(sessionPath, {
			labRoot: "/tmp/lab",
			forbiddenPaths: ["src/vm_bytecode_snapshot.c"],
		});

		expect(findings).toHaveLength(2);
		expect(findings[0]?.toolName).toBe("read");
		expect(findings[1]?.toolName).toBe("bash");
	});
});
