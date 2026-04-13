import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { CampaignLedger } from "./campaign.js";
import { mapFindingStatusToCampaignStatus } from "./campaign.js";
import type { FindingRecord, FindingStatus, FindingsTracker, ReproStatus } from "./findings.js";
import { parseFindingsMd } from "./findings-md.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DriftSeverity = "error" | "warning" | "info";

export interface DriftEntry {
	severity: DriftSeverity;
	category: "state-drift" | "invariant" | "orphan" | "layout";
	findingId?: string;
	message: string;
}

export interface DriftReport {
	entries: DriftEntry[];
	checkedAt: string;
}

// ---------------------------------------------------------------------------
// 1. State drift: session tracker vs campaign ledger
// ---------------------------------------------------------------------------

function checkTrackerCampaignDrift(tracker: FindingsTracker, ledger: CampaignLedger): DriftEntry[] {
	const entries: DriftEntry[] = [];

	for (const finding of tracker.findings) {
		const campaignRecord = ledger.findings.find((r) => r.id === finding.id);
		const expectedCampaignStatus = mapFindingStatusToCampaignStatus(finding);

		if (!campaignRecord) {
			// Finding exists in tracker but not in campaign
			if (finding.status !== "closed") {
				entries.push({
					severity: "warning",
					category: "state-drift",
					findingId: finding.id,
					message: `${finding.id} exists in session tracker [${finding.status}] but is missing from campaign ledger`,
				});
			}
			continue;
		}

		if (campaignRecord.status !== expectedCampaignStatus) {
			entries.push({
				severity: "error",
				category: "state-drift",
				findingId: finding.id,
				message: `${finding.id} status mismatch: session=${finding.status}, campaign=${campaignRecord.status}, expected-campaign=${expectedCampaignStatus}`,
			});
		}
	}

	return entries;
}

// ---------------------------------------------------------------------------
// 2. Invariant lint: impossible status/repro combinations
// ---------------------------------------------------------------------------

const IMPLIES_RUNTIME: Set<FindingStatus> = new Set(["confirmed", "report-candidate", "reported"]);
const IMPLIES_EARLY: Set<FindingStatus> = new Set(["lead"]);

function checkInvariants(tracker: FindingsTracker): DriftEntry[] {
	const entries: DriftEntry[] = [];

	for (const finding of tracker.findings) {
		// confirmed/report-candidate/reported with not-reproduced
		if (IMPLIES_RUNTIME.has(finding.status) && finding.reproStatus === "not-reproduced") {
			entries.push({
				severity: "warning",
				category: "invariant",
				findingId: finding.id,
				message: `${finding.id} is ${finding.status} but reproStatus=not-reproduced — expected at least partial`,
			});
		}

		// lead with reproduced
		if (IMPLIES_EARLY.has(finding.status) && finding.reproStatus === "reproduced") {
			entries.push({
				severity: "warning",
				category: "invariant",
				findingId: finding.id,
				message: `${finding.id} is ${finding.status} but reproStatus=reproduced — should it be confirmed or report-candidate?`,
			});
		}

		// closed with a non-empty nextStep
		if (finding.status === "closed" && finding.nextStep) {
			entries.push({
				severity: "info",
				category: "invariant",
				findingId: finding.id,
				message: `${finding.id} is closed but still has a next step — consider clearing it`,
			});
		}
	}

	return entries;
}

// ---------------------------------------------------------------------------
// 3. Repo reconciliation: domain FINDINGS.md vs tracker
// ---------------------------------------------------------------------------

async function scanDomainFindings(cwd: string): Promise<Array<{ path: string; findings: FindingRecord[] }>> {
	const domainsDir = join(cwd, "domains");
	if (!existsSync(domainsDir)) return [];

	const results: Array<{ path: string; findings: FindingRecord[] }> = [];

	try {
		const domains = await readdir(domainsDir, { withFileTypes: true });
		for (const domain of domains) {
			if (!domain.isDirectory()) continue;
			const domainPath = join(domainsDir, domain.name);
			const subsystems = await readdir(domainPath, { withFileTypes: true });
			for (const subsystem of subsystems) {
				if (!subsystem.isDirectory()) continue;
				const findingsPath = join(domainPath, subsystem.name, "FINDINGS.md");
				if (!existsSync(findingsPath)) continue;
				try {
					const content = await readFile(findingsPath, "utf-8");
					const findings = parseFindingsMd(content);
					if (findings.length > 0) {
						results.push({ path: findingsPath, findings });
					}
				} catch {
					// Skip unparseable files
				}
			}
		}
	} catch {
		// domains dir not readable
	}

	return results;
}

/**
 * Check if a domain finding (using subsystem ID like KERNEL-NCTRL-002) matches a tracker
 * finding (using find-NNN ID but with subsystem tag in title).
 */
function domainFindingMatchesTracker(domainFinding: FindingRecord, tracker: FindingsTracker): boolean {
	// Direct ID match (rare — domain uses subsystem IDs, tracker uses find-NNN)
	if (tracker.findings.some((f) => f.id === domainFinding.id)) return true;
	// Match by subsystem tag in title: tracker title starts with the domain finding's ID
	if (tracker.findings.some((f) => f.title.startsWith(domainFinding.id))) return true;
	// Match by title overlap
	if (tracker.findings.some((f) => f.title === domainFinding.title)) return true;
	return false;
}

function checkOrphanedFindings(
	tracker: FindingsTracker,
	domainFindings: Array<{ path: string; findings: FindingRecord[] }>,
): DriftEntry[] {
	const entries: DriftEntry[] = [];

	const HIGH_PRIORITY_STATUSES: Set<FindingStatus> = new Set(["active", "confirmed", "report-candidate", "reported"]);

	for (const { path, findings } of domainFindings) {
		for (const finding of findings) {
			if (!domainFindingMatchesTracker(finding, tracker)) {
				// Only warn for active/confirmed/report-candidate orphans; leads are info-level
				const severity: DriftSeverity = HIGH_PRIORITY_STATUSES.has(finding.status) ? "warning" : "info";
				entries.push({
					severity,
					category: "orphan",
					findingId: finding.id,
					message: `${finding.id} [${finding.status}] exists in ${path} but not in session tracker`,
				});
			}
		}
	}

	// Reverse: tracker findings not reflected in any domain FINDINGS.md
	if (domainFindings.length > 0) {
		const allDomainTitles = new Set(domainFindings.flatMap((df) => df.findings.map((f) => f.title)));
		const allDomainTags = new Set(domainFindings.flatMap((df) => df.findings.map((f) => f.id)));
		for (const finding of tracker.findings) {
			if (finding.status === "closed") continue;
			// Check if tracker finding's title contains a known domain tag
			const tag = finding.title.match(/^([A-Z][\w-]+-\d{3})\b/)?.[1];
			const inDomain = tag ? allDomainTags.has(tag) : allDomainTitles.has(finding.title);
			if (!inDomain) {
				entries.push({
					severity: "info",
					category: "orphan",
					findingId: finding.id,
					message: `${finding.id} (${finding.title}) is in session tracker but not in any domains/**/FINDINGS.md`,
				});
			}
		}
	}

	return entries;
}

// ---------------------------------------------------------------------------
// 4. Layout lint: subsystem tag vs path
// ---------------------------------------------------------------------------

function extractSubsystemPrefix(title: string): { domain: string; subsystem: string } | undefined {
	// Match patterns like KERNEL-NCTRL-002, COMMS-RAPPORT-001, COMMS-SIDECARRELAY-001
	const m = title.match(/^([A-Z]+)-([A-Z][\w]*)-\d{3}\b/);
	if (!m) return undefined;
	return { domain: m[1].toLowerCase(), subsystem: m[2].toLowerCase() };
}

function checkLayoutLint(
	domainFindings: Array<{ path: string; findings: FindingRecord[] }>,
): DriftEntry[] {
	const entries: DriftEntry[] = [];

	for (const { path, findings } of domainFindings) {
		// Extract domain/subsystem from path: domains/{domain}/{subsystem}/FINDINGS.md
		const pathMatch = path.match(/domains\/([^/]+)\/([^/]+)\/FINDINGS\.md$/);
		if (!pathMatch) continue;
		const pathDomain = pathMatch[1];
		const pathSubsystem = pathMatch[2];

		for (const finding of findings) {
			const tagPrefix = extractSubsystemPrefix(finding.title);
			if (!tagPrefix) continue;

			if (tagPrefix.subsystem !== pathSubsystem.replace(/-/g, "")) {
				entries.push({
					severity: "warning",
					category: "layout",
					findingId: finding.id,
					message: `${finding.id} tag prefix ${tagPrefix.domain.toUpperCase()}-${tagPrefix.subsystem.toUpperCase()} is stored under ${pathDomain}/${pathSubsystem} — consider creating domains/${tagPrefix.domain}/${tagPrefix.subsystem}/`,
				});
			}
		}
	}

	return entries;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runDriftCheck(
	cwd: string,
	tracker: FindingsTracker,
	ledger: CampaignLedger,
): Promise<DriftReport> {
	const domainFindings = await scanDomainFindings(cwd);
	const entries: DriftEntry[] = [
		...checkTrackerCampaignDrift(tracker, ledger),
		...checkInvariants(tracker),
		...checkOrphanedFindings(tracker, domainFindings),
		...checkLayoutLint(domainFindings),
	];

	return {
		entries,
		checkedAt: new Date().toISOString(),
	};
}

/** Auto-fix safe invariant violations. Returns number of fixes applied. */
export function autoFixInvariants(tracker: FindingsTracker): number {
	let fixes = 0;

	for (const finding of tracker.findings) {
		// Auto-promote reproStatus for confirmed/report-candidate/reported findings
		if (IMPLIES_RUNTIME.has(finding.status) && finding.reproStatus === "not-reproduced") {
			finding.reproStatus = "partial";
			fixes++;
		}
	}

	return fixes;
}

export function formatDriftReport(report: DriftReport): string {
	if (report.entries.length === 0) {
		return "";
	}

	const lines = ["[STATE INTEGRITY CHECK]"];
	const errors = report.entries.filter((e) => e.severity === "error");
	const warnings = report.entries.filter((e) => e.severity === "warning");
	const infos = report.entries.filter((e) => e.severity === "info");

	if (errors.length > 0) {
		for (const e of errors) {
			lines.push(`ERROR [${e.category}] ${e.message}`);
		}
	}
	if (warnings.length > 0) {
		for (const w of warnings) {
			lines.push(`WARN [${w.category}] ${w.message}`);
		}
	}
	if (infos.length > 0) {
		for (const i of infos.slice(0, 3)) {
			lines.push(`INFO [${i.category}] ${i.message}`);
		}
		if (infos.length > 3) {
			lines.push(`... and ${infos.length - 3} more info items`);
		}
	}

	lines.push("Use /campaign-sync to reconcile campaign state from session tracker. Use research_tracker add_finding to import orphaned findings.");

	return lines.join("\n");
}
