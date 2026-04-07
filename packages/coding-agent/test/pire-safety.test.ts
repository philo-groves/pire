import { describe, expect, test } from "vitest";
import {
	allowActiveProbe,
	allowObservationTarget,
	allowPersistence,
	classifyNetworkTarget,
	createDefaultSafetyPosture,
	summarizeSafetyPosture,
} from "../../../.pire/extensions/pire/safety.js";

describe("pire safety helpers", () => {
	test("classifies local, lab, and external targets", () => {
		expect(classifyNetworkTarget("http://localhost:8080")).toBe("local");
		expect(classifyNetworkTarget("192.168.1.10")).toBe("lab");
		expect(classifyNetworkTarget("https://example.com")).toBe("external");
	});

	test("blocks external observation until safety scope is raised", () => {
		const posture = createDefaultSafetyPosture();
		const blocked = allowObservationTarget(posture, "https://example.com");
		expect(blocked.allowed).toBe(false);
		expect(blocked.reason).toContain("scope is local");

		posture.scope = "external";
		const allowed = allowObservationTarget(posture, "https://example.com");
		expect(allowed.allowed).toBe(true);
	});

	test("requires explicit approval for active probing and persistence", () => {
		const posture = createDefaultSafetyPosture();
		posture.scope = "external";
		posture.intent = "probe";
		expect(allowActiveProbe(posture, "example.com").allowed).toBe(false);

		posture.activeProbing = {
			approved: true,
			target: "example.com",
			justification: "sanctioned lab target",
			approvedAt: "2026-04-06T00:00:00.000Z",
		};
		expect(allowActiveProbe(posture, "example.com").allowed).toBe(true);

		expect(allowPersistence(posture).allowed).toBe(false);
		posture.intent = "persistence";
		expect(allowPersistence(posture).allowed).toBe(true);
	});

	test("summarizes posture state", () => {
		const posture = createDefaultSafetyPosture();
		expect(summarizeSafetyPosture(posture)).toContain("scope: local");
		expect(summarizeSafetyPosture(posture)).toContain("active probing: not approved");
	});
});
