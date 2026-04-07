import { URL } from "node:url";

export type PireSafetyScope = "local" | "lab" | "external";
export type PireSafetyIntent = "observe" | "probe" | "exploit" | "persistence";
export type PireNetworkClass = "local" | "lab" | "external" | "unknown";

export interface PireSafetyPosture {
	version: 1;
	scope: PireSafetyScope;
	intent: PireSafetyIntent;
	activeProbing: {
		approved: boolean;
		target?: string;
		justification?: string;
		approvedAt?: string;
	};
	updatedAt: string;
}

export interface SafetyDecision {
	allowed: boolean;
	reason?: string;
	classification?: PireNetworkClass;
}

export const ACTIVE_PROBING_PATTERNS = [
	/\bnmap\b/i,
	/\bmasscan\b/i,
	/\bzmap\b/i,
	/\bgobuster\b/i,
	/\bffuf\b/i,
	/\bwfuzz\b/i,
	/\bnikto\b/i,
	/\bsqlmap\b/i,
];

export const PERSISTENCE_PATTERNS = [
	/\bcrontab\b/i,
	/\b(systemctl|service)\s+\S+\s+enable\b/i,
	/\blaunchctl\s+load\b/i,
	/\bssh-copy-id\b/i,
	/\bauthorized_keys\b/i,
	/\b(useradd|adduser)\b/i,
	/\bschtasks\b/i,
	/\breg\s+add\b.*\\Run/i,
];

function normalizeTarget(input: string): string {
	return input.trim();
}

function parseTargetHost(target: string): string | undefined {
	const normalized = normalizeTarget(target);
	if (normalized.length === 0) {
		return undefined;
	}

	try {
		const url = new URL(normalized);
		return url.hostname.toLowerCase();
	} catch {}

	return normalized
		.replace(/^[a-z]+:\/\//i, "")
		.replace(/[:/].*$/, "")
		.toLowerCase();
}

function isPrivateIpv4(host: string): boolean {
	const parts = host.split(".").map((part) => Number.parseInt(part, 10));
	if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) {
		return false;
	}
	return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

export function createDefaultSafetyPosture(): PireSafetyPosture {
	return {
		version: 1,
		scope: "local",
		intent: "observe",
		activeProbing: {
			approved: false,
		},
		updatedAt: new Date().toISOString(),
	};
}

export function classifyNetworkTarget(target: string): PireNetworkClass {
	const host = parseTargetHost(target);
	if (!host) {
		return "unknown";
	}
	if (
		host === "localhost" ||
		host === "127.0.0.1" ||
		host === "::1" ||
		host === "[::1]" ||
		host === "0.0.0.0"
	) {
		return "local";
	}
	if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) {
		return "lab";
	}
	if (isPrivateIpv4(host)) {
		return "lab";
	}
	if (!host.includes(".")) {
		return "lab";
	}
	return "external";
}

export function summarizeSafetyPosture(posture: PireSafetyPosture): string {
	const lines = [
		"Pire Safety Posture",
		`- updated: ${posture.updatedAt}`,
		`- scope: ${posture.scope}`,
		`- intent: ${posture.intent}`,
	];
	if (posture.activeProbing.approved) {
		lines.push(`- active probing: approved for ${posture.activeProbing.target ?? "unspecified target"}`);
		if (posture.activeProbing.justification) {
			lines.push(`- justification: ${posture.activeProbing.justification}`);
		}
	} else {
		lines.push("- active probing: not approved");
	}
	return lines.join("\n");
}

export function buildSafetyPrompt(posture: PireSafetyPosture): string {
	const lines = [
		"[PIRE SAFETY]",
		`Current target scope: ${posture.scope}.`,
		`Current operation intent: ${posture.intent}.`,
		"Separate local/offline research from live external interaction.",
		"Treat observation, active probing, exploitation, and persistence as distinct escalation levels.",
		"Within the current posture, keep moving with benign local analysis instead of repeatedly restating that work is read-only.",
	];
	if (posture.activeProbing.approved) {
		lines.push(
			`Active probing was explicitly approved for ${posture.activeProbing.target ?? "the current target"}; stay within that scope.`,
		);
	} else {
		lines.push("Do not perform active scanning or high-volume probing without explicit approval recorded through the safety controls.");
	}
	return lines.join("\n");
}

export function allowObservationTarget(posture: PireSafetyPosture, target: string): SafetyDecision {
	const classification = classifyNetworkTarget(target);
	if (classification === "unknown") {
		return { allowed: true, classification };
	}
	if (classification === "external" && posture.scope !== "external") {
		return {
			allowed: false,
			classification,
			reason: `External observation is blocked while safety scope is ${posture.scope}. Use /safety scope external before touching ${target}.`,
		};
	}
	if (classification === "lab" && posture.scope === "local") {
		return {
			allowed: false,
			classification,
			reason: `Lab targets are blocked while safety scope is local. Use /safety scope lab before touching ${target}.`,
		};
	}
	return { allowed: true, classification };
}

export function allowActiveProbe(posture: PireSafetyPosture, target?: string): SafetyDecision {
	if (posture.intent === "observe") {
		return {
			allowed: false,
			reason: "Active probing is blocked while safety intent is observe. Use /safety intent probe or a higher posture first.",
		};
	}
	if (!posture.activeProbing.approved) {
		return {
			allowed: false,
			reason: "Active probing requires explicit approval. Use /safety approve-probing <target> :: <justification> first.",
		};
	}
	if (posture.scope === "local") {
		return {
			allowed: false,
			reason: "Active probing is blocked while safety scope is local. Switch to /safety scope lab or /safety scope external first.",
		};
	}
	if (!target) {
		return { allowed: true };
	}

	const classification = classifyNetworkTarget(target);
	if (classification === "external" && posture.scope !== "external") {
		return {
			allowed: false,
			classification,
			reason: `This probe targets an external host (${target}) but the current safety scope is ${posture.scope}.`,
		};
	}
	return { allowed: true, classification };
}

export function allowPersistence(posture: PireSafetyPosture): SafetyDecision {
	if (posture.intent !== "persistence") {
		return {
			allowed: false,
			reason: "Persistence-oriented commands are blocked unless safety intent is explicitly set to persistence.",
		};
	}
	return { allowed: true };
}
