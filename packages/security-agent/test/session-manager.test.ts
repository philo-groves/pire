import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
import {
	buildSessionContext,
	readMostRecentThinkingLevel,
	type SessionEntry,
	SessionManager,
} from "../src/session-manager.js";

function createUserMessage(text: string, timestamp: number): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp,
	};
}

function createAssistantMessage(text: string, timestamp: number): AgentMessage {
	return {
		role: "assistant",
		api: "openai-responses",
		provider: "openai",
		model: "test-researcher",
		stopReason: "stop",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		content: [{ type: "text", text }],
		timestamp,
	};
}

describe("buildSessionContext", () => {
	it("replays from the latest compaction checkpoint and exposes the saved summary", () => {
		const entries: SessionEntry[] = [
			{
				type: "model_change",
				id: "m1",
				parentId: null,
				timestamp: "2026-04-19T12:00:00.000Z",
				provider: "openai",
				modelId: "test-researcher",
			},
			{
				type: "thinking_level_change",
				id: "t1",
				parentId: "m1",
				timestamp: "2026-04-19T12:00:01.000Z",
				thinkingLevel: "medium",
			},
			{
				type: "message",
				id: "u1",
				parentId: "t1",
				timestamp: "2026-04-19T12:00:02.000Z",
				message: createUserMessage("Investigate candidate A.", 1),
			},
			{
				type: "message",
				id: "a1",
				parentId: "u1",
				timestamp: "2026-04-19T12:00:03.000Z",
				message: createAssistantMessage("Initial recon and tool work.", 2),
			},
			{
				type: "message",
				id: "u2",
				parentId: "a1",
				timestamp: "2026-04-19T12:00:04.000Z",
				message: createUserMessage("Drive the proof deeper.", 3),
			},
			{
				type: "message",
				id: "a2",
				parentId: "u2",
				timestamp: "2026-04-19T12:00:05.000Z",
				message: createAssistantMessage("Kept tail before compaction.", 4),
			},
			{
				type: "compaction",
				id: "c1",
				parentId: "a2",
				timestamp: "2026-04-19T12:00:06.000Z",
				summary:
					"[Compacted Transcript]\nOlder transcript groups compacted before the raw tail: 2.\n- user: Investigate candidate A.\n- assistant: Initial recon and tool work.",
				firstKeptEntryId: "u2",
				tokensBefore: 18432,
			},
			{
				type: "message",
				id: "u3",
				parentId: "c1",
				timestamp: "2026-04-19T12:00:07.000Z",
				message: createUserMessage("Resume from the strongest proof path.", 5),
			},
			{
				type: "message",
				id: "a3",
				parentId: "u3",
				timestamp: "2026-04-19T12:00:08.000Z",
				message: createAssistantMessage("Latest post-compaction response.", 6),
			},
		];

		const context = buildSessionContext(entries);

		assert.strictEqual(context.thinkingLevel, "medium");
		assert.deepStrictEqual(context.model, { provider: "openai", modelId: "test-researcher" });
		assert.deepStrictEqual(context.messageEntryIds, ["u2", "a2", "u3", "a3"]);
		assert.strictEqual(context.messages.length, 4);
		assert.match(extractMessageText(context.messages[0]!), /Drive the proof deeper/);
		assert.match(extractMessageText(context.messages[3]!), /Latest post-compaction response/);
		assert.ok(context.compaction);
		assert.strictEqual(context.compaction?.firstKeptEntryId, "u2");
		assert.strictEqual(context.compaction?.tokensBefore, 18432);
		assert.match(context.compaction?.summary ?? "", /\[Compacted Transcript\]/);
	});
});

describe("readMostRecentThinkingLevel", () => {
	it("restores the last saved effort for the current workspace", () => {
		const sessionDir = mkdtempSync(join(tmpdir(), "pire-session-test-"));
		const cwd = "/tmp/workspace-a";

		try {
			const firstSession = SessionManager.create(cwd, sessionDir);
			firstSession.appendThinkingLevelChange("low");
			firstSession.flush();

			const secondSession = SessionManager.create(cwd, sessionDir);
			secondSession.appendThinkingLevelChange("high");
			secondSession.flush();

			assert.strictEqual(readMostRecentThinkingLevel(cwd, sessionDir), "high");
		} finally {
			rmSync(sessionDir, { recursive: true, force: true });
		}
	});

	it("ignores more recent sessions from a different workspace in a shared session dir", () => {
		const sessionDir = mkdtempSync(join(tmpdir(), "pire-session-test-"));

		try {
			const targetSession = SessionManager.create("/tmp/workspace-a", sessionDir);
			targetSession.appendThinkingLevelChange("minimal");
			targetSession.flush();

			const otherSession = SessionManager.create("/tmp/workspace-b", sessionDir);
			otherSession.appendThinkingLevelChange("xhigh");
			otherSession.flush();

			assert.strictEqual(readMostRecentThinkingLevel("/tmp/workspace-a", sessionDir), "minimal");
		} finally {
			rmSync(sessionDir, { recursive: true, force: true });
		}
	});
});

function extractMessageText(message: AgentMessage): string {
	if (message.role === "assistant") {
		const assistantMessage = message as AssistantMessage;
		return assistantMessage.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n");
	}

	if (message.role !== "user" && message.role !== "toolResult") {
		return "";
	}

	const contentMessage = message as UserMessage | ToolResultMessage;
	if (typeof contentMessage.content === "string") {
		return contentMessage.content;
	}

	return contentMessage.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}
