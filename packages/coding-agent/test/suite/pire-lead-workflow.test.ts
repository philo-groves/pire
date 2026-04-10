import { fauxAssistantMessage, fauxToolCall, type Message, type TextContent } from "@mariozechner/pi-ai";
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

function getLatestCustomContent(harness: Harness, customType: string): string {
	for (const message of [...harness.session.messages].reverse()) {
		if (message.role === "custom" && message.customType === customType && typeof message.content === "string") {
			return message.content;
		}
	}
	return "";
}

describe("pire lead workflow", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("surfaces candidate backlog and switches into verification posture for a lead", async () => {
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
						title: "Unchecked parser copy",
						statement: "A parser-controlled length appears to flow into a copy loop without a hard bound.",
						status: "candidate",
						severity: "high",
						reproStatus: "not-reproduced",
					}),
				],
				{ stopReason: "toolUse" },
			),
			(context) => fauxAssistantMessage(getToolResultText(context.messages)),
		]);
		await harness.session.prompt("record the candidate finding");

		await harness.session.prompt("/candidate-queue");
		const queueContent = getLatestCustomContent(harness, "pire-candidate-queue");
		expect(queueContent).toContain("Pire Candidate Queue");
		expect(queueContent).toContain("find-001 [high/not-reproduced] Unchecked parser copy");
		expect(queueContent).toContain("collect the first confirming or disproving evidence");

		await harness.session.prompt("/verify-finding find-001");

		harness.setResponses([fauxAssistantMessage("verification turn started")]);
		await harness.session.prompt("continue verification");
		const modeContext = getLatestCustomContent(harness, "pire-mode-context");
		expect(modeContext).toContain("[PIRE MODE: DYNAMIC]");
		expect(modeContext).toContain("[PIRE LEAD WORKFLOW]");
		expect(modeContext).toContain("candidate findings: 1");
		expect(modeContext).toContain("Verification backlog:");
		expect(modeContext).toContain("find-001 [high/not-reproduced] Unchecked parser copy");
	});
});
