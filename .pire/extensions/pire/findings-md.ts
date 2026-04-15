import { join } from "node:path";
import type { Exploitability, FindingRecord, FindingStatus, FindingsTracker, Severity, ReproStatus } from "./findings.js";

const VALID_FINDING_STATUSES = new Set<FindingStatus>(["lead", "active", "de-escalated", "report-candidate", "confirmed", "reported", "closed"]);

const STATE_LEGEND = `## State Legend
- \`lead\` — interesting, not yet validated
- \`active\` — validated and under development
- \`de-escalated\` — real bug or anomaly, but current exploitability looks weak
- \`report-candidate\` — strong enough to package
- \`reported\` — submitted
- \`closed\` — invalidated, duplicate, or complete`;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface ParsedSection {
	id: string;
	title: string;
	fields: Map<string, string>;
	listFields: Map<string, string[]>;
}

function stripBackticks(value: string): string {
	return value.replace(/^`+|`+$/g, "").trim();
}

function parseSections(content: string): ParsedSection[] {
	const sections: ParsedSection[] = [];
	let current: ParsedSection | null = null;
	let lastFieldKey: string | null = null;

	for (const rawLine of content.split("\n")) {
		const line = rawLine.trimEnd();

		// Match ##+ ID — title  (supports ## and ###, em-dash and double-hyphen)
		const headingMatch = line.match(/^#{2,3}\s+(\S+)\s+(?:—|--)\s+(.+)$/);
		if (headingMatch) {
			if (current) sections.push(current);
			current = {
				id: headingMatch[1].trim(),
				title: headingMatch[2].trim(),
				fields: new Map(),
				listFields: new Map(),
			};
			lastFieldKey = null;
			continue;
		}

		if (!current) continue;

		// Match - **Field:** value
		const fieldMatch = line.match(/^-\s+\*\*(.+?):\*\*\s*(.*)$/);
		if (fieldMatch) {
			const key = fieldMatch[1].trim().toLowerCase();
			const value = fieldMatch[2].trim();
			current.fields.set(key, value);
			lastFieldKey = key;
			continue;
		}

		// Match list items under a field:   - `item` or   - item
		const listItemMatch = line.match(/^\s+-\s+(.+)$/);
		if (listItemMatch && lastFieldKey) {
			const existing = current.listFields.get(lastFieldKey) ?? [];
			existing.push(stripBackticks(listItemMatch[1].trim()));
			current.listFields.set(lastFieldKey, existing);
			continue;
		}

		// Non-empty indented continuation line — append to last field value
		const continuationMatch = line.match(/^\s{2,}(.+)$/);
		if (continuationMatch && lastFieldKey && !listItemMatch) {
			const prev = current.fields.get(lastFieldKey) ?? "";
			current.fields.set(lastFieldKey, prev ? `${prev}\n${continuationMatch[1].trim()}` : continuationMatch[1].trim());
			continue;
		}

		// Blank or unrecognized line
		if (line.trim() === "") {
			lastFieldKey = null;
		}
	}

	if (current) sections.push(current);
	return sections;
}

function parseStatus(value: string): FindingStatus {
	const cleaned = stripBackticks(value);
	if (cleaned === "candidate") return "lead";
	if (VALID_FINDING_STATUSES.has(cleaned as FindingStatus)) return cleaned as FindingStatus;
	return "lead";
}

function parseSeverity(value: string | undefined): Severity {
	if (!value) return "high";
	const cleaned = value.trim().toLowerCase();
	if (cleaned === "low" || cleaned === "medium" || cleaned === "critical") return cleaned;
	if (cleaned === "high") return "high";
	return "high";
}

function parseReproStatus(value: string | undefined): ReproStatus {
	if (!value) return "not-reproduced";
	const cleaned = value.trim().toLowerCase();
	if (cleaned === "partial") return "partial";
	if (cleaned === "reproduced") return "reproduced";
	return "not-reproduced";
}

export function parseFindingsMd(content: string): FindingRecord[] {
	const sections = parseSections(content);
	const now = new Date().toISOString();

	return sections.map((section) => {
		const stateRaw = section.fields.get("state") ?? "";
		const exploitabilityRaw = section.fields.get("exploitability")?.trim().toLowerCase();
		const exploitability: Exploitability =
			exploitabilityRaw === "standalone-exploitable" ? "standalone-exploitable" :
			exploitabilityRaw === "chain-primitive" ? "chain-primitive" :
			exploitabilityRaw === "informational" ? "informational" :
			"not-assessed";
		const record: FindingRecord = {
			id: section.id,
			title: section.title,
			status: parseStatus(stateRaw),
			severity: parseSeverity(section.fields.get("severity")),
			exploitability,
			statement: section.fields.get("why interesting") ?? section.fields.get("statement") ?? section.title,
			basis: [],
			relatedEvidenceIds: [],
			relatedArtifactIds: [],
			reproStatus: parseReproStatus(section.fields.get("repro")),
			createdAt: now,
			updatedAt: now,
			surface: section.fields.get("surface") || undefined,
			sourceRefs: section.listFields.get("source refs") ?? (section.fields.get("source refs") ? [section.fields.get("source refs")!] : undefined),
			reachability: section.fields.get("current reachability") || undefined,
			validationStatus: section.fields.get("validation status") || undefined,
			nextStep: section.fields.get("next step") || undefined,
			keyArtifacts: section.listFields.get("key artifacts") ?? (section.fields.get("key artifacts") ? [section.fields.get("key artifacts")!] : undefined),
			chainRequires: section.fields.get("chain requires") || undefined,
			standaloneImpact: section.fields.get("standalone impact") || undefined,
			domain: section.fields.get("domain")?.trim().toLowerCase() || undefined,
			subsystem: section.fields.get("subsystem")?.trim().toLowerCase() || undefined,
		};
		return record;
	});
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

export function renderFindingsMd(subsystemName: string, findings: FindingRecord[]): string {
	const lines = [`# Findings — ${subsystemName}`, "", STATE_LEGEND, "", "## Findings", ""];

	for (const record of findings) {
		lines.push(`### ${record.id} — ${record.title}`);
		lines.push(`- **State:** \`${record.status}\``);
		lines.push(`- **Exploitability:** \`${record.exploitability}\``);
		if (record.standaloneImpact) lines.push(`- **Standalone impact:** ${record.standaloneImpact}`);
		if (record.chainRequires) lines.push(`- **Chain requires:** ${record.chainRequires}`);
		if (record.surface) lines.push(`- **Surface:** ${record.surface}`);
		if (record.statement && record.statement !== record.title) {
			lines.push(`- **Why interesting:** ${record.statement}`);
		}
		if (record.sourceRefs && record.sourceRefs.length > 0) {
			lines.push("- **Source refs:**");
			for (const ref of record.sourceRefs) lines.push(`  - \`${ref}\``);
		}
		if (record.reachability) lines.push(`- **Current reachability:** ${record.reachability}`);
		if (record.keyArtifacts && record.keyArtifacts.length > 0) {
			lines.push("- **Key artifacts:**");
			for (const artifact of record.keyArtifacts) lines.push(`  - \`${artifact}\``);
		}
		if (record.validationStatus) lines.push(`- **Validation status:** ${record.validationStatus}`);
		if (record.nextStep) lines.push(`- **Next step:** ${record.nextStep}`);
		lines.push("");
	}

	return `${lines.join("\n").trimEnd()}\n`;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export function mergeFindingsFromMd(tracker: FindingsTracker, mdFindings: FindingRecord[]): void {
	for (const mdFinding of mdFindings) {
		const existing = tracker.findings.find((record) => record.id === mdFinding.id);
		if (existing) {
			// FINDINGS.md wins for human-curated fields
			existing.status = mdFinding.status;
			if (mdFinding.surface) existing.surface = mdFinding.surface;
			if (mdFinding.sourceRefs) existing.sourceRefs = mdFinding.sourceRefs;
			if (mdFinding.reachability) existing.reachability = mdFinding.reachability;
			if (mdFinding.validationStatus) existing.validationStatus = mdFinding.validationStatus;
			if (mdFinding.nextStep) existing.nextStep = mdFinding.nextStep;
			if (mdFinding.keyArtifacts) existing.keyArtifacts = mdFinding.keyArtifacts;
			if (mdFinding.exploitability !== "not-assessed") existing.exploitability = mdFinding.exploitability;
			if (mdFinding.chainRequires) existing.chainRequires = mdFinding.chainRequires;
			if (mdFinding.standaloneImpact) existing.standaloneImpact = mdFinding.standaloneImpact;
			// Domain/subsystem from FINDINGS.md wins when present (stamped from file path)
			if (mdFinding.domain) existing.domain = mdFinding.domain;
			if (mdFinding.subsystem) existing.subsystem = mdFinding.subsystem;
			// Title from FINDINGS.md wins (it's the human-edited label)
			existing.title = mdFinding.title;
			// Statement: use FINDINGS.md version if it has one
			if (mdFinding.statement && mdFinding.statement !== mdFinding.title) {
				existing.statement = mdFinding.statement;
			}
		} else {
			// New finding from FINDINGS.md — add to tracker
			tracker.findings.push(mdFinding);
		}
	}
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

export function resolveFindingsMdPath(cwd: string): string {
	return join(cwd, "FINDINGS.md");
}
