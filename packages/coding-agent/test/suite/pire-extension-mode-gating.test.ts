import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall, type Message, type TextContent } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it } from "vitest";
import pireExtension from "../../../../.pire/extensions/pire/index.js";
import { createHarness, getAssistantTexts, type Harness } from "./harness.js";

const PIRE_EXTENSION_PATH = "/home/philo/pire/.pire/extensions/pire/index.ts";

function createToolSet(log: string[]): AgentTool[] {
	return [
		{
			name: "read",
			label: "Read",
			description: "Read a file",
			parameters: Type.Object({ path: Type.String() }),
			execute: async (_toolCallId, params) => {
				const path = typeof params === "object" && params !== null && "path" in params ? String(params.path) : "";
				log.push(`read:${path}`);
				return { content: [{ type: "text", text: `read ${path}` }], details: { path } };
			},
		},
		{
			name: "bash",
			label: "Bash",
			description: "Run a shell command",
			parameters: Type.Object({ command: Type.String() }),
			execute: async (_toolCallId, params) => {
				const command =
					typeof params === "object" && params !== null && "command" in params ? String(params.command) : "";
				log.push(`bash:${command}`);
				return { content: [{ type: "text", text: `ran ${command}` }], details: { command } };
			},
		},
		{
			name: "edit",
			label: "Edit",
			description: "Edit a file",
			parameters: Type.Object({ path: Type.String(), oldText: Type.String(), newText: Type.String() }),
			execute: async (_toolCallId, params) => {
				const path = typeof params === "object" && params !== null && "path" in params ? String(params.path) : "";
				log.push(`edit:${path}`);
				return { content: [{ type: "text", text: `edited ${path}` }], details: { path } };
			},
		},
		{
			name: "write",
			label: "Write",
			description: "Write a file",
			parameters: Type.Object({ path: Type.String(), content: Type.String() }),
			execute: async (_toolCallId, params) => {
				const path = typeof params === "object" && params !== null && "path" in params ? String(params.path) : "";
				log.push(`write:${path}`);
				return { content: [{ type: "text", text: `wrote ${path}` }], details: { path } };
			},
		},
	];
}

describe("pire extension mode and tool gating", () => {
	const harnesses: Harness[] = [];
	const expectedReconTools = [
		"research_tracker",
		"read",
		"bash",
		"environment_inventory",
		"binary_file",
		"binary_strings",
		"binary_readelf",
		"binary_objdump",
		"binary_nm",
		"binary_xxd",
		"disasm_rizin_info",
		"disasm_rizin_functions",
		"disasm_radare2_disassembly",
		"decomp_ghidra_functions",
		"decomp_ghidra_decompile",
		"net_curl_head",
		"net_tshark_summary",
		"net_tshark_follow",
		"unpack_binwalk_scan",
		"unpack_archive_list",
	];
	const expectedDynamicOnlyTools = ["debug_gdb", "debug_lldb", "debug_strace", "debug_ltrace"];
	const expectedDynamicTools = [...expectedReconTools, "unpack_binwalk_extract", ...expectedDynamicOnlyTools];
	const expectedProofingTools = [
		...expectedReconTools.slice(0, 3),
		"edit",
		"write",
		...expectedReconTools.slice(3),
		"unpack_binwalk_extract",
		...expectedDynamicOnlyTools,
	];
	const expectedReportTools = [
		...expectedReconTools.slice(0, 3),
		"edit",
		"write",
		...expectedReconTools.slice(3),
		"unpack_binwalk_extract",
	];

	const getToolResultText = (messages: Message[]): string => {
		const toolResult = [...messages]
			.reverse()
			.find((message): message is Extract<Message, { role: "toolResult" }> => message.role === "toolResult");

		if (!toolResult) {
			return "";
		}

		return toolResult.content
			.filter((part): part is TextContent => part.type === "text")
			.map((part) => part.text)
			.join("\n");
	};

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("starts in recon mode, narrows active tools, and allows read-only bash", async () => {
		const log: string[] = [];
		const harness = await createHarness({
			tools: createToolSet(log),
			extensionFactories: [{ factory: pireExtension, path: PIRE_EXTENSION_PATH }],
		});
		harnesses.push(harness);

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		expect(harness.session.getActiveToolNames()).toEqual(expectedReconTools);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "pwd" })], { stopReason: "toolUse" }),
			(context) => fauxAssistantMessage(getToolResultText(context.messages)),
		]);

		await harness.session.prompt("run a safe recon command");

		expect(getAssistantTexts(harness)).toContain("ran pwd");
		expect(log).toEqual(["bash:pwd"]);
	});

	it("blocks destructive bash in recon mode and allows proofing mode escalation", async () => {
		const log: string[] = [];
		const harness = await createHarness({
			tools: createToolSet(log),
			extensionFactories: [{ factory: pireExtension, path: PIRE_EXTENSION_PATH }],
		});
		harnesses.push(harness);

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "rm -rf /tmp/lab" })], { stopReason: "toolUse" }),
			(context) => fauxAssistantMessage(getToolResultText(context.messages)),
		]);

		await harness.session.prompt("run the destructive command");

		expect(
			getAssistantTexts(harness).some((text) =>
				text.includes("pire recon mode blocked this command as destructive or outside the current posture."),
			),
		).toBe(true);
		expect(log).toEqual([]);

		await harness.session.prompt("/proofing");
		expect(harness.session.getActiveToolNames()).toEqual(expectedProofingTools);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "/tmp/proof.txt", oldText: "before", newText: "after" })], {
				stopReason: "toolUse",
			}),
			(context) => fauxAssistantMessage(getToolResultText(context.messages)),
		]);

		await harness.session.prompt("make the scoped proofing edit");

		expect(getAssistantTexts(harness).some((text) => text.includes("edited /tmp/proof.txt"))).toBe(true);
		expect(log).toContain("edit:/tmp/proof.txt");
	});

	it("exposes debug tools only after switching to dynamic mode", async () => {
		const log: string[] = [];
		const harness = await createHarness({
			tools: createToolSet(log),
			extensionFactories: [{ factory: pireExtension, path: PIRE_EXTENSION_PATH }],
		});
		harnesses.push(harness);

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		expect(harness.session.getActiveToolNames()).toEqual(expectedReconTools);

		await harness.session.prompt("/dynamic");
		expect(harness.session.getActiveToolNames()).toEqual(expectedDynamicTools);

		await harness.session.prompt("/report");
		expect(harness.session.getActiveToolNames()).toEqual(expectedReportTools);
	});

	it("registers binary wrapper results as tracker evidence", async () => {
		const log: string[] = [];
		const harness = await createHarness({
			tools: createToolSet(log),
			extensionFactories: [{ factory: pireExtension, path: PIRE_EXTENSION_PATH }],
		});
		harnesses.push(harness);

		const samplePath = join(harness.tempDir, "sample.bin");
		writeFileSync(samplePath, "hello pire\n", "utf-8");

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("binary_file", { path: samplePath })], { stopReason: "toolUse" }),
			(context) => fauxAssistantMessage(getToolResultText(context.messages)),
		]);

		await harness.session.prompt("inspect the sample binary");

		expect(getAssistantTexts(harness).some((text) => text.includes("binary_file:"))).toBe(true);
		expect(log).toEqual([]);

		const trackerPath = join(harness.tempDir, ".pire", "session", "findings.json");
		expect(existsSync(trackerPath)).toBe(true);
		const tracker = JSON.parse(readFileSync(trackerPath, "utf-8")) as {
			evidence: Array<{ summary: string; commandId?: string; artifactIds: string[] }>;
		};
		expect(
			tracker.evidence.some(
				(record) =>
					record.commandId?.startsWith("tool:binary_file:") === true &&
					record.artifactIds.some((artifactId) => artifactId.includes(samplePath)),
			),
		).toBe(true);

		const trackerEntries = harness.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "custom" && entry.customType === "pire-findings-tracker");
		const latestTrackerEntry = trackerEntries.at(-1) as
			| {
					data?: {
						summary?: {
							totalEvidence?: number;
						};
					};
			  }
			| undefined;
		expect(latestTrackerEntry?.data?.summary?.totalEvidence).toBeGreaterThan(0);
	});

	it("persists tracker state from tracker actions and automatic tool evidence", async () => {
		const log: string[] = [];
		const harness = await createHarness({
			tools: createToolSet(log),
			extensionFactories: [{ factory: pireExtension, path: PIRE_EXTENSION_PATH }],
		});
		harnesses.push(harness);

		const samplePath = join(harness.tempDir, "sample.bin");
		writeFileSync(samplePath, "hello pire\n", "utf-8");

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("research_tracker", {
						action: "add_hypothesis",
						title: "Length field reaches parser copy loop",
						claim: "The packet length field can drive parse_frame() into a copy path.",
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage([fauxToolCall("binary_file", { path: samplePath })], { stopReason: "toolUse" }),
			(context) => fauxAssistantMessage(getToolResultText(context.messages)),
		]);

		await harness.session.prompt("track the current reversing hypothesis and inspect the sample");

		expect(getAssistantTexts(harness).some((text) => text.includes("binary_file:"))).toBe(true);

		const trackerPath = join(harness.tempDir, ".pire", "session", "findings.json");
		expect(existsSync(trackerPath)).toBe(true);
		const tracker = JSON.parse(readFileSync(trackerPath, "utf-8")) as {
			hypotheses: Array<{ id: string; title: string; relatedEvidenceIds: string[]; relatedArtifactIds: string[] }>;
			evidence: Array<{ summary: string; commandId?: string; artifactIds: string[] }>;
		};
		expect(tracker.hypotheses).toHaveLength(1);
		expect(tracker.hypotheses[0]?.title).toContain("Length field reaches parser copy loop");
		expect(tracker.hypotheses[0]?.relatedEvidenceIds).toContain("ev-001");
		expect(tracker.hypotheses[0]?.relatedArtifactIds.some((artifactId) => artifactId.includes(samplePath))).toBe(
			true,
		);
		expect(tracker.evidence.some((record) => record.commandId?.startsWith("tool:binary_file:"))).toBe(true);
		expect(
			tracker.evidence.some((record) => record.artifactIds.some((artifactId) => artifactId.includes(samplePath))),
		).toBe(true);

		const trackerEntries = harness.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "custom" && entry.customType === "pire-findings-tracker");
		const latestTrackerEntry = trackerEntries.at(-1) as
			| {
					data?: {
						summary?: {
							totalHypotheses?: number;
							totalEvidence?: number;
						};
					};
			  }
			| undefined;
		expect(latestTrackerEntry?.data?.summary?.totalHypotheses).toBe(1);
		expect(latestTrackerEntry?.data?.summary?.totalEvidence).toBeGreaterThan(0);

		await harness.session.prompt("/tracker");
		const trackerMessage = harness.session.messages.find(
			(
				message,
			): message is Extract<(typeof harness.session.messages)[number], { role: "custom"; customType: string }> =>
				message.role === "custom" && message.customType === "pire-tracker",
		);
		expect(trackerMessage?.content).toContain("Pire Tracker");
		expect(trackerMessage?.content).toContain("Length field reaches parser copy loop");
	});
});
