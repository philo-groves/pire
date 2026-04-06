import { describe, expect, test } from "vitest";
import {
	type ArtifactManifest,
	inferArtifactType,
	recordArtifact,
	summarizeArtifactManifest,
} from "../../../.pire/extensions/pire/artifacts.js";

function createManifest(): ArtifactManifest {
	return {
		version: 1,
		updatedAt: "2026-01-01T00:00:00.000Z",
		artifacts: [],
	};
}

describe("pire artifact helpers", () => {
	test("inferArtifactType maps common research artifacts", () => {
		expect(inferArtifactType("/tmp/capture.pcapng")).toBe("pcap");
		expect(inferArtifactType("/tmp/sample.elf")).toBe("binary");
		expect(inferArtifactType("/tmp/report.md")).toBe("report");
		expect(inferArtifactType("/tmp/notes.md")).toBe("note");
		expect(inferArtifactType("/tmp/frame.png")).toBe("image");
	});

	test("recordArtifact deduplicates provenance and commands", async () => {
		const manifest = createManifest();
		await recordArtifact(manifest, {
			path: "/tmp/sample.bin",
			provenance: "tool:read",
			command: "read sample.bin",
			timestamp: "2026-01-01T00:00:01.000Z",
		});
		await recordArtifact(manifest, {
			path: "/tmp/sample.bin",
			provenance: "tool:read",
			command: "read sample.bin",
			timestamp: "2026-01-01T00:00:02.000Z",
		});

		expect(manifest.artifacts).toHaveLength(1);
		expect(manifest.artifacts[0]?.provenance).toEqual(["tool:read"]);
		expect(manifest.artifacts[0]?.relatedCommands).toEqual(["read sample.bin"]);
		expect(manifest.artifacts[0]?.lastSeenAt).toBe("2026-01-01T00:00:02.000Z");
	});

	test("summarizeArtifactManifest reports counts and entries", () => {
		const manifest: ArtifactManifest = {
			version: 1,
			updatedAt: "2026-01-01T00:00:00.000Z",
			artifacts: [
				{
					path: "/tmp/trace.log",
					type: "log",
					firstSeenAt: "2026-01-01T00:00:00.000Z",
					lastSeenAt: "2026-01-01T00:00:00.000Z",
					provenance: ["tool:bash"],
					relatedCommands: ["strace -o trace.log ./sample"],
					relatedFindings: [],
				},
			],
		};

		const summary = summarizeArtifactManifest(manifest);
		expect(summary).toContain("artifacts: 1");
		expect(summary).toContain("/tmp/trace.log");
		expect(summary).toContain("cmd:strace -o trace.log ./sample");
	});
});
