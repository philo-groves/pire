import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";

export type ArtifactType =
	| "binary"
	| "text"
	| "image"
	| "pcap"
	| "firmware"
	| "dump"
	| "trace"
	| "log"
	| "report"
	| "note"
	| "json"
	| "other";

export interface ArtifactRecord {
	path: string;
	type: ArtifactType;
	sha256?: string;
	size?: number;
	modifiedAt?: string;
	firstSeenAt: string;
	lastSeenAt: string;
	provenance: string[];
	relatedCommands: string[];
	relatedFindings: string[];
}

export interface ArtifactManifest {
	version: 1;
	updatedAt: string;
	artifacts: ArtifactRecord[];
}

export interface ArtifactManifestSummary {
	total: number;
	byType: Partial<Record<ArtifactType, number>>;
	recentPaths: string[];
}

export interface ArtifactObservation {
	path: string;
	type?: ArtifactType;
	provenance: string;
	command?: string;
	finding?: string;
	timestamp?: string;
}

const MANIFEST_DIR = ".pire";
const MANIFEST_FILE = "artifacts.json";

function dedupe(values: string[]): string[] {
	return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function createEmptyManifest(): ArtifactManifest {
	return {
		version: 1,
		updatedAt: new Date().toISOString(),
		artifacts: [],
	};
}

async function hashFileSha256(path: string): Promise<string | undefined> {
	return new Promise((resolveHash) => {
		const hash = createHash("sha256");
		const stream = createReadStream(path);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("error", () => resolveHash(undefined));
		stream.on("end", () => resolveHash(hash.digest("hex")));
	});
}

export function inferArtifactType(path: string): ArtifactType {
	const normalized = path.toLowerCase();
	const extension = extname(normalized);

	if (extension === ".pcap" || extension === ".pcapng") return "pcap";
	if (extension === ".bin" || extension === ".elf" || extension === ".so" || extension === ".dll" || extension === ".exe")
		return "binary";
	if (extension === ".img" || extension === ".iso" || extension === ".squashfs" || extension === ".ubifs") return "firmware";
	if (extension === ".dmp" || extension === ".core") return "dump";
	if (extension === ".trace" || extension === ".strace" || extension === ".ltrace" || extension === ".perf") return "trace";
	if (extension === ".log") return "log";
	if (extension === ".md" || extension === ".adoc" || extension === ".rst") return normalized.includes("report") ? "report" : "note";
	if (extension === ".json") return "json";
	if (extension === ".png" || extension === ".jpg" || extension === ".jpeg" || extension === ".gif" || extension === ".webp")
		return "image";
	if (
		extension === ".txt" ||
		extension === ".c" ||
		extension === ".cc" ||
		extension === ".cpp" ||
		extension === ".h" ||
		extension === ".py" ||
		extension === ".js" ||
		extension === ".ts" ||
		extension === ".rs" ||
		extension === ".go"
	) {
		return "text";
	}

	return "other";
}

export async function snapshotArtifact(path: string): Promise<Pick<ArtifactRecord, "sha256" | "size" | "modifiedAt">> {
	if (!existsSync(path)) {
		return {};
	}

	try {
		const stats = await stat(path);
		if (!stats.isFile()) {
			return {};
		}

		return {
			sha256: await hashFileSha256(path),
			size: stats.size,
			modifiedAt: stats.mtime.toISOString(),
		};
	} catch {
		return {};
	}
}

export async function recordArtifact(
	manifest: ArtifactManifest,
	observation: ArtifactObservation,
): Promise<ArtifactManifest> {
	const timestamp = observation.timestamp ?? new Date().toISOString();
	const snapshot = await snapshotArtifact(observation.path);
	const existing = manifest.artifacts.find((artifact) => artifact.path === observation.path);

	if (existing) {
		existing.type = observation.type ?? existing.type;
		existing.sha256 = snapshot.sha256 ?? existing.sha256;
		existing.size = snapshot.size ?? existing.size;
		existing.modifiedAt = snapshot.modifiedAt ?? existing.modifiedAt;
		existing.lastSeenAt = timestamp;
		existing.provenance = dedupe([...existing.provenance, observation.provenance]);
		existing.relatedCommands = dedupe([...existing.relatedCommands, observation.command ?? ""]);
		existing.relatedFindings = dedupe([...existing.relatedFindings, observation.finding ?? ""]);
		manifest.updatedAt = timestamp;
		return manifest;
	}

	manifest.artifacts.push({
		path: observation.path,
		type: observation.type ?? inferArtifactType(observation.path),
		sha256: snapshot.sha256,
		size: snapshot.size,
		modifiedAt: snapshot.modifiedAt,
		firstSeenAt: timestamp,
		lastSeenAt: timestamp,
		provenance: dedupe([observation.provenance]),
		relatedCommands: dedupe([observation.command ?? ""]),
		relatedFindings: dedupe([observation.finding ?? ""]),
	});
	manifest.updatedAt = timestamp;
	return manifest;
}

export async function loadArtifactManifest(cwd: string): Promise<ArtifactManifest> {
	const manifestPath = join(cwd, MANIFEST_DIR, MANIFEST_FILE);
	if (!existsSync(manifestPath)) {
		return createEmptyManifest();
	}

	try {
		const raw = await readFile(manifestPath, "utf-8");
		const parsed = JSON.parse(raw) as Partial<ArtifactManifest>;
		return {
			version: 1,
			updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
			artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
		};
	} catch {
		return createEmptyManifest();
	}
}

export async function saveArtifactManifest(cwd: string, manifest: ArtifactManifest): Promise<string> {
	const manifestDir = join(cwd, MANIFEST_DIR);
	const manifestPath = join(manifestDir, MANIFEST_FILE);
	await mkdir(manifestDir, { recursive: true });
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
	return manifestPath;
}

export function buildArtifactManifestSummary(manifest: ArtifactManifest): ArtifactManifestSummary {
	const byType: Partial<Record<ArtifactType, number>> = {};
	const sortedArtifacts = [...manifest.artifacts].sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));

	for (const artifact of manifest.artifacts) {
		byType[artifact.type] = (byType[artifact.type] ?? 0) + 1;
	}

	return {
		total: manifest.artifacts.length,
		byType,
		recentPaths: sortedArtifacts.slice(0, 5).map((artifact) => artifact.path),
	};
}

function matchesArtifactFilter(artifact: ArtifactRecord, filterText: string): boolean {
	const normalizedFilter = filterText.trim().toLowerCase();
	if (normalizedFilter.length === 0) {
		return true;
	}

	return (
		artifact.type.toLowerCase() === normalizedFilter ||
		artifact.path.toLowerCase().includes(normalizedFilter) ||
		artifact.relatedCommands.some((command) => command.toLowerCase().includes(normalizedFilter)) ||
		artifact.relatedFindings.some((finding) => finding.toLowerCase().includes(normalizedFilter))
	);
}

export function summarizeArtifactManifest(manifest: ArtifactManifest, filterText?: string): string {
	const filteredArtifacts = filterText ? manifest.artifacts.filter((artifact) => matchesArtifactFilter(artifact, filterText)) : manifest.artifacts;
	if (filteredArtifacts.length === 0) {
		return filterText
			? `Artifact Manifest\n- filter: ${filterText}\n- no matching artifacts`
			: "Artifact Manifest\n- no artifacts recorded yet";
	}

	const summary = buildArtifactManifestSummary({ ...manifest, artifacts: filteredArtifacts });
	const lines = [
		`Artifact Manifest`,
		`- updated: ${manifest.updatedAt}`,
		`- artifacts: ${filteredArtifacts.length}`,
	];

	if (filterText) {
		lines.push(`- filter: ${filterText}`);
	}

	const typeCounts = Object.entries(summary.byType)
		.sort((left, right) => left[0].localeCompare(right[0]))
		.map(([type, count]) => `${type}:${count}`)
		.join(", ");
	if (typeCounts.length > 0) {
		lines.push(`- by type: ${typeCounts}`);
	}

	for (const artifact of filteredArtifacts.slice(0, 15)) {
		const meta: string[] = [artifact.type];
		if (artifact.sha256) {
			meta.push(`sha256:${artifact.sha256.slice(0, 12)}`);
		}
		if (artifact.relatedCommands.length > 0) {
			meta.push(`cmd:${artifact.relatedCommands[0]}`);
		}
		lines.push(`- ${artifact.path} (${meta.join(", ")})`);
	}

	if (filteredArtifacts.length > 15) {
		lines.push(`- ... ${filteredArtifacts.length - 15} more artifacts`);
	}

	return lines.join("\n");
}

export function resolveArtifactPath(cwd: string, artifactPath: string): string {
	return isAbsolute(artifactPath) ? artifactPath : resolve(cwd, artifactPath);
}
