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

function getBackgroundTaskId(result: ToolResultMessage | undefined): string | undefined {
	const details = result?.details as { taskId?: string } | undefined;
	return details?.taskId;
}

describe("AgentSession background tasks", () => {
	const cleanups: Array<() => void> = [];

	afterEach(() => {
		while (cleanups.length > 0) {
			cleanups.pop()?.();
		}
	});

	it("enables persistent background-task tools by default", async () => {
		const harness = await createHarness();
		cleanups.push(harness.cleanup);

		expect(harness.session.getActiveToolNames()).toEqual(
			expect.arrayContaining(["start_background_task", "wait_background_task", "cancel_background_task"]),
		);
	});

	it("manages background tasks through start, wait, report, list, and cancel APIs", async () => {
		const harness = await createHarness();
		cleanups.push(harness.cleanup);

		const started = await harness.session.startBackgroundTask({ command: "sleep 0.1; printf 'ready'" });
		expect(started.status).toBe("running");

		const waited = await harness.session.waitForBackgroundTask(started.id);
		expect(waited.status).toBe("completed");
		expect(harness.session.getBackgroundTaskReport(started.id).text).toContain("ready");

		const listed = harness.session.listBackgroundTasks();
		expect(listed.map((task) => task.id)).toContain(started.id);

		const cancellable = await harness.session.startBackgroundTask({ command: "sleep 5" });
		const cancelled = await harness.session.cancelBackgroundTask(cancellable.id);
		expect(cancelled.status).toBe("cancelled");
		expect(harness.eventsOfType("background_task_end").at(-1)?.task.id).toBe(cancellable.id);
		expect(harness.eventsOfType("background_task_end").at(-1)?.task.status).toBe("cancelled");
	});

	it("supports parent tool flows with wait_background_task", async () => {
		const harness = await createHarness();
		cleanups.push(harness.cleanup);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("start_background_task", { command: "printf 'bg-ok'" })], {
				stopReason: "toolUse",
			}),
			(context) =>
				fauxAssistantMessage(
					[
						fauxToolCall("wait_background_task", {
							taskId: getBackgroundTaskId(getLastToolResult(context, "start_background_task")),
						}),
					],
					{
						stopReason: "toolUse",
					},
				),
			(context) => {
				const waitResult = getLastToolResult(context, "wait_background_task");
				return fauxAssistantMessage(`Parent integrated background task: ${getMessageText(waitResult)}`);
			},
		]);

		await harness.session.prompt("Run detached check");

		expect(getAssistantTexts(harness)).toContain("Parent integrated background task: bg-ok");
	});

	it("emits compact background task progress events", async () => {
		const harness = await createHarness();
		cleanups.push(harness.cleanup);

		const started = await harness.session.startBackgroundTask({
			command: "printf 'chunk-a'; sleep 0.05; printf ' chunk-b'",
		});
		await harness.session.waitForBackgroundTask(started.id);

		const starts = harness.eventsOfType("background_task_start");
		const updates = harness.eventsOfType("background_task_update");
		const ends = harness.eventsOfType("background_task_end");

		expect(starts).toHaveLength(1);
		expect(starts[0].task.id).toBe(started.id);
		expect(
			updates.some(
				(event) => event.task.id === started.id && event.eventType === "output" && typeof event.delta === "string",
			),
		).toBe(true);
		expect(ends).toHaveLength(1);
		expect(ends[0].task.lastOutput).toContain("chunk");
	});
});
