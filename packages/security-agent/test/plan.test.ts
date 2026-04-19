import assert from "node:assert";
import { describe, it } from "node:test";
import { formatPlan, isResearchPlanComplete, mergeResearchPlan } from "../src/tools/plan.js";

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
});
