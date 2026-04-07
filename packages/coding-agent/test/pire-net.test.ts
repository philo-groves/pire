import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runNetCurlHead, runNetTsharkSummary } from "../../../.pire/extensions/pire/net.js";

describe("pire net helpers", () => {
	test("runNetCurlHead persists header output as a log artifact", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pire-net-"));
		const calls: Array<{ command: string; args: string[] }> = [];
		const details = await runNetCurlHead(
			async (command, args) => {
				calls.push({ command, args });
				return {
					stdout: "HTTP/1.1 200 OK\nserver: test\n",
					stderr: "",
					code: 0,
					killed: false,
				};
			},
			tempDir,
			"https://example.com/login?q=test",
			{
				followRedirects: true,
				maxTimeSeconds: 5,
			},
		);

		expect(calls).toEqual([
			{
				command: "curl",
				args: ["-I", "-sS", "--max-time", "5", "-L", "https://example.com/login?q=test"],
			},
		]);
		expect(details.summary).toContain("net_curl_head: ok");
		expect(details.artifacts).toHaveLength(1);
		expect(details.artifacts[0]?.path).toContain(".pire/artifacts/curl-head-example.com-login-q-test.log");
		expect(details.artifacts[0]?.type).toBe("log");
	});

	test("runNetTsharkSummary persists a PCAP summary log artifact", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pire-net-"));
		const calls: Array<{ command: string; args: string[] }> = [];
		const details = await runNetTsharkSummary(
			async (command, args) => {
				calls.push({ command, args });
				return {
					stdout: "Protocol Hierarchy Statistics",
					stderr: "",
					code: 0,
					killed: false,
				};
			},
			tempDir,
			"/tmp/sample.pcapng",
			{
				view: "protocol-hierarchy",
			},
		);

		expect(calls).toEqual([
			{
				command: "tshark",
				args: ["-r", "/tmp/sample.pcapng", "-q", "-z", "io,phs"],
			},
		]);
		expect(details.summary).toContain("net_tshark_summary: ok");
		expect(details.artifacts).toHaveLength(2);
		expect(details.artifacts[0]?.type).toBe("pcap");
		expect(details.artifacts[1]?.path).toContain(".pire/artifacts/tshark-protocol-hierarchy-sample.pcapng.log");
	});
});
