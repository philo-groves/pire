import type { Context, ToolResultMessage } from "@mariozechner/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getAssistantTexts, getMessageText } from "./harness.js";

function getToolResults(context: Context, toolName: string): ToolResultMessage[] {
	return context.messages.filter(
		(message): message is ToolResultMessage => message.role === "toolResult" && message.toolName === toolName,
	);
}

function getLastToolResult(context: Context, toolName: string): ToolResultMessage | undefined {
	return getToolResults(context, toolName).at(-1);
}

function getSubagentId(result: ToolResultMessage | undefined): string | undefined {
	const details = result?.details as { subagentId?: string } | undefined;
	return details?.subagentId;
}

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

	it("enables persistent subagent tools by default", async () => {
		const harness = await createHarness();
		cleanups.push(harness.cleanup);

		expect(harness.session.getActiveToolNames()).toEqual(
			expect.arrayContaining(["spawn_agent", "send_input", "wait_agent", "close_agent"]),
		);
	});

	it("manages subagents through spawn, wait, send, list, and close APIs", async () => {
		const harness = await createHarness();
		cleanups.push(harness.cleanup);

		harness.setResponses([
			fauxAssistantMessage("Child initial report."),
			fauxAssistantMessage("Child handled: Follow-up input"),
		]);

		const spawned = await harness.session.spawnSubagent({ task: "Inspect the target config" });
		expect(spawned.status).toBe("running");

		const waited = await harness.session.waitForSubagent(spawned.id);
		expect(waited.status).toBe("idle");
		expect(waited.lastAssistantText).toBe("Child initial report.");

		const sent = await harness.session.sendSubagentInput(spawned.id, "Follow-up input");
		expect(sent.status).toBe("running");

		const waitedAgain = await harness.session.waitForSubagent(spawned.id);
		expect(waitedAgain.lastAssistantText).toBe("Child handled: Follow-up input");

		const listed = harness.session.listSubagents();
		expect(listed.map((agent) => agent.id)).toContain(spawned.id);

		const endsBeforeClose = harness.eventsOfType("subagent_end").length;
		const closed = await harness.session.closeSubagent(spawned.id);
		expect(closed.status).toBe("closed");
		expect(harness.eventsOfType("subagent_end")).toHaveLength(endsBeforeClose + 1);
		expect(harness.eventsOfType("subagent_end").at(-1)?.subagent.status).toBe("closed");
	});

	it("supports parent tool flows with wait_agent", async () => {
		const harness = await createHarness();
		cleanups.push(harness.cleanup);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("spawn_agent", { task: "Inspect the target config" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Child report: config looks healthy."),
			(context) => {
				const spawnResult = getLastToolResult(context, "spawn_agent");
				return fauxAssistantMessage([fauxToolCall("wait_agent", { agentId: getSubagentId(spawnResult) })], {
					stopReason: "toolUse",
				});
			},
			(context) => {
				const waitResult = getLastToolResult(context, "wait_agent");
				return fauxAssistantMessage(`Parent integrated: ${getMessageText(waitResult)}`);
			},
		]);

		await harness.session.prompt("Run delegated check");

		expect(getAssistantTexts(harness)).toContain("Parent integrated: Child report: config looks healthy.");
		expect(getLastToolResultText(harness.session.messages, "wait_agent")).toContain(
			"Child report: config looks healthy.",
		);
	});

	it("emits compact subagent progress events for parent monitoring", async () => {
		const harness = await createHarness();
		cleanups.push(harness.cleanup);

		harness.setResponses([fauxAssistantMessage("Child progress stream.")]);

		const spawned = await harness.session.spawnSubagent({ task: "Stream progress" });
		await harness.session.waitForSubagent(spawned.id);

		const starts = harness.eventsOfType("subagent_start");
		const updates = harness.eventsOfType("subagent_update");
		const ends = harness.eventsOfType("subagent_end");

		expect(starts).toHaveLength(1);
		expect(starts[0].subagent.id).toBe(spawned.id);
		expect(ends).toHaveLength(1);
		expect(ends[0].subagent.lastAssistantText).toBe("Child progress stream.");

		expect(
			updates.some(
				(event) =>
					event.subagent.id === spawned.id &&
					event.eventType === "message_update" &&
					event.assistantEventType === "text_delta" &&
					typeof event.delta === "string" &&
					event.delta.length > 0,
			),
		).toBe(true);
		expect(
			updates.some(
				(event) =>
					event.subagent.id === spawned.id &&
					event.eventType === "message_end" &&
					event.messageRole === "assistant" &&
					event.text === "Child progress stream.",
			),
		).toBe(true);
	});

	it("enforces max subagent depth of two across nested child runs", async () => {
		const harness = await createHarness({ subagentDepth: 2 });
		cleanups.push(harness.cleanup);

		await expect(harness.session.spawnSubagent({ task: "Level three" })).rejects.toThrow(
			"Maximum subagent depth of 2 reached",
		);
	});
});
