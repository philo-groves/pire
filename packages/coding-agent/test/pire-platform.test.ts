import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecResult } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, test } from "vitest";
import {
	runPlatformHyperv,
	runPlatformMacos,
	runPlatformPowershell,
	runPlatformXcrun,
} from "../../../.pire/extensions/pire/platform.js";

describe("pire platform helpers", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir) {
				await rm(dir, { recursive: true, force: true });
			}
		}
	});

	test("falls back from pwsh to powershell for Windows-oriented wrappers", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pire-platform-"));
		tempDirs.push(tempDir);
		const calls: string[] = [];
		const exec = async (command: string): Promise<ExecResult> => {
			calls.push(command);
			if (command === "pwsh") {
				return { code: 127, killed: false, stdout: "", stderr: "pwsh: command not found" };
			}
			return { code: 0, killed: false, stdout: "Name State\nvm01 Running\n", stderr: "" };
		};

		const details = await runPlatformHyperv(exec, tempDir, "vm-list");

		expect(calls).toEqual(["pwsh", "powershell"]);
		expect(details.command[0]).toBe("powershell");
		expect(details.summary).toContain("platform_hyperv: ok");
		expect(details.artifacts.some((artifact) => artifact.path.endsWith(".log"))).toBe(true);
	});

	test("captures unavailable Apple tooling without throwing", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pire-platform-"));
		tempDirs.push(tempDir);
		const exec = async (): Promise<ExecResult> => ({
			code: 127,
			killed: false,
			stdout: "",
			stderr: "xcrun: command not found",
		});

		const details = await runPlatformXcrun(exec, tempDir, "simctl-list");

		expect(details.exitCode).toBe(127);
		expect(details.unavailable).toContain("command not found");
		expect(details.summary).toContain("platform_xcrun: failed");
	});

	test("persists macOS and PowerShell inspection logs", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pire-platform-"));
		tempDirs.push(tempDir);
		const exec = async (command: string): Promise<ExecResult> => ({
			code: 0,
			killed: false,
			stdout: `${command} ok\n`,
			stderr: "",
		});

		const macos = await runPlatformMacos(exec, tempDir, "/tmp/App.app", "codesign");
		const powershell = await runPlatformPowershell(exec, tempDir, "system-summary");

		expect(macos.summary).toContain("platform_macos: ok");
		expect(macos.artifacts.some((artifact) => artifact.path.endsWith(".log"))).toBe(true);
		expect(powershell.summary).toContain("platform_powershell: ok");
		expect(powershell.artifacts.some((artifact) => artifact.path.endsWith(".log"))).toBe(true);
	});
});
