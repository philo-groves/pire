import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@mariozechner/pi-ai";
import type {
	FindingDossierControl,
	FindingDossierStatus,
	FindingDossierStore,
	FindingDossierUpsertInput,
} from "../finding-dossiers/store.js";
import type { ResearchJournalScope, ResearchOverlayScope } from "../research-journal/store.js";

const findingDossierStatusSchema = Type.Union([
	Type.Literal("candidate"),
	Type.Literal("validated"),
	Type.Literal("ready_for_report"),
	Type.Literal("reported"),
	Type.Literal("rejected"),
	Type.Literal("blocked"),
]);

const findingDossierStorageScopeSchema = Type.Union([Type.Literal("session"), Type.Literal("workspace")]);

const findingDossierControlSchema = Type.Object({
	label: Type.String(),
	result: Type.String(),
	details: Type.Optional(Type.String()),
});

const findingDossierToolSchema = Type.Object({
	action: Type.Union([Type.Literal("read"), Type.Literal("upsert"), Type.Literal("delete")]),
	id: Type.Optional(Type.String({ description: "Stable dossier id." })),
	finding_id: Type.Optional(Type.String({ description: "Linked durable finding id, if one exists." })),
	title: Type.Optional(Type.String()),
	claim: Type.Optional(Type.String({ description: "Core vulnerability claim." })),
	target: Type.Optional(Type.String()),
	target_scope: Type.Optional(Type.String({ description: "Impact scope or affected target boundary." })),
	impact: Type.Optional(Type.String()),
	trigger: Type.Optional(Type.String({ description: "Concrete trigger hypothesis or validated trigger." })),
	surfaces: Type.Optional(Type.Array(Type.String())),
	logic_rule_ids: Type.Optional(Type.Array(Type.String())),
	controls: Type.Optional(Type.Array(findingDossierControlSchema)),
	evidence: Type.Optional(Type.Array(Type.String())),
	repro_commands: Type.Optional(Type.Array(Type.String())),
	artifact_paths: Type.Optional(Type.Array(Type.String())),
	blockers: Type.Optional(Type.Array(Type.String())),
	report_notes: Type.Optional(Type.String()),
	tags: Type.Optional(Type.Array(Type.String())),
	status: Type.Optional(findingDossierStatusSchema),
	storage_scope: Type.Optional(findingDossierStorageScopeSchema),
	surface_id: Type.Optional(Type.String({ description: "Optional read filter for a related surface." })),
	limit: Type.Optional(Type.Number({ description: "Maximum records to show on read." })),
});

type FindingDossierToolParams = Static<typeof findingDossierToolSchema>;

function normalizeStorageScope(value: string | undefined): ResearchJournalScope {
	return value === "workspace" ? "workspace" : "session";
}

function normalizeControls(values: FindingDossierToolParams["controls"]): FindingDossierControl[] | undefined {
	return values?.map((value) => ({
		label: value.label.trim(),
		result: value.result.trim(),
		details: value.details?.trim(),
	}));
}

function normalizeInput(params: FindingDossierToolParams): FindingDossierUpsertInput {
	if (!params.id?.trim()) {
		throw new Error('"id" is required.');
	}
	return {
		id: params.id.trim(),
		findingId: params.finding_id?.trim(),
		title: params.title?.trim(),
		claim: params.claim?.trim(),
		target: params.target?.trim(),
		targetScope: params.target_scope?.trim(),
		impact: params.impact?.trim(),
		trigger: params.trigger?.trim(),
		surfaces: params.surfaces?.map((value) => value.trim()),
		logicRuleIds: params.logic_rule_ids?.map((value) => value.trim()),
		controls: normalizeControls(params.controls),
		evidence: params.evidence?.map((value) => value.trim()),
		reproCommands: params.repro_commands?.map((value) => value.trim()),
		artifactPaths: params.artifact_paths?.map((value) => value.trim()),
		blockers: params.blockers?.map((value) => value.trim()),
		reportNotes: params.report_notes?.trim(),
		tags: params.tags?.map((value) => value.trim()),
		status: params.status as FindingDossierStatus | undefined,
	};
}

export function createFindingDossierTool(
	store: FindingDossierStore,
	getOverlayScope: () => ResearchOverlayScope,
): AgentTool<typeof findingDossierToolSchema, { action: string; dossiers: number; id?: string }> {
	return {
		name: "finding_dossier",
		label: "Finding Dossier",
		description:
			"Maintain a structured dossier for serious candidates or validated findings, including claim, controls, trigger, repro commands, artifacts, blockers, and report readiness.",
		parameters: findingDossierToolSchema,
		async execute(_toolCallId: string, params: FindingDossierToolParams) {
			const overlayScope = getOverlayScope();
			if (params.action === "read") {
				const data = store.read(overlayScope);
				let records = Object.values(data.dossiers).sort((left, right) =>
					right.updatedAt.localeCompare(left.updatedAt),
				);
				if (params.finding_id?.trim()) {
					records = records.filter((record) => record.findingId === params.finding_id!.trim());
				}
				if (params.surface_id?.trim()) {
					records = records.filter((record) => record.surfaces.includes(params.surface_id!.trim()));
				}
				records = records.slice(0, Math.max(1, Math.min(8, params.limit ?? 4)));
				return {
					content: [{ type: "text", text: store.formatForPrompt(records) }],
					details: {
						action: params.action,
						dossiers: Object.keys(data.dossiers).length,
					},
				};
			}

			if (params.action === "delete") {
				if (!params.id?.trim()) {
					throw new Error('"id" is required.');
				}
				const updated = await store.delete(
					params.id.trim(),
					overlayScope,
					normalizeStorageScope(params.storage_scope),
				);
				return {
					content: [{ type: "text", text: `Deleted finding dossier ${params.id.trim()}` }],
					details: {
						action: params.action,
						dossiers: Object.keys(updated.dossiers).length,
						id: params.id.trim(),
					},
				};
			}

			const updated = await store.upsert(
				normalizeInput(params),
				overlayScope,
				normalizeStorageScope(params.storage_scope),
			);
			return {
				content: [{ type: "text", text: `Updated finding dossier ${params.id!.trim()}` }],
				details: {
					action: params.action,
					dossiers: Object.keys(updated.dossiers).length,
					id: params.id!.trim(),
				},
			};
		},
	};
}
