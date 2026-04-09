import { describe, expect, test, vi } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

describe("RpcClient background task helpers", () => {
	test("startBackgroundTask sends the start command and unwraps the response", async () => {
		const client = new RpcClient();
		const send = vi.fn(async () => ({
			type: "response" as const,
			command: "start_background_task" as const,
			success: true as const,
			data: {
				id: "task-1",
				status: "running" as const,
				command: "sleep 5",
				pid: 123,
				createdAt: 1,
				updatedAt: 1,
			},
		}));

		(client as unknown as { send: typeof send }).send = send;

		const result = await client.startBackgroundTask("sleep 5");

		expect(send).toHaveBeenCalledWith({ type: "start_background_task", command: "sleep 5" });
		expect(result.id).toBe("task-1");
		expect(result.status).toBe("running");
	});

	test("getBackgroundTaskReport sends the report command and unwraps the response", async () => {
		const client = new RpcClient();
		const send = vi.fn(async () => ({
			type: "response" as const,
			command: "get_background_task_report" as const,
			success: true as const,
			data: {
				task: {
					id: "task-1",
					status: "completed" as const,
					command: "printf done",
					exitCode: 0,
					lastOutput: "done",
					createdAt: 1,
					updatedAt: 2,
				},
				text: "done",
			},
		}));

		(client as unknown as { send: typeof send }).send = send;

		const result = await client.getBackgroundTaskReport("task-1");

		expect(send).toHaveBeenCalledWith({ type: "get_background_task_report", taskId: "task-1" });
		expect(result.text).toBe("done");
		expect(result.task.status).toBe("completed");
	});
});
