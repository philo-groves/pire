import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@mariozechner/pi-ai";
import type {
	ResearchArtifactStatus,
	ResearchArtifactStore,
	ResearchArtifactUpsertInput,
} from "../research-artifacts/store.js";
import type { ResearchJournalScope, ResearchOverlayScope } from "../research-journal/store.js";

const researchArtifactKindSchema = Type.Union([
	Type.Literal("hypothesis"),
	Type.Literal("proof"),
	Type.Literal("negative_result"),
	Type.Literal("repro"),
	Type.Literal("report_note"),
	Type.Literal("finding_note"),
]);

const researchArtifactStatusSchema = Type.Union([
	Type.Literal("active"),
	Type.Literal("validated"),
	Type.Literal("rejected"),
	Type.Literal("superseded"),
]);

const researchArtifactStorageScopeSchema = Type.Union([Type.Literal("session"), Type.Literal("workspace")]);

const researchArtifactToolSchema = Type.Object({
	action: Type.Union([Type.Literal("read"), Type.Literal("upsert"), Type.Literal("delete")]),
	id: Type.Optional(Type.String({ description: "Stable artifact id." })),
	kind: Type.Optional(researchArtifactKindSchema),
	title: Type.Optional(Type.String({ description: "Short title." })),
	summary: Type.Optional(Type.String({ description: "Concise summary of the artifact." })),
	content: Type.Optional(Type.String({ description: "Longer artifact body, proof note, or branch-specific detail." })),
	surfaces: Type.Optional(Type.Array(Type.String())),
	finding_ids: Type.Optional(Type.Array(Type.String())),
	logic_rule_ids: Type.Optional(Type.Array(Type.String())),
	commands: Type.Optional(Type.Array(Type.String())),
	artifact_paths: Type.Optional(Type.Array(Type.String())),
	tags: Type.Optional(Type.Array(Type.String())),
	status: Type.Optional(researchArtifactStatusSchema),
	storage_scope: Type.Optional(researchArtifactStorageScopeSchema),
	surface_id: Type.Optional(Type.String({ description: "Optional read filter for a related surface." })),
	finding_id: Type.Optional(Type.String({ description: "Optional read filter for a linked finding." })),
	limit: Type.Optional(Type.Number({ description: "Maximum records to show on read." })),
});

type ResearchArtifactToolParams = Static<typeof researchArtifactToolSchema>;

function normalizeStorageScope(value: string | undefined): ResearchJournalScope {
	return value === "workspace" ? "workspace" : "session";
}

function normalizeInput(params: ResearchArtifactToolParams): ResearchArtifactUpsertInput {
	if (!params.id?.trim()) {
		throw new Error('"id" is required.');
	}
	return {
		id: params.id.trim(),
		kind: params.kind,
		title: params.title?.trim(),
		summary: params.summary?.trim(),
		content: params.content?.trim(),
		surfaces: params.surfaces?.map((value) => value.trim()),
		findingIds: params.finding_ids?.map((value) => value.trim()),
		logicRuleIds: params.logic_rule_ids?.map((value) => value.trim()),
		commands: params.commands?.map((value) => value.trim()),
		artifactPaths: params.artifact_paths?.map((value) => value.trim()),
		tags: params.tags?.map((value) => value.trim()),
		status: params.status as ResearchArtifactStatus | undefined,
	};
}

export function createResearchArtifactTool(
	store: ResearchArtifactStore,
	getOverlayScope: () => ResearchOverlayScope,
): AgentTool<typeof researchArtifactToolSchema, { action: string; artifacts: number; id?: string }> {
	return {
		name: "research_artifact",
		label: "Research Artifact",
		description:
			"Store typed hypotheses, proofs, negative results, repro recipes, and report notes. Use session scope for branch-local work and workspace scope for durable shared memory.",
		parameters: researchArtifactToolSchema,
		async execute(_toolCallId: string, params: ResearchArtifactToolParams) {
			const overlayScope = getOverlayScope();
			if (params.action === "read") {
				const data = store.read(overlayScope);
				let records = Object.values(data.artifacts).sort((left, right) =>
					right.updatedAt.localeCompare(left.updatedAt),
				);
				if (params.surface_id?.trim()) {
					records = records.filter((record) => record.surfaces.includes(params.surface_id!.trim()));
				}
				if (params.finding_id?.trim()) {
					records = records.filter((record) => record.findingIds.includes(params.finding_id!.trim()));
				}
				records = records.slice(0, Math.max(1, Math.min(12, params.limit ?? 6)));
				return {
					content: [{ type: "text", text: store.formatForPrompt(records) }],
					details: {
						action: params.action,
						artifacts: Object.keys(data.artifacts).length,
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
					content: [{ type: "text", text: `Deleted research artifact ${params.id.trim()}` }],
					details: {
						action: params.action,
						artifacts: Object.keys(updated.artifacts).length,
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
				content: [{ type: "text", text: `Updated research artifact ${params.id!.trim()}` }],
				details: {
					action: params.action,
					artifacts: Object.keys(updated.artifacts).length,
					id: params.id!.trim(),
				},
			};
		},
	};
}
