import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FindingDossierStore } from "../src/finding-dossiers/store.js";
import { ResearchArtifactStore } from "../src/research-artifacts/store.js";
import { ResearchJournalStore } from "../src/research-journal/store.js";
import { SessionManager } from "../src/session-manager.js";

describe("branch-aware research memory", () => {
	it("merges session overlays across parent and child branches without polluting workspace state", async () => {
		const workspaceRoot = mkdtempSync(join(tmpdir(), "pire-research-workspace-"));
		const sessionDir = mkdtempSync(join(tmpdir(), "pire-research-sessions-"));

		try {
			const parentSession = SessionManager.create(workspaceRoot, sessionDir);
			parentSession.flush();
			const parentSessionFile = parentSession.getSessionFile();
			assert.ok(parentSessionFile);

			const childSession = SessionManager.create(workspaceRoot, sessionDir);
			childSession.newSession({ parentSession: parentSessionFile });
			childSession.flush();

			const journal = new ResearchJournalStore(workspaceRoot);
			const artifactStore = new ResearchArtifactStore(workspaceRoot, journal);
			const dossierStore = new FindingDossierStore(workspaceRoot, journal);

			const parentScope = {
				sessionId: parentSession.getSessionId(),
				sessionLineageIds: parentSession.getSessionLineageIds(),
			};
			const childScope = {
				sessionId: childSession.getSessionId(),
				sessionLineageIds: childSession.getSessionLineageIds(),
			};

			assert.deepStrictEqual(childScope.sessionLineageIds, [parentScope.sessionId, childScope.sessionId]);

			await artifactStore.upsert(
				{
					id: "proof:host-gap",
					kind: "proof",
					title: "Host gap proof",
					summary: "Parent branch proof summary.",
					surfaces: ["module:proxyprotocol-stripuntrusted"],
				},
				parentScope,
				"session",
			);
			await artifactStore.upsert(
				{
					id: "proof:host-gap",
					summary: "Child branch refined proof summary.",
					commands: ["./gradlew sampleProofTest"],
				},
				childScope,
				"session",
			);
			await artifactStore.upsert(
				{
					id: "proof:shared-workspace",
					kind: "proof",
					title: "Workspace proof",
					summary: "Shared durable proof.",
				},
				childScope,
				"workspace",
			);

			const workspaceArtifacts = artifactStore.read();
			const childArtifacts = artifactStore.read(childScope);
			assert.ok(!workspaceArtifacts.artifacts["proof:host-gap"]);
			assert.strictEqual(childArtifacts.artifacts["proof:host-gap"]?.summary, "Child branch refined proof summary.");
			assert.deepStrictEqual(childArtifacts.artifacts["proof:host-gap"]?.commands, ["./gradlew sampleProofTest"]);
			assert.ok(workspaceArtifacts.artifacts["proof:shared-workspace"]);

			await dossierStore.upsert(
				{
					id: "dossier:host-gap",
					title: "Host gap dossier",
					claim: "Parent candidate claim.",
					status: "candidate",
				},
				parentScope,
				"session",
			);
			await dossierStore.upsert(
				{
					id: "dossier:host-gap",
					claim: "Child validated claim.",
					status: "validated",
					reproCommands: ["./gradlew sampleProofTest"],
				},
				childScope,
				"session",
			);

			const workspaceDossiers = dossierStore.read();
			const childDossiers = dossierStore.read(childScope);
			assert.ok(!workspaceDossiers.dossiers["dossier:host-gap"]);
			assert.strictEqual(childDossiers.dossiers["dossier:host-gap"]?.claim, "Child validated claim.");
			assert.strictEqual(childDossiers.dossiers["dossier:host-gap"]?.status, "validated");
		} finally {
			rmSync(workspaceRoot, { recursive: true, force: true });
			rmSync(sessionDir, { recursive: true, force: true });
		}
	});
});
