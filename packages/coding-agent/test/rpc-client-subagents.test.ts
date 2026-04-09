import { describe, expect, test, vi } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

describe("RpcClient subagent helpers", () => {
	test("getSubagentReport sends the report command and unwraps the response", async () => {
		const client = new RpcClient();
		const send = vi.fn(async () => ({
			type: "response" as const,
			command: "get_subagent_report" as const,
			success: true as const,
			data: {
				subagent: {
					id: "subagent-1",
					status: "idle" as const,
					depth: 1,
					parentDepth: 0,
					task: "Inspect config",
					turns: 1,
					maxTurns: 6,
					lastAssistantText: "Config looks healthy.",
					createdAt: 1,
					updatedAt: 2,
				},
				text: "Config looks healthy.",
			},
		}));

		(client as unknown as { send: typeof send }).send = send;

		const result = await client.getSubagentReport("subagent-1");

		expect(send).toHaveBeenCalledWith({ type: "get_subagent_report", agentId: "subagent-1" });
		expect(result.text).toBe("Config looks healthy.");
		expect(result.subagent.id).toBe("subagent-1");
	});
});
