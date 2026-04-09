import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getAssistantTexts, getMessageText } from "./harness.js";

function getLastToolResultText(messages: readonly unknown[], toolName: string): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (
			message &&
			typeof message === "object" &&
			"role" in message &&
			message.role === "toolResult" &&
			"toolName" in message &&
			message.toolName === toolName
		) {
			return getMessageText(message);
		}
	}
	return undefined;
}

describe("AgentSession subagents", () => {
	const cleanups: Array<() => void> = [];

	afterEach(() => {
		while (cleanups.length > 0) {
			cleanups.pop()?.();
		}
	});

	it("enables spawn_agent by default", async () => {
		const harness = await createHarness();
		cleanups.push(harness.cleanup);

		expect(harness.session.getActiveToolNames()).toContain("spawn_agent");
		expect(harness.session.getAllTools().some((tool) => tool.name === "spawn_agent")).toBe(true);
	});

	it("delegates a bounded task to a child session and returns its report", async () => {
		const harness = await createHarness();
		cleanups.push(harness.cleanup);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("spawn_agent", { task: "Inspect the target config" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Child report: config looks healthy."),
			fauxAssistantMessage("Parent integrated the child report."),
		]);

		await harness.session.prompt("Check the config");

		const toolResultText = getLastToolResultText(harness.session.messages, "spawn_agent");
		expect(toolResultText).toContain("Child report: config looks healthy.");
		expect(getAssistantTexts(harness)).toContain("Parent integrated the child report.");

		const toolEndEvent = harness.eventsOfType("tool_execution_end").find((event) => event.toolName === "spawn_agent");
		expect(toolEndEvent?.isError).toBe(false);
	});

	it("stops nested delegation at depth two", async () => {
		const harness = await createHarness();
		cleanups.push(harness.cleanup);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("spawn_agent", { task: "Level one" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("spawn_agent", { task: "Level two" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("spawn_agent", { task: "Level three" })], { stopReason: "toolUse" }),
			(context) =>
				fauxAssistantMessage(
					`Grandchild saw: ${getLastToolResultText(context.messages as ToolResultMessage[], "spawn_agent") ?? "missing"}`,
				),
			(context) =>
				fauxAssistantMessage(
					`Child saw: ${getLastToolResultText(context.messages as ToolResultMessage[], "spawn_agent") ?? "missing"}`,
				),
			fauxAssistantMessage("Parent finished."),
		]);

		await harness.session.prompt("Try nested delegation");

		const toolResultText = getLastToolResultText(harness.session.messages, "spawn_agent");
		expect(toolResultText).toContain("Maximum subagent depth of 2 reached");
		expect(getAssistantTexts(harness)).toContain("Parent finished.");
	});
});
