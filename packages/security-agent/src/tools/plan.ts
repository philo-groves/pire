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

const PLAN_TERM_STOP_WORDS = new Set([
	"the",
	"and",
	"for",
	"with",
	"from",
	"into",
	"onto",
	"over",
	"under",
	"through",
	"across",
	"before",
	"after",
	"while",
	"when",
	"where",
	"that",
	"this",
	"these",
	"those",
	"then",
	"than",
	"path",
	"paths",
	"flow",
	"flows",
	"file",
	"files",
	"real",
	"smallest",
	"current",
	"fresh",
	"next",
	"map",
	"inspect",
	"identify",
	"validate",
	"review",
	"drive",
	"use",
	"check",
	"confirm",
	"build",
]);

const PLAN_TERM_ALIASES: Record<string, string[]> = {
	gap: ["mismatch"],
	mismatch: ["gap"],
	handler: ["handling"],
	handling: ["handler"],
	entrypoint: ["ingress"],
	ingress: ["entrypoint"],
};

const PLAN_WRAP_UP_HINTS = [
	"best next step",
	"remaining blocker",
	"what is still only a candidate",
	"still only a candidate",
	"not yet proven",
	"haven't yet ruled out",
	"have not yet proven",
	"have not yet ruled out",
	"if you want, i'll continue",
	"if you want, i’ll continue",
	"if you want, i'll",
	"if you want, i’ll",
];

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

function mergeStepStatus(previousStep: ResearchPlanStep, nextStep: ResearchPlanStep): PlanItemStatus {
	if (previousStep.status === "completed") {
		return "completed";
	}
	return nextStep.status;
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
				status: mergeStepStatus(previousStep, match.step),
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

function splitPlanTerms(text: string): string[] {
	return (
		text
			.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
			.toLowerCase()
			.match(/[a-z0-9]{3,}/g) ?? []
	);
}

function normalizePlanTerm(term: string): string {
	let normalized = term.trim().toLowerCase();
	if (normalized.length > 5 && normalized.endsWith("ing")) {
		normalized = normalized.slice(0, -3);
	} else if (normalized.length > 4 && normalized.endsWith("ed")) {
		normalized = normalized.slice(0, -2);
	} else if (normalized.length > 4 && normalized.endsWith("es")) {
		normalized = normalized.slice(0, -2);
	} else if (normalized.length > 3 && normalized.endsWith("s")) {
		normalized = normalized.slice(0, -1);
	}
	return normalized;
}

function extractPlanTerms(text: string): string[] {
	const terms = splitPlanTerms(text)
		.map((term) => normalizePlanTerm(term))
		.filter((term) => term.length >= 3 && !PLAN_TERM_STOP_WORDS.has(term))
		.flatMap((term) => [term, ...(PLAN_TERM_ALIASES[term] ?? [])]);
	return [...new Set(terms)];
}

function shouldAutoCompleteStep(step: ResearchPlanStep, evidenceTerms: ReadonlySet<string>): boolean {
	if (step.status === "completed") {
		return false;
	}

	const stepTerms = extractPlanTerms(step.text);
	if (stepTerms.length === 0) {
		return false;
	}

	const matches = stepTerms.filter((term) => evidenceTerms.has(term)).length;
	const coverage = matches / stepTerms.length;

	if (matches >= 4) {
		return true;
	}
	if (matches >= 3 && coverage >= 0.33) {
		return true;
	}
	if (step.status === "in_progress" && matches >= 2 && coverage >= 0.25) {
		return true;
	}
	return false;
}

function countCompletedSteps(steps: ResearchPlanStep[]): number {
	return steps.filter((step) => step.status === "completed").length;
}

function hasPlanWrapUpSignal(evidenceText: string): boolean {
	const normalized = evidenceText.toLowerCase();
	return PLAN_WRAP_UP_HINTS.some((hint) => normalized.includes(hint));
}

export function reconcileResearchPlan(
	plan: ResearchPlan | undefined,
	evidenceText: string,
): { plan: ResearchPlan | undefined; changed: boolean; cleared: boolean } {
	if (!plan || evidenceText.trim().length === 0) {
		return { plan, changed: false, cleared: false };
	}

	const evidenceTerms = new Set(extractPlanTerms(evidenceText));
	if (evidenceTerms.size === 0) {
		return { plan, changed: false, cleared: false };
	}

	let changed = false;
	const phases = plan.phases.map((phase) => {
		let phaseChanged = false;
		let autoCompletedCount = 0;
		const unfinishedBefore = phase.steps.filter((step) => step.status !== "completed");
		const hasInProgressStep = unfinishedBefore.some((step) => step.status === "in_progress");
		const firstUnfinishedStep = unfinishedBefore[0];
		let nextSteps = phase.steps.map((step) => {
			const canAutoComplete = phase.parallelSteps
				? step.status !== "completed"
				: step.status === "in_progress" || (!hasInProgressStep && firstUnfinishedStep === step);
			if (!canAutoComplete || !shouldAutoCompleteStep(step, evidenceTerms)) {
				return step;
			}
			phaseChanged = true;
			autoCompletedCount++;
			return completePlanStep(step);
		});

		if (!phase.parallelSteps && autoCompletedCount > 0) {
			nextSteps = nextSteps.map((step) => {
				if (step.status === "completed" || !shouldAutoCompleteStep(step, evidenceTerms)) {
					return step;
				}
				phaseChanged = true;
				autoCompletedCount++;
				return completePlanStep(step);
			});
		}

		if (!phase.parallelSteps) {
			const unfinishedAfter = nextSteps.filter((step) => step.status !== "completed");
			if (unfinishedAfter.length === 1 && unfinishedBefore.length === 1 && hasPlanWrapUpSignal(evidenceText)) {
				nextSteps = nextSteps.map((step) => (step.status === "completed" ? step : completePlanStep(step)));
				phaseChanged = true;
			}
		}

		if (phase.parallelSteps) {
			const unfinishedAfter = nextSteps.filter((step) => step.status !== "completed");
			const autoCompletedThisTurn = countCompletedSteps(nextSteps) - countCompletedSteps(phase.steps);

			if (
				unfinishedAfter.length === 1 &&
				unfinishedBefore.length >= 3 &&
				autoCompletedThisTurn >= unfinishedBefore.length - 1
			) {
				nextSteps = nextSteps.map((step) => (step.status === "completed" ? step : completePlanStep(step)));
				phaseChanged = true;
			}
		}

		const nextStatus = derivePhaseStatus(phase.status, nextSteps);
		if (nextStatus !== phase.status) {
			phaseChanged = true;
		}
		if (phaseChanged) {
			changed = true;
		}

		return {
			name: phase.name,
			parallelSteps: phase.parallelSteps,
			steps: nextSteps,
			status: nextStatus,
		};
	});

	if (!changed) {
		return { plan, changed: false, cleared: false };
	}

	const nextPlan: ResearchPlan = {
		createdAt: plan.createdAt,
		updatedAt: new Date().toISOString(),
		phases,
	};

	if (isResearchPlanComplete(nextPlan)) {
		return { plan: undefined, changed: true, cleared: true };
	}

	return { plan: nextPlan, changed: true, cleared: false };
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
