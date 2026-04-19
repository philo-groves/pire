import assert from "node:assert";
import { describe, it } from "node:test";
import type { LogicMapData } from "../src/logic-map/store.js";
import { buildRecommendedActions } from "../src/runtime.js";
import type { SurfaceMapData } from "../src/surface-map/store.js";
import type { WorkspaceGraphData } from "../src/workspace-graph/store.js";

describe("buildRecommendedActions", () => {
	it("filters promoted closed-loop surfaces and adjacent surfaces already covered by confirmed findings", () => {
		const notebook = {};
		const logicMap: LogicMapData = { rules: {} };
		const surfaceMap: SurfaceMapData = {
			surfaces: {
				"module:push-message-sender": {
					id: "module:push-message-sender",
					kind: "module",
					label: "PushMessageSender",
					score: 5,
					status: "active",
					why: "Validated and promoted internal push trust-boundary mismatch: suffix paths are accepted.",
					evidence: [],
					adjacent: [],
					updatedAt: "2026-04-19T11:00:00.000Z",
				},
				"module:request-authority-reconstruction": {
					id: "module:request-authority-reconstruction",
					kind: "module",
					label: "HttpRequestMessageImpl original authority reconstruction",
					score: 5,
					status: "hot",
					why: "Adjacent to confirmed X-Forwarded-Host strip gap.",
					evidence: [],
					adjacent: [],
					updatedAt: "2026-04-19T11:01:00.000Z",
				},
			},
		};
		const workspaceGraph: WorkspaceGraphData = {
			version: 1,
			nodes: {
				"finding:push-message-sender": {
					id: "finding:push-message-sender",
					kind: "finding",
					label: "internal push trust-boundary mismatch",
					score: 5,
					status: "confirmed",
					summary: "Validated and promoted internal push trust-boundary mismatch.",
					text: "Promoted durable finding for module:push-message-sender.",
					tags: ["finding", "module:push-message-sender"],
					source: "finding_gate",
					terms: {},
					updatedAt: "2026-04-19T11:02:00.000Z",
				},
				"finding:x-originating-url": {
					id: "finding:zuul-sample-reflects-untrusted-x-forwarded-host-into-client-facing-x-originating",
					kind: "finding",
					label: "zuul-sample reflects untrusted X-Forwarded-Host into client-facing X-Originating-Url",
					score: 5,
					status: "confirmed",
					summary:
						"In HttpRequestMessageImpl original authority reconstruction, reconstructURI reflects untrusted X-Forwarded-Host into X-Originating-Url.",
					text: "Real path proof exists for HttpRequestMessageImpl original authority reconstruction.",
					tags: ["finding"],
					source: "finding_gate",
					terms: {},
					updatedAt: "2026-04-19T11:03:00.000Z",
				},
				"module:fresh-unexplored-boundary": {
					id: "module:fresh-unexplored-boundary",
					kind: "module",
					label: "Fresh unexplored boundary",
					score: 4,
					status: "candidate",
					summary: "Untouched ingress candidate for a new branch.",
					text: "Untouched ingress candidate for a new branch.",
					tags: ["auth"],
					source: "workspace_seed",
					terms: {},
					updatedAt: "2026-04-19T11:04:00.000Z",
				},
			},
			edges: [
				{
					from: "finding:push-message-sender",
					to: "module:push-message-sender",
					relation: "touches",
					weight: 1,
					updatedAt: "2026-04-19T11:02:00.000Z",
				},
			],
		};

		const recommendations = buildRecommendedActions(notebook, logicMap, surfaceMap, workspaceGraph, 4);
		assert.ok(recommendations);
		assert.doesNotMatch(recommendations, /PushMessageSender/);
		assert.doesNotMatch(recommendations, /HttpRequestMessageImpl original authority reconstruction/);
		assert.match(recommendations, /Fresh unexplored boundary/);
	});
});
