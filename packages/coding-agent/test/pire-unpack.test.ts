import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
	runUnpackArchiveList,
	runUnpackBinwalkExtract,
	runUnpackBinwalkScan,
} from "../../../.pire/extensions/pire/unpack.js";

describe("pire unpack helpers", () => {
	test("runUnpackBinwalkScan persists scan output as a log artifact", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pire-unpack-"));
		const calls: Array<{ command: string; args: string[] }> = [];
		const details = await runUnpackBinwalkScan(
			async (command, args) => {
				calls.push({ command, args });
				return {
					stdout: "DECIMAL       HEXADECIMAL     DESCRIPTION",
					stderr: "",
					code: 0,
					killed: false,
				};
			},
			tempDir,
			"/tmp/fw.bin",
		);

		expect(calls).toEqual([{ command: "binwalk", args: ["/tmp/fw.bin"] }]);
		expect(details.summary).toContain("unpack_binwalk_scan: ok");
		expect(details.artifacts).toHaveLength(2);
		expect(details.artifacts[0]?.type).toBe("firmware");
		expect(details.artifacts[1]?.path).toContain(".pire/artifacts/binwalk-scan-fw.bin.log");
	});

	test("runUnpackBinwalkExtract registers extraction directory and log artifacts", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pire-unpack-"));
		const calls: Array<{ command: string; args: string[] }> = [];
		const details = await runUnpackBinwalkExtract(
			async (command, args) => {
				calls.push({ command, args });
				return {
					stdout: "Extraction complete",
					stderr: "",
					code: 0,
					killed: false,
				};
			},
			tempDir,
			"/tmp/fw.bin",
		);

		expect(calls[0]?.command).toBe("binwalk");
		expect(calls[0]?.args).toContain("-e");
		expect(details.artifacts).toHaveLength(3);
		expect(details.artifacts[1]?.path).toContain(".pire/artifacts/binwalk-extract-fw.bin");
		expect(details.artifacts[2]?.path).toContain(".pire/artifacts/binwalk-extract-fw.bin.log");
	});

	test("runUnpackArchiveList supports tar listings with persisted logs", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pire-unpack-"));
		const calls: Array<{ command: string; args: string[] }> = [];
		const details = await runUnpackArchiveList(
			async (command, args) => {
				calls.push({ command, args });
				return {
					stdout: "rootfs/bin/busybox",
					stderr: "",
					code: 0,
					killed: false,
				};
			},
			tempDir,
			"/tmp/rootfs.tar",
			"tar",
		);

		expect(calls).toEqual([{ command: "tar", args: ["-tf", "/tmp/rootfs.tar"] }]);
		expect(details.summary).toContain("unpack_archive_list: ok");
		expect(details.artifacts[1]?.path).toContain(".pire/artifacts/tar-list-rootfs.tar.log");
	});
});
