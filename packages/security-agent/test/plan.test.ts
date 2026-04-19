import assert from "node:assert";
import { describe, it } from "node:test";
import { formatPlan, isResearchPlanComplete, mergeResearchPlan, reconcileResearchPlan } from "../src/tools/plan.js";

describe("mergeResearchPlan", () => {
	it("marks removed steps and phases complete while preserving active work", () => {
		const initialPlan = mergeResearchPlan(undefined, {
			phases: [
				{
					name: "Cheap recon",
					status: "in_progress",
					parallel_steps: false,
					steps: [
						{ text: "Inspect ingress parser", status: "in_progress" },
						{ text: "Validate downstream sink", status: "pending" },
					],
				},
				{
					name: "Proof",
					status: "pending",
					parallel_steps: true,
					steps: [{ text: "Build minimal trigger", status: "pending" }],
				},
			],
		});

		const updatedPlan = mergeResearchPlan(initialPlan, {
			phases: [
				{
					name: "Cheap recon",
					status: "in_progress",
					parallel_steps: false,
					steps: [{ text: "Validate downstream sink", status: "in_progress" }],
				},
			],
		});

		assert.strictEqual(updatedPlan.phases.length, 2);
		assert.strictEqual(updatedPlan.phases[0]?.steps[0]?.text, "Inspect ingress parser");
		assert.strictEqual(updatedPlan.phases[0]?.steps[0]?.status, "completed");
		assert.strictEqual(updatedPlan.phases[0]?.steps[1]?.text, "Validate downstream sink");
		assert.strictEqual(updatedPlan.phases[0]?.steps[1]?.status, "in_progress");
		assert.strictEqual(updatedPlan.phases[0]?.status, "in_progress");
		assert.strictEqual(updatedPlan.phases[1]?.name, "Proof");
		assert.strictEqual(updatedPlan.phases[1]?.status, "completed");
		assert.strictEqual(updatedPlan.phases[1]?.steps[0]?.status, "completed");
	});

	it("honors explicit completed statuses and formats saved markers", () => {
		const initialPlan = mergeResearchPlan(undefined, {
			phases: [
				{
					name: "Write-up",
					status: "in_progress",
					parallel_steps: false,
					steps: [{ text: "Draft issue summary", status: "in_progress" }],
				},
			],
		});

		const completedPlan = mergeResearchPlan(initialPlan, {
			phases: [
				{
					name: "Write-up",
					status: "completed",
					parallel_steps: false,
					steps: [{ text: "Draft issue summary", status: "completed" }],
				},
			],
		});

		assert.strictEqual(isResearchPlanComplete(completedPlan), true);
		assert.match(formatPlan(completedPlan), /\[x\] Draft issue summary/);
		assert.match(formatPlan(completedPlan), /Phase 1: Write-up \[complete\]/);
	});

	it("preserves completed steps when later plan updates resend them as pending", () => {
		const initialPlan = mergeResearchPlan(undefined, {
			phases: [
				{
					name: "Cheap recon",
					status: "in_progress",
					parallel_steps: true,
					steps: [
						{ text: "Map ingress parser", status: "completed" },
						{ text: "Trace trust boundary", status: "in_progress" },
					],
				},
			],
		});

		const updatedPlan = mergeResearchPlan(initialPlan, {
			phases: [
				{
					name: "Cheap recon",
					status: "in_progress",
					parallel_steps: true,
					steps: [
						{ text: "Map ingress parser", status: "pending" },
						{ text: "Trace trust boundary", status: "pending" },
					],
				},
			],
		});

		assert.strictEqual(updatedPlan.phases[0]?.steps[0]?.status, "completed");
		assert.strictEqual(updatedPlan.phases[0]?.steps[1]?.status, "pending");
	});

	it("auto-completes finished parallel recon from the final response evidence", () => {
		const plan = mergeResearchPlan(undefined, {
			phases: [
				{
					name: "Controllers recon",
					status: "in_progress",
					parallel_steps: true,
					steps: [
						{
							text: "Map SnapController install/update/request-handling entrypoints and trust boundaries",
							status: "pending",
						},
						{
							text: "Map location handlers and registry resolution paths for npm/http/local snaps",
							status: "pending",
						},
						{
							text: "Identify candidate auth/state/permission mismatches with target-backed evidence anchors",
							status: "pending",
						},
					],
				},
			],
		});

		const evidence = `
I dug into packages/snaps-controllers and mapped the main control paths.

What matters most in SnapController
• installSnaps(...)
• #processRequestedSnap(...)
• #updateSnap(...)
• handleRequest(...)

Location handling
• detectSnapLocation(...) supports npm, local, and http/https snaps
• packages/snaps-controllers/src/snaps/location/location.ts

Most interesting candidate so far
I found a real logic-gap candidate around initialConnections.

Observed implementation
• On install/update, SnapController processes manifest.initialConnections
• For each listed origin, it calls #addSnapToSubject(origin, snapId)

Source anchors
• packages/snaps-controllers/src/snaps/SnapController.ts:2398
• packages/snaps-controllers/src/snaps/SnapController.ts:2419
• packages/snaps-controllers/src/snaps/SnapController.ts:2463
`;

		const reconciled = reconcileResearchPlan(plan, evidence);

		assert.strictEqual(reconciled.changed, true);
		assert.strictEqual(reconciled.cleared, true);
		assert.strictEqual(reconciled.plan, undefined);
	});

	it("closes the last remaining parallel step after the rest of the phase is covered", () => {
		const plan = mergeResearchPlan(undefined, {
			phases: [
				{
					name: "Controllers recon",
					status: "in_progress",
					parallel_steps: true,
					steps: [
						{
							text: "Map SnapController install/update/request-handling entrypoints and trust boundaries",
							status: "pending",
						},
						{
							text: "Map location handlers and registry resolution paths for npm/http/local snaps",
							status: "pending",
						},
						{
							text: "Identify candidate auth/state/permission mismatches with target-backed evidence anchors",
							status: "pending",
						},
					],
				},
			],
		});

		const evidence = `
I dug into packages/snaps-controllers and mapped the main control paths.

What matters most in SnapController
• installSnaps(...)
• #processRequestedSnap(...)
• #updateSnap(...)
• handleRequest(...)

Location handling
• detectSnapLocation(...) supports npm, local, and http/https snaps
• packages/snaps-controllers/src/snaps/location/location.ts

Bottom line
• The parallel recon is done and the strongest next move is to validate the candidate path rather than keep broadening the controller mapping.
`;

		const reconciled = reconcileResearchPlan(plan, evidence);

		assert.strictEqual(reconciled.changed, true);
		assert.strictEqual(reconciled.cleared, true);
		assert.strictEqual(reconciled.plan, undefined);
	});

	it("finishes a sequential phase when the final response covers both the active and next pending step", () => {
		const plan = mergeResearchPlan(undefined, {
			phases: [
				{
					name: "Trace execution-environment capability surfaces",
					status: "in_progress",
					parallel_steps: false,
					steps: [
						{
							text: "Inspect snap.request and provider routing allowlists in BaseSnapExecutor/common utils",
							status: "in_progress",
						},
						{
							text: "Look for methods or namespaces exposed without matching permission/endowment gates",
							status: "pending",
						},
					],
				},
			],
		});

		const evidence = `
Current focus
• BaseSnapExecutor + common/utils.ts
• snap.request routing
• wallet_* and snap_* allowlists
• mismatches between runtime exposure and intended endowment gates

Key source anchors I’m now tracing
• packages/snaps-execution-environments/src/common/BaseSnapExecutor.ts
• packages/snaps-execution-environments/src/common/utils.ts

Important observation from this pass
• snap.request(...) still fundamentally gates by method-name allow/block lists, not by endowment membership at the runtime boundary.

Next likely path
• Look for additional wallet_* methods that are:
  1. exposed through snap.request,
  2. not blocked in common/utils.ts,
  3. but intended to require a permission/endowment elsewhere.
`;

		const reconciled = reconcileResearchPlan(plan, evidence);

		assert.strictEqual(reconciled.changed, true);
		assert.strictEqual(reconciled.cleared, true);
		assert.strictEqual(reconciled.plan, undefined);
	});

	it("closes the final pending task in the last sequential phase from a blocker-and-next-step wrap-up", () => {
		const plan = mergeResearchPlan(undefined, {
			phases: [
				{
					name: "Rank reachable extension attack surfaces",
					status: "completed",
					parallel_steps: false,
					steps: [
						{
							text: "Inspect repository structure and identify hot modules/trust boundaries",
							status: "completed",
						},
						{ text: "Record a ranked surface map for the extension target", status: "completed" },
						{ text: "Choose the hottest evidence-backed surface for first deep dive", status: "completed" },
					],
				},
				{
					name: "Begin focused source review",
					status: "in_progress",
					parallel_steps: false,
					steps: [
						{ text: "Inspect the chosen hot surface for a concrete bug hypothesis", status: "completed" },
						{ text: "Record proof blockers or validation avenues before broadening", status: "pending" },
					],
				},
			],
		});

		const evidence = `
Why this matters
• app/scripts/lib/snap-keyring/keyring-snaps-permissions.ts grants website keyring methods if metadata says SubjectType.Website.

What is still only a candidate
• I have not yet proven end-to-end that missing metadata on the extension path produces unauthorized snap RPC or keyring access.
• I also haven’t yet ruled out a later metadata population path elsewhere.

Best next step
• Build a focused test/repro on the extension path:
  1. prove snap-origin provider setup does not register SubjectType.Snap
  2. trace whether that origin reaches snap/keyring auth with missing metadata
  3. compare behavior with and without explicit snap metadata

If you want, I’ll continue directly on that path and try to turn it into a target-backed repro.
`;

		const reconciled = reconcileResearchPlan(plan, evidence);

		assert.strictEqual(reconciled.changed, true);
		assert.strictEqual(reconciled.cleared, true);
		assert.strictEqual(reconciled.plan, undefined);
	});
});
