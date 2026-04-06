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

		expect(harness.session.getActiveToolNames()).toEqual(["read", "bash", "environment_inventory"]);

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
		expect(harness.session.getActiveToolNames()).toEqual(["read", "bash", "edit", "write", "environment_inventory"]);

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
});
