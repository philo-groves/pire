import { resolve } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@mariozechner/pi-ai";
import {
	executeValidation,
	type ValidationSessionState,
	type ValidationSpec,
	type ValidationToolDetails,
} from "../validation.js";

const validateArtifactToolSchema = Type.Object({
	artifact_path: Type.String({
		description: "Path to the candidate artifact or input file to validate",
	}),
	goal: Type.Optional(
		Type.String({
			description: "Short note describing what the validation should prove",
		}),
	),
});

type ValidateArtifactToolParams = Static<typeof validateArtifactToolSchema>;

export function createValidateArtifactTool(
	cwd: string,
	spec: ValidationSpec,
	state: ValidationSessionState,
): AgentTool<typeof validateArtifactToolSchema, ValidationToolDetails> {
	return {
		name: "validate_artifact",
		label: "Validate Artifact",
		description: spec.description,
		parameters: validateArtifactToolSchema,
		async execute(_toolCallId: string, params: ValidateArtifactToolParams) {
			const artifactPath = resolve(cwd, params.artifact_path);
			const validation = await executeValidation(spec, {
				artifactPath,
				goal: params.goal,
				workspaceCwd: cwd,
			});
			const attempt = state.attempts + 1;
			const details: ValidationToolDetails = {
				...validation,
				artifactPath,
				attempt,
				validator: spec.name,
			};
			state.attempts = attempt;
			state.lastResult = details;
			state.history.push(details);

			const lines = [`Validation status: ${validation.status}`, validation.summary];
			if (validation.nextStep) {
				lines.push(`Next step: ${validation.nextStep}`);
			}
			if (validation.stdout) {
				lines.push(`stdout:\n${validation.stdout}`);
			}
			if (validation.stderr) {
				lines.push(`stderr:\n${validation.stderr}`);
			}

			return {
				content: [{ type: "text", text: lines.join("\n\n") }],
				details,
			};
		},
	};
}
