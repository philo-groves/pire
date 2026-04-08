import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.js";
import { createBashToolDefinition } from "../src/core/tools/bash.js";
import { PIRE_TOOL_FORBIDDEN_PATHS_ENV, PIRE_TOOL_WORKSPACE_ROOT_ENV } from "../src/core/tools/path-utils.js";
import { createReadToolDefinition } from "../src/core/tools/read.js";

const previousWorkspaceRoot = process.env[PIRE_TOOL_WORKSPACE_ROOT_ENV];
const previousForbiddenPaths = process.env[PIRE_TOOL_FORBIDDEN_PATHS_ENV];

afterEach(() => {
	if (previousWorkspaceRoot === undefined) {
		delete process.env[PIRE_TOOL_WORKSPACE_ROOT_ENV];
	} else {
		process.env[PIRE_TOOL_WORKSPACE_ROOT_ENV] = previousWorkspaceRoot;
	}
	if (previousForbiddenPaths === undefined) {
		delete process.env[PIRE_TOOL_FORBIDDEN_PATHS_ENV];
	} else {
		process.env[PIRE_TOOL_FORBIDDEN_PATHS_ENV] = previousForbiddenPaths;
	}
});

function createToolContext(cwd: string): ExtensionContext {
	return {
		ui: null as never,
		hasUI: false,
		cwd,
		sessionManager: null as never,
		modelRegistry: null as never,
		model: undefined,
		isIdle: () => true,
		signal: undefined,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
	};
}

describe("audited workspace guard", () => {
	test("blocks read tool access outside the configured workspace root", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "pire-tool-root-"));
		const workspaceRoot = join(tempRoot, "workspace");
		const outsideRoot = join(tempRoot, "outside");
		await mkdir(workspaceRoot, { recursive: true });
		await mkdir(outsideRoot, { recursive: true });
		await writeFile(join(outsideRoot, "secret.txt"), "secret\n", "utf-8");

		process.env[PIRE_TOOL_WORKSPACE_ROOT_ENV] = workspaceRoot;
		const readTool = createReadToolDefinition(workspaceRoot);
		const context = createToolContext(workspaceRoot);

		await expect(
			readTool.execute("tool-1", { path: join(outsideRoot, "secret.txt") }, undefined, undefined, context),
		).rejects.toThrow("Path escapes audited workspace root");
	});

	test("blocks bash commands that reference paths outside the configured workspace root", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "pire-bash-root-"));
		const workspaceRoot = join(tempRoot, "workspace");
		const outsideRoot = join(tempRoot, "outside");
		await mkdir(workspaceRoot, { recursive: true });
		await mkdir(outsideRoot, { recursive: true });

		process.env[PIRE_TOOL_WORKSPACE_ROOT_ENV] = workspaceRoot;
		const bashTool = createBashToolDefinition(workspaceRoot);
		const context = createToolContext(workspaceRoot);

		await expect(
			bashTool.execute(
				"tool-2",
				{ command: `cat ${join(outsideRoot, "secret.txt")}` },
				undefined,
				undefined,
				context,
			),
		).rejects.toThrow("Command references path outside audited workspace root");
	});

	test("blocks bash commands that reference forbidden audited paths inside the workspace root", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "pire-bash-forbidden-"));
		const workspaceRoot = join(tempRoot, "workspace");
		await mkdir(join(workspaceRoot, "src"), { recursive: true });

		process.env[PIRE_TOOL_WORKSPACE_ROOT_ENV] = workspaceRoot;
		process.env[PIRE_TOOL_FORBIDDEN_PATHS_ENV] = JSON.stringify(["src/answer_snapshot.c"]);
		const bashTool = createBashToolDefinition(workspaceRoot);
		const context = createToolContext(workspaceRoot);

		await expect(
			bashTool.execute(
				"tool-3",
				{ command: "find .. -path '*/src/answer_snapshot.c' -o -name answer_snapshot.c" },
				undefined,
				undefined,
				context,
			),
		).rejects.toThrow("Command references forbidden audited path");
	});
});
