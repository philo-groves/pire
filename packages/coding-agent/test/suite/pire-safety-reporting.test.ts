import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall, type Message, type TextContent } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it } from "vitest";
import pireExtension from "../../../../.pire/extensions/pire/index.js";
import { createHarness, getAssistantTexts, type Harness } from "./harness.js";

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

function createToolSet(log: string[]): AgentTool[] {
	return [
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
	];
}

describe("pire safety and reporting commands", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("requires explicit safety escalation for active probing", async () => {
		const log: string[] = [];
		const harness = await createHarness({
			tools: createToolSet(log),
			extensionFactories: [{ factory: pireExtension, path: PIRE_EXTENSION_PATH }],
		});
		harnesses.push(harness);

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "nmap example.com" })], { stopReason: "toolUse" }),
			(context) => fauxAssistantMessage(getToolResultText(context.messages)),
		]);
		await harness.session.prompt("scan the host");
		expect(getAssistantTexts(harness).some((text) => text.includes("Active probing is blocked"))).toBe(true);
		expect(log).toEqual([]);

		await harness.session.prompt("/safety scope external");
		await harness.session.prompt("/safety intent probe");
		await harness.session.prompt("/safety approve-probing example.com :: sanctioned research target");
		await harness.session.prompt("/proofing");

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "nmap example.com" })], { stopReason: "toolUse" }),
			(context) => fauxAssistantMessage(getToolResultText(context.messages)),
		]);
		await harness.session.prompt("scan the host again");
		expect(log).toContain("bash:nmap example.com");
	});

	it("exports notebooks and generates repro bundles from session state", async () => {
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
		await harness.session.prompt("track the current reversing hypothesis and inspect the sample");
		await harness.session.prompt("/support-hypothesis hyp-001 ev-001");
		await harness.session.prompt("/promote-finding hyp-001 Out-of-bounds read :: Crafted frame reads past buffer");
		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("research_tracker", {
						action: "update_finding",
						id: "find-001",
						status: "confirmed",
						reproStatus: "reproduced",
					}),
				],
				{ stopReason: "toolUse" },
			),
			(context) => fauxAssistantMessage(getToolResultText(context.messages)),
		]);
		await harness.session.prompt("confirm the finding");
		await harness.session.prompt("/notebook-export all");
		await harness.session.prompt("/repro-bundle find-001 sample-oob");

		const exportDir = join(harness.tempDir, ".pire", "session", "exports");
		const reproDir = join(harness.tempDir, ".pire", "session", "repro", "find-001-sample-oob");
		expect(existsSync(exportDir)).toBe(true);
		expect(existsSync(reproDir)).toBe(true);
		expect(existsSync(join(reproDir, "README.md"))).toBe(true);
		expect(existsSync(join(reproDir, "manifest.json"))).toBe(true);
		expect(readFileSync(join(reproDir, "README.md"), "utf-8")).toContain("Out-of-bounds read");
	});

	it("refuses repro bundles for incomplete findings", async () => {
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
						title: "Suspicious parser state",
						statement: "Static review suggests unsafe parser behavior.",
						status: "candidate",
						severity: "medium",
						reproStatus: "not-reproduced",
					}),
				],
				{ stopReason: "toolUse" },
			),
			(context) => fauxAssistantMessage(getToolResultText(context.messages)),
		]);
		await harness.session.prompt("record a weak candidate finding");
		await harness.session.prompt("/repro-bundle find-001 weak-candidate");

		const reproDir = join(harness.tempDir, ".pire", "session", "repro", "find-001-weak-candidate");
		expect(existsSync(reproDir)).toBe(false);
		expect(
			getCustomTexts(harness.session.messages).some(
				(text) => text.includes("Pire Repro Bundle Refused") && text.includes("readiness: insufficient"),
			),
		).toBe(true);
	});
});
