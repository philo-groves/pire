import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@mariozechner/pi-ai";
import type { NotebookStore } from "../notebook/store.js";

export interface ResearchPlanPhase {
	name: string;
	parallelSteps: boolean;
	steps: string[];
}

export interface ResearchPlan {
	createdAt: string;
	phases: ResearchPlanPhase[];
}

export interface PlanState {
	current?: ResearchPlan;
}

const planPhaseSchema = Type.Object({
	name: Type.String({ description: "Short phase name" }),
	parallel_steps: Type.Boolean({ description: "Whether the steps in this phase are independent" }),
	steps: Type.Array(Type.String({ description: "Step description" }), {
		description: "Ordered steps for this phase",
	}),
});

const planToolSchema = Type.Object({
	phases: Type.Array(planPhaseSchema, { minItems: 1, description: "Ordered plan phases" }),
});

type PlanToolParams = Static<typeof planToolSchema>;

function formatPlan(plan: ResearchPlan): string {
	const lines: string[] = [];
	for (const [index, phase] of plan.phases.entries()) {
		const parallelSuffix = phase.parallelSteps ? " (parallel steps)" : "";
		lines.push(`Phase ${index + 1}: ${phase.name}${parallelSuffix}`);
		for (const step of phase.steps) {
			lines.push(`  - ${step}`);
		}
	}

	return lines.join("\n");
}

export function createPlanTool(
	state: PlanState,
	notebook: NotebookStore,
): AgentTool<typeof planToolSchema, { createdAt: string; phases: number }> {
	return {
		name: "plan",
		label: "Plan",
		description:
			"Create or update an execution plan. Use this to break the task into phases and mark which phases contain independent steps that can be executed in parallel.",
		parameters: planToolSchema,
		async execute(_toolCallId: string, params: PlanToolParams) {
			const plan: ResearchPlan = {
				createdAt: new Date().toISOString(),
				phases: params.phases.map((phase) => ({
					name: phase.name,
					parallelSteps: phase.parallel_steps,
					steps: phase.steps,
				})),
			};
			state.current = plan;

			const formatted = formatPlan(plan);
			await notebook.set("_plan", formatted);

			return {
				content: [{ type: "text", text: `Plan saved.\n\n${formatted}` }],
				details: {
					createdAt: plan.createdAt,
					phases: plan.phases.length,
				},
			};
		},
	};
}
