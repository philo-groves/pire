import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { DebugSpec } from "../debug-spec.js";
import type { LogicMapStore } from "../logic-map/store.js";
import type { NotebookStore } from "../notebook/store.js";
import type { SurfaceMapStore } from "../surface-map/store.js";
import type { ValidationSessionState, ValidationSpec } from "../validation.js";
import type { WorkspaceGraphStore } from "../workspace-graph/store.js";
import { createBashTool } from "./bash.js";
import { createDebugTool } from "./debug.js";
import { createFindingGateTool } from "./finding-gate.js";
import { createHttpTool } from "./http.js";
import { createLogicMapTool } from "./logic-map.js";
import { createNotebookTools } from "./notebook.js";
import { createPlanTool, type PlanState } from "./plan.js";
import { createPythonTool } from "./python.js";
import { createSurfaceMapTool } from "./surface-map.js";
import { createValidateArtifactTool } from "./validate-artifact.js";
import { createWorkspaceGraphTool } from "./workspace-graph.js";

export interface CreateSecurityToolsOptions {
	cwd: string;
	artifactsDir: string;
	logicMap: LogicMapStore;
	notebook: NotebookStore;
	surfaceMap: SurfaceMapStore;
	workspaceGraph: WorkspaceGraphStore;
	planState: PlanState;
	debugSpec?: DebugSpec;
	validationSpec?: ValidationSpec;
	validationState?: ValidationSessionState;
}

export function createSecurityTools(options: CreateSecurityToolsOptions): Array<AgentTool<any>> {
	const tools: Array<AgentTool<any>> = [
		createPlanTool(options.planState, options.notebook),
		createSurfaceMapTool(options.surfaceMap, options.workspaceGraph),
		createLogicMapTool(options.logicMap, options.workspaceGraph),
		createWorkspaceGraphTool(options.workspaceGraph),
		createFindingGateTool(options.workspaceGraph),
		createBashTool(options.cwd),
		createDebugTool(options.cwd, options.artifactsDir, options.debugSpec),
		createHttpTool(options.workspaceGraph),
		createPythonTool(options.cwd),
		...createNotebookTools(options.notebook),
	];

	if (options.validationSpec && options.validationState) {
		tools.push(createValidateArtifactTool(options.cwd, options.validationSpec, options.validationState));
	}

	return tools;
}

export * from "./bash.js";
export * from "./debug.js";
export * from "./finding-gate.js";
export * from "./http.js";
export * from "./logic-map.js";
export * from "./notebook.js";
export * from "./plan.js";
export * from "./python.js";
export * from "./surface-map.js";
export * from "./validate-artifact.js";
export * from "./workspace-graph.js";
