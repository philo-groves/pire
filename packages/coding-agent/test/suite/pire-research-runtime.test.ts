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

function getCustomTexts(messages: unknown[]): string[] {
	return messages.flatMap((message) => {
		if (
			typeof message === "object" &&
			message !== null &&
			"role" in message &&
			"content" in message &&
			message.role === "custom" &&
			typeof message.content === "string"
		) {
			return [message.content];
		}
		return [];
	});
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
		expect(injectedText).toContain("[PIRE ENVIRONMENT]");
		expect(injectedText).toContain("[PIRE SESSION TYPE: CRASH TRIAGE]");
		expect(injectedText).toContain("[PIRE ROLE: REVIEWER]");
		expect(injectedText).toContain("[PIRE MODE: DYNAMIC]");
		expect(harness.session.getActiveToolNames()).toContain("debug_gdb");
		expect(harness.session.getActiveToolNames()).toContain("platform_powershell");
		expect(harness.session.getActiveToolNames()).toContain("platform_macos");
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
						action: "add_question",
						prompt: "Can we tie the sample back to the parser path?",
						status: "blocked",
					}),
					fauxToolCall("research_tracker", {
						action: "add_hypothesis",
						title: "Length field reaches parser copy loop",
						claim: "The packet length field can drive parse_frame() into a copy path.",
						relatedQuestionIds: ["q-001"],
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
		await harness.session.prompt("/support-hypothesis hyp-001 ev-001");
		await harness.session.prompt(
			"/promote-finding hyp-001 Parser loop candidate :: Copy loop may overrun parser state",
		);
		await harness.session.prompt(
			"/campaign-status find-001 blocked :: parked until we can capture the production parser build for confirmation",
		);

		const result = await harness.session.compact("Preserve the current reversing state.");

		expect(result.summary).toContain("# Pire Research Compaction");
		expect(result.summary).toContain("- session type: binary-re");
		expect(result.summary).toContain("- role: reverser");
		expect(result.summary).toContain("- campaign findings: 1");
		expect(result.summary).toContain("## Campaign State");
		expect(result.summary).toContain("[blocked] Parser loop candidate");
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
						action: "add_question",
						prompt: "Can we tie the sample back to the parser path?",
						status: "blocked",
					}),
					fauxToolCall("research_tracker", {
						action: "add_hypothesis",
						title: "Length field reaches parser copy loop",
						claim: "The packet length field can drive parse_frame() into a copy path.",
						relatedQuestionIds: ["q-001"],
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
			questions: Array<{ id: string; relatedEvidenceIds: string[] }>;
		};
		expect(tracker.hypotheses[0]).toMatchObject({
			id: "hyp-001",
			status: "supported",
			relatedEvidenceIds: ["ev-001"],
		});
		expect(tracker.questions[0]).toMatchObject({
			id: "q-001",
			relatedEvidenceIds: ["ev-001"],
		});
		expect(tracker.findings[0]).toMatchObject({
			id: "find-001",
			title: "Out-of-bounds read",
		});
	});

	it("persists a campaign ledger and journal alongside session findings", async () => {
		const harness = await createHarness({
			extensionFactories: [{ factory: pireExtension, path: PIRE_EXTENSION_PATH }],
		});
		harnesses.push(harness);

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("research_tracker", {
						action: "add_finding",
						title: "Sandbox escape candidate",
						statement: "Initial review suggests a reachable trust-boundary bypass.",
						status: "candidate",
						severity: "high",
						reproStatus: "not-reproduced",
					}),
				],
				{ stopReason: "toolUse" },
			),
			(context) => fauxAssistantMessage(getToolResultText(context.messages)),
		]);

		await harness.session.prompt("record the current candidate finding");
		await harness.session.prompt(
			"/campaign-status find-001 de-escalated :: disproved after cross-boundary validation failed on the real target",
		);

		const campaignJsonPath = join(harness.tempDir, ".pire", "campaign.json");
		const campaignStatusPath = join(harness.tempDir, ".pire", "STATUS.md");
		const journalPath = join(harness.tempDir, ".pire", "journal", `${new Date().toISOString().slice(0, 10)}.md`);

		expect(existsSync(campaignJsonPath)).toBe(true);
		expect(existsSync(campaignStatusPath)).toBe(true);
		expect(existsSync(journalPath)).toBe(true);

		const campaign = JSON.parse(readFileSync(campaignJsonPath, "utf-8")) as {
			findings: Array<{ id: string; status: string; note?: string }>;
		};
		expect(campaign.findings[0]).toMatchObject({
			id: "find-001",
			status: "de-escalated",
		});
		expect(campaign.findings[0]?.note).toContain("cross-boundary validation failed");
		expect(readFileSync(campaignStatusPath, "utf-8")).toContain("de-escalated");
		expect(readFileSync(journalPath, "utf-8")).toContain("Set find-001 to de-escalated");
	});

	it("supports campaign browsing commands, note-guarded closures, and generic chains", async () => {
		const harness = await createHarness({
			extensionFactories: [{ factory: pireExtension, path: PIRE_EXTENSION_PATH }],
		});
		harnesses.push(harness);

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("research_tracker", {
						action: "add_finding",
						title: "Kernel trust-boundary candidate",
						statement: "Initial review suggests a reachable boundary bypass.",
						status: "candidate",
						severity: "high",
						reproStatus: "not-reproduced",
					}),
				],
				{ stopReason: "toolUse" },
			),
			(context) => fauxAssistantMessage(getToolResultText(context.messages)),
		]);

		await harness.session.prompt("record the current candidate finding");
		await harness.session.prompt("/campaign-status find-001 blocked");
		await harness.session.prompt(
			"/campaign-status find-001 blocked :: parked until we can reproduce against the production image",
		);
		await harness.session.prompt(
			"/chain-create Hyper-V to kernel chain :: Track the VM escape candidate through host validation.",
		);
		await harness.session.prompt("/chain-link chain-001 find-001");
		await harness.session.prompt("/chain-status chain-001 parked :: waiting on fresh host symbols");
		await harness.session.prompt("/campaign-open");
		await harness.session.prompt("/campaign-recent");
		await harness.session.prompt("/campaign-search kernel");
		await harness.session.prompt("/chain-detail chain-001");

		const customTexts = getCustomTexts(harness.session.messages);
		const campaignJsonPath = join(harness.tempDir, ".pire", "campaign.json");
		const campaign = JSON.parse(readFileSync(campaignJsonPath, "utf-8")) as {
			findings: Array<{ id: string; status: string; note?: string }>;
			chains: Array<{ id: string; status: string; findingIds: string[]; note?: string }>;
		};

		expect(campaign.findings[0]).toMatchObject({
			id: "find-001",
			status: "blocked",
		});
		expect(campaign.findings[0]?.note).toContain("production image");
		expect(campaign.chains[0]).toMatchObject({
			id: "chain-001",
			status: "parked",
			findingIds: ["find-001"],
		});
		expect(campaign.chains[0]?.note).toContain("fresh host symbols");
		expect(customTexts.some((text) => text.includes("blocked transitions require a note"))).toBe(false);
		expect(customTexts.some((text) => text.includes("Pire Campaign Open Work"))).toBe(true);
		expect(customTexts.some((text) => text.includes("Pire Campaign Recent Activity"))).toBe(true);
		expect(customTexts.some((text) => text.includes("Pire Campaign Ledger") && text.includes("kernel"))).toBe(true);
		expect(customTexts.some((text) => text.includes("Pire Campaign Chain") && text.includes("chain-001"))).toBe(true);
	});
});
