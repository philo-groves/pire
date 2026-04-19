import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@mariozechner/pi-ai";
import type { FindingDossierStore } from "../finding-dossiers/store.js";
import type { ResearchJournalStore, ResearchOverlayScope } from "../research-journal/store.js";
import type { FindingCandidateInput, WorkspaceGraphStore } from "../workspace-graph/store.js";

const findingStatusSchema = Type.Union([
	Type.Literal("candidate"),
	Type.Literal("confirmed"),
	Type.Literal("rejected"),
]);

const findingGateToolSchema = Type.Object({
	action: Type.Union([Type.Literal("review"), Type.Literal("promote")], {
		description:
			"Review a candidate finding for duplicate overlap and evidence sufficiency, or promote it into the persistent workspace graph.",
	}),
	id: Type.Optional(Type.String({ description: "Stable finding id. Omit to auto-generate on promote." })),
	label: Type.String({ description: "Short finding title." }),
	summary: Type.String({ description: "Concise description of the bug, impact, and target path." }),
	surfaces: Type.Optional(
		Type.Array(Type.String(), {
			description: "Related surface ids from the session surface map or workspace graph.",
		}),
	),
	evidence: Type.Optional(
		Type.Array(Type.String(), {
			description: "Short evidence items such as trace anchors, proof notes, or parser path facts.",
		}),
	),
	tags: Type.Optional(
		Type.Array(Type.String(), { description: "Optional tags such as auth, parser, xss, or privilege." }),
	),
	proof: Type.Optional(
		Type.String({
			description: "Optional proof or validation summary. Include target-backed results when available.",
		}),
	),
	status: Type.Optional(findingStatusSchema),
	force: Type.Optional(Type.Boolean({ description: "Force promotion even when duplicates are likely." })),
});

type FindingGateToolParams = Static<typeof findingGateToolSchema>;

function normalizeInput(params: FindingGateToolParams): FindingCandidateInput {
	return {
		id: params.id?.trim(),
		label: params.label.trim(),
		summary: params.summary.trim(),
		surfaces: params.surfaces?.map((value) => value.trim()),
		evidence: params.evidence?.map((value) => value.trim()),
		tags: params.tags?.map((value) => value.trim()),
		proof: params.proof?.trim(),
		status: params.status,
		force: params.force,
	};
}

export function createFindingGateTool(
	store: WorkspaceGraphStore,
	journal?: ResearchJournalStore,
	getOverlayScope?: () => ResearchOverlayScope,
	dossierStore?: FindingDossierStore,
): AgentTool<
	typeof findingGateToolSchema,
	{ action: string; recommendation: string; findingId?: string; blocked?: boolean }
> {
	return {
		name: "finding_gate",
		label: "Finding Gate",
		description:
			"Review candidate findings for duplicate overlap and evidence sufficiency before promoting them into durable workspace knowledge.",
		parameters: findingGateToolSchema,
		async execute(_toolCallId: string, params: FindingGateToolParams) {
			const input = normalizeInput(params);
			const overlayScope = journal && getOverlayScope ? getOverlayScope() : undefined;
			if (params.action === "review") {
				const review = store.reviewFindingCandidate(input);
				return {
					content: [{ type: "text", text: store.formatFindingReview(input, review) }],
					details: {
						action: params.action,
						recommendation: review.recommendation,
					},
				};
			}

			const promotion = await store.promoteFinding(input);
			const reviewText = store.formatFindingReview(input, promotion.review);
			const promotionText = promotion.blocked
				? `${reviewText}\nPromotion blocked: likely duplicate. Re-run with force=true only if the overlap is understood and intentional.`
				: `${reviewText}\nPromoted durable finding: ${promotion.id}`;
			if (journal && overlayScope) {
				await journal.append({
					sessionId: overlayScope.sessionId,
					sessionLineageIds: overlayScope.sessionLineageIds,
					scope: "workspace",
					domain: "workspace_graph",
					action: params.action === "promote" ? "promote_finding" : "review_finding",
					entityId: promotion.id ?? input.id,
					summary: input.label,
					payload: {
						label: input.label,
						summary: input.summary,
						recommendation: promotion.review.recommendation,
						blocked: promotion.blocked,
					},
				});
			}
			if (!promotion.blocked && promotion.id && dossierStore && overlayScope) {
				await dossierStore.upsert(
					{
						id: `dossier:${promotion.id}`,
						findingId: promotion.id,
						title: input.label,
						claim: input.summary,
						trigger: input.proof?.trim() || undefined,
						surfaces: input.surfaces,
						evidence: input.evidence,
						tags: input.tags,
						status:
							input.status === "rejected"
								? "rejected"
								: input.status === "confirmed"
									? "validated"
									: "candidate",
					},
					overlayScope,
					"workspace",
				);
			}
			return {
				content: [{ type: "text", text: promotionText }],
				details: {
					action: params.action,
					recommendation: promotion.review.recommendation,
					findingId: promotion.id,
					blocked: promotion.blocked,
				},
			};
		},
	};
}
