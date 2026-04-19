import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@mariozechner/pi-ai";
import type { NotebookStore } from "../notebook/store.js";

export type PlanItemStatus = "pending" | "in_progress" | "completed";

export interface ResearchPlanStep {
	text: string;
	status: PlanItemStatus;
}

export interface ResearchPlanPhase {
	name: string;
	parallelSteps: boolean;
	steps: ResearchPlanStep[];
	status: PlanItemStatus;
}

export interface ResearchPlan {
	createdAt: string;
	updatedAt: string;
	phases: ResearchPlanPhase[];
}

export interface PlanState {
	current?: ResearchPlan;
}

const planStepStatusSchema = Type.Union(
	[Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")],
	{
		description: 'Use "in_progress" for the step being actively worked, "completed" once done, otherwise "pending".',
	},
);
const planPhaseStatusSchema = Type.Union(
	[Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")],
	{
		description:
			'Use "in_progress" while this phase is actively advancing, "completed" when all work in it is done, otherwise "pending".',
	},
);

const planStepSchema = Type.Object({
	text: Type.String({ description: "Step description" }),
	status: Type.Optional(planStepStatusSchema),
});

const planPhaseSchema = Type.Object({
	name: Type.String({ description: "Short phase name" }),
	status: Type.Optional(planPhaseStatusSchema),
	parallel_steps: Type.Boolean({ description: "Whether the steps in this phase are independent" }),
	steps: Type.Array(planStepSchema, {
		description:
			'Ordered steps for this phase. Keep exactly the active work marked "in_progress" and flip finished work to "completed".',
	}),
});

const planToolSchema = Type.Object({
	clear: Type.Optional(
		Type.Boolean({
			description: "Clear the current plan when all work is complete or no execution plan should remain visible.",
		}),
	),
	phases: Type.Optional(
		Type.Array(planPhaseSchema, {
			description:
				'Ordered plan phases. Call the tool again as work progresses, keep active work marked "in_progress", and clear the plan when done.',
		}),
	),
});

type PlanToolParams = Static<typeof planToolSchema>;
type PlanPhaseInput = NonNullable<PlanToolParams["phases"]>[number];
type PlanStepInput = PlanPhaseInput["steps"][number];

export function isCompletedPlanText(text: string): boolean {
	return /^\s*(?:[-*]\s*)?(?:\[(?:x|X)\]|\(\s*(?:x|X)\s*\)|done\b|completed\b|complete\b|finished\b)/.test(text);
}

export function stripPlanCompletionMarker(text: string): string {
	return text
		.replace(/^\s*(?:[-*]\s*)?\[(?: |x|X)\]\s*/, "")
		.replace(/^\s*(?:[-*]\s*)?\(\s*(?: |x|X)\s*\)\s*/, "")
		.replace(/^\s*(?:done|completed|complete|finished)\s*[:.-]?\s*/i, "")
		.trim();
}

function normalizePlanKey(text: string): string {
	return stripPlanCompletionMarker(text).replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizePlanStatus(status: string | undefined): PlanItemStatus | undefined {
	switch (status) {
		case "pending":
		case "in_progress":
		case "completed":
			return status;
		default:
			return undefined;
	}
}

function buildPlanStep(step: PlanStepInput): ResearchPlanStep {
	const inferredStatus =
		normalizePlanStatus(step.status) ?? (isCompletedPlanText(step.text) ? "completed" : "pending");
	return {
		text: stripPlanCompletionMarker(step.text) || "Untitled step",
		status: inferredStatus,
	};
}

function completePlanStep(step: ResearchPlanStep): ResearchPlanStep {
	return {
		text: step.text,
		status: "completed",
	};
}

function completePlanPhase(phase: ResearchPlanPhase): ResearchPlanPhase {
	return {
		name: phase.name,
		parallelSteps: phase.parallelSteps,
		steps: phase.steps.map((step) => completePlanStep(step)),
		status: "completed",
	};
}

function derivePhaseStatus(explicitStatus: PlanItemStatus | undefined, steps: ResearchPlanStep[]): PlanItemStatus {
	if (steps.length > 0 && steps.every((step) => step.status === "completed")) {
		return "completed";
	}
	if (explicitStatus === "completed") {
		return "completed";
	}
	if (explicitStatus === "in_progress" || steps.some((step) => step.status === "in_progress")) {
		return "in_progress";
	}
	return explicitStatus ?? "pending";
}

function mergePlanSteps(previousSteps: ResearchPlanStep[], nextSteps: PlanPhaseInput["steps"]): ResearchPlanStep[] {
	const incoming = nextSteps.map((step) => ({
		key: normalizePlanKey(step.text),
		step: buildPlanStep(step),
		matched: false,
	}));
	const merged: ResearchPlanStep[] = [];

	for (const previousStep of previousSteps) {
		const previousKey = normalizePlanKey(previousStep.text);
		const match = incoming.find((candidate) => !candidate.matched && candidate.key === previousKey);
		if (match) {
			match.matched = true;
			merged.push({
				text: match.step.text,
				status: match.step.status ?? previousStep.status,
			});
			continue;
		}

		merged.push(completePlanStep(previousStep));
	}

	for (const candidate of incoming) {
		if (!candidate.matched) {
			merged.push(candidate.step);
		}
	}

	return merged;
}

function buildPlanPhase(phase: PlanPhaseInput): ResearchPlanPhase {
	let steps = phase.steps.map((step) => buildPlanStep(step));
	const explicitStatus = normalizePlanStatus(phase.status);
	if (explicitStatus === "completed") {
		steps = steps.map((step) => completePlanStep(step));
	}
	return {
		name: phase.name,
		parallelSteps: phase.parallel_steps,
		steps,
		status: derivePhaseStatus(explicitStatus, steps),
	};
}

export function mergeResearchPlan(previous: ResearchPlan | undefined, params: PlanToolParams): ResearchPlan {
	const now = new Date().toISOString();
	const incoming = (params.phases ?? []).map((phase) => ({
		key: phase.name.replace(/\s+/g, " ").trim().toLowerCase(),
		phase,
		matched: false,
	}));
	const mergedPhases: ResearchPlanPhase[] = [];

	for (const previousPhase of previous?.phases ?? []) {
		const previousKey = previousPhase.name.replace(/\s+/g, " ").trim().toLowerCase();
		const match = incoming.find((candidate) => !candidate.matched && candidate.key === previousKey);
		if (!match) {
			mergedPhases.push(completePlanPhase(previousPhase));
			continue;
		}

		match.matched = true;
		let steps = mergePlanSteps(previousPhase.steps, match.phase.steps);
		const explicitStatus = normalizePlanStatus(match.phase.status);
		if (explicitStatus === "completed") {
			steps = steps.map((step) => completePlanStep(step));
		}
		mergedPhases.push({
			name: match.phase.name,
			parallelSteps: match.phase.parallel_steps,
			steps,
			status: derivePhaseStatus(explicitStatus, steps),
		});
	}

	for (const candidate of incoming) {
		if (!candidate.matched) {
			mergedPhases.push(buildPlanPhase(candidate.phase));
		}
	}

	return {
		createdAt: previous?.createdAt ?? now,
		updatedAt: now,
		phases: mergedPhases,
	};
}

export function isResearchPlanComplete(plan: ResearchPlan): boolean {
	return plan.phases.length > 0 && plan.phases.every((phase) => phase.status === "completed");
}

export function formatPlan(plan: ResearchPlan): string {
	const lines: string[] = [];
	for (const [index, phase] of plan.phases.entries()) {
		const parallelSuffix = phase.parallelSteps ? " (parallel steps)" : "";
		const completeSuffix = phase.status === "completed" ? " [complete]" : "";
		lines.push(`Phase ${index + 1}: ${phase.name}${parallelSuffix}${completeSuffix}`);
		for (const step of phase.steps) {
			lines.push(
				step.status === "completed"
					? `  [x] ${step.text}`
					: step.status === "in_progress"
						? `  [>] ${step.text}`
						: `  - ${step.text}`,
			);
		}
	}

	return lines.join("\n");
}

export function createPlanTool(
	state: PlanState,
	notebook: NotebookStore,
): AgentTool<typeof planToolSchema, { createdAt: string; phases: number; cleared?: boolean }> {
	return {
		name: "plan",
		label: "Plan",
		description:
			'Create, update, or clear the execution plan. Mark the currently active phase and step as "in_progress", flip finished work to "completed", and clear the plan when execution is complete.',
		parameters: planToolSchema,
		async execute(_toolCallId: string, params: PlanToolParams) {
			if (params.clear) {
				state.current = undefined;
				await notebook.delete("_plan");

				return {
					content: [{ type: "text", text: "Plan cleared." }],
					details: {
						createdAt: new Date().toISOString(),
						phases: 0,
						cleared: true,
					},
				};
			}

			if (!params.phases || params.phases.length === 0) {
				throw new Error('"phases" is required unless "clear" is true.');
			}

			const plan = mergeResearchPlan(state.current, params);

			if (isResearchPlanComplete(plan)) {
				state.current = undefined;
				await notebook.delete("_plan");

				return {
					content: [{ type: "text", text: `Plan completed.\n\n${formatPlan(plan)}` }],
					details: {
						createdAt: plan.createdAt,
						phases: plan.phases.length,
						cleared: true,
					},
				};
			}

			state.current = plan;
			await notebook.set("_plan", formatPlan(plan));

			return {
				content: [{ type: "text", text: `Plan saved.\n\n${formatPlan(plan)}` }],
				details: {
					createdAt: plan.createdAt,
					phases: plan.phases.length,
				},
			};
		},
	};
}
