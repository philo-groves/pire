import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall, type Message, type TextContent } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it } from "vitest";
import pireExtension from "../../../../.pire/extensions/pire/index.js";
import { createHarness, type Harness } from "./harness.js";

const PIRE_EXTENSION_PATH = "/home/philo/pire/.pire/extensions/pire/index.ts";

function getToolResultText(messages: Message[]): string {
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
}

function createToolSet(): AgentTool[] {
	return [
		{
			name: "read",
			label: "Read",
			description: "Read a file",
			parameters: Type.Object({ path: Type.String() }),
			execute: async (_toolCallId, params) => {
				const path = typeof params === "object" && params !== null && "path" in params ? String(params.path) : "";
				return { content: [{ type: "text", text: `read ${path}` }], details: { path } };
			},
		},
	];
}

describe("pire research runtime features", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("applies session types and roles and injects them into provider context", async () => {
		const harness = await createHarness({
			extensionFactories: [{ factory: pireExtension, path: PIRE_EXTENSION_PATH }],
		});
		harnesses.push(harness);

		await harness.session.bindExtensions({ shutdownHandler: () => {} });
		await harness.session.prompt("/session-type crash-triage");
		await harness.session.prompt("/reviewer");

		let providerSystemPrompt = "";
		let injectedText = "";
		harness.setResponses([
			(context) => {
				providerSystemPrompt = context.systemPrompt ?? "";
				injectedText = context.messages
					.flatMap((message) =>
						message.role === "user" && Array.isArray(message.content) ? [...message.content] : [],
					)
					.filter(
						(part): part is { type: "text"; text: string } =>
							typeof part === "object" &&
							part !== null &&
							"type" in part &&
							"text" in part &&
							part.type === "text",
					)
					.map((part) => part.text)
					.join("\n");
				return fauxAssistantMessage("ok");
			},
		]);

		await harness.session.prompt("summarize the active research posture");

		expect(providerSystemPrompt).toContain("Available tools:");
		expect(injectedText).toContain("[PIRE SESSION TYPE: CRASH TRIAGE]");
		expect(injectedText).toContain("[PIRE ROLE: REVIEWER]");
		expect(injectedText).toContain("[PIRE MODE: DYNAMIC]");
		expect(harness.session.getActiveToolNames()).toContain("debug_gdb");
		expect(harness.session.getActiveToolNames()).not.toContain("edit");
	});

	it("uses research-aware compaction summaries with session, tracker, artifact, and activity state", async () => {
		const harness = await createHarness({
			tools: createToolSet(),
			extensionFactories: [{ factory: pireExtension, path: PIRE_EXTENSION_PATH }],
		});
		harnesses.push(harness);

		const samplePath = join(harness.tempDir, "sample.bin");
		writeFileSync(samplePath, "hello pire\n", "utf-8");

		await harness.session.bindExtensions({ shutdownHandler: () => {} });
		await harness.session.prompt("/session-type binary-re");
		await harness.session.prompt("/reverser");

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
			fauxAssistantMessage([fauxToolCall("read", { path: samplePath }), fauxToolCall("environment_inventory", {})], {
				stopReason: "toolUse",
			}),
			(context) => fauxAssistantMessage(getToolResultText(context.messages)),
		]);

		await harness.session.prompt("track the hypothesis and inspect the sample");

		const result = await harness.session.compact("Preserve the current reversing state.");

		expect(result.summary).toContain("# Pire Research Compaction");
		expect(result.summary).toContain("- session type: binary-re");
		expect(result.summary).toContain("- role: reverser");
		expect(result.summary).toContain("## Tracker Summary");
		expect(result.summary).toContain("## Artifact Registry");
		expect(result.summary).toContain(samplePath);
		expect(result.summary).toContain("## Recent Activity");
		expect(result.summary).toContain("Environment Inventory");
		expect(result.details).toMatchObject({
			sessionType: "binary-re",
			role: "reverser",
			mode: "recon",
		});
	});

	it("exposes tracker detail and quick-action commands", async () => {
		const harness = await createHarness({
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

		await harness.session.prompt("track the hypothesis and inspect the sample");
		await harness.session.prompt("/support-hypothesis hyp-001 ev-001");
		await harness.session.prompt("/promote-finding hyp-001 Out-of-bounds read :: Crafted frame reads past buffer");
		await harness.session.prompt("/tracker-detail hyp-001");

		const trackerPath = join(harness.tempDir, ".pire", "session", "findings.json");
		expect(existsSync(trackerPath)).toBe(true);
		const tracker = JSON.parse(readFileSync(trackerPath, "utf-8")) as {
			hypotheses: Array<{ id: string; status: string; relatedEvidenceIds: string[] }>;
			findings: Array<{ id: string; title: string }>;
		};
		expect(tracker.hypotheses[0]).toMatchObject({
			id: "hyp-001",
			status: "supported",
			relatedEvidenceIds: ["ev-001"],
		});
		expect(tracker.findings[0]).toMatchObject({
			id: "find-001",
			title: "Out-of-bounds read",
		});

		const detailMessage = [...harness.session.messages]
			.reverse()
			.find(
				(
					message,
				): message is Extract<(typeof harness.session.messages)[number], { role: "custom"; customType: string }> =>
					message.role === "custom" && message.customType === "pire-tracker-detail",
			);
		expect(detailMessage?.content).toContain("Pire Tracker Record");
		expect(detailMessage?.content).toContain("status: supported");
		expect(detailMessage?.content).toContain("Evidence Links:");
		expect(detailMessage?.content).toContain("ev-001");
	});
});
