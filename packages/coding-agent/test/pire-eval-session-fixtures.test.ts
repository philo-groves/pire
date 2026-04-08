import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parsePireEvalRunBundle } from "../src/core/pire/eval-bundles.js";
import { createPireEvalRunBundleFromBindingFile, scorePireEvalSessionFromFiles } from "../src/core/pire/eval-runner.js";

const FIXTURE_DIR = join(process.cwd(), "test", "fixtures", "pire-evals");
const SUITE_PATH = join(FIXTURE_DIR, "binary-re-starter-suite.json");
const CHAIN_SUITE_PATH = join(FIXTURE_DIR, "chain-suite.json");
const SCENARIO_SUITE_PATH = join(FIXTURE_DIR, "scenario-suite.json");
const DEEP_SCENARIO_SUITE_PATH = join(FIXTURE_DIR, "deep-scenario-suite.json");

async function loadExpectedRun(caseRoot: string, caseName: string) {
	return parsePireEvalRunBundle(await readFile(join(caseRoot, caseName, "expected-run.json"), "utf-8"));
}

function normalizeJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

describe("pire eval session fixtures", () => {
	test("extracts stable run bundles from confirmed and candidate binary RE fixture sessions", async () => {
		for (const caseName of ["heap-disasm-confirmed", "toctou-candidate"]) {
			const caseRoot = join(FIXTURE_DIR, "session-cases");
			const cwd = join(caseRoot, caseName);
			const result = await createPireEvalRunBundleFromBindingFile({
				cwd,
				suitePath: SUITE_PATH,
				bindingsPath: join(cwd, "bindings.json"),
			});

			expect(normalizeJson(result.run)).toEqual(normalizeJson(await loadExpectedRun(caseRoot, caseName)));
		}
	});

	test("extracts stable run bundles from pass, near-miss, and fail scenario fixture sessions", async () => {
		const caseRoot = join(FIXTURE_DIR, "scenario-cases");
		for (const caseName of ["renderer-rce-pass", "network-rce-near-miss", "helper-privesc-fail"]) {
			const cwd = join(caseRoot, caseName);
			const result = await createPireEvalRunBundleFromBindingFile({
				cwd,
				suitePath: SCENARIO_SUITE_PATH,
				bindingsPath: join(cwd, "bindings.json"),
			});

			expect(normalizeJson(result.run)).toEqual(normalizeJson(await loadExpectedRun(caseRoot, caseName)));
		}
	});

	test("extracts stable run bundles from pass, near-miss, and fail deep scenario fixture sessions", async () => {
		const caseRoot = join(FIXTURE_DIR, "deep-scenario-cases");
		for (const caseName of [
			"plugin-host-pass",
			"plugin-host-near-miss",
			"plugin-host-proof-gap",
			"plugin-host-fail",
			"broker-priv-pass",
			"broker-priv-near-miss",
			"broker-priv-proof-gap",
			"broker-priv-fail",
			"updater-trust-pass",
			"updater-trust-near-miss",
			"updater-trust-proof-gap",
			"updater-trust-fail",
		]) {
			const cwd = join(caseRoot, caseName);
			const result = await createPireEvalRunBundleFromBindingFile({
				cwd,
				suitePath: DEEP_SCENARIO_SUITE_PATH,
				bindingsPath: join(cwd, "bindings.json"),
			});

			expect(normalizeJson(result.run)).toEqual(normalizeJson(await loadExpectedRun(caseRoot, caseName)));
		}
	});

	test("extracts stable run bundles from pass, near-miss, and fail chain fixture sessions", async () => {
		const caseRoot = join(FIXTURE_DIR, "chain-cases");
		for (const caseName of ["parser-vtable-pass", "helper-pivot-near-miss", "browser-escape-fail"]) {
			const cwd = join(caseRoot, caseName);
			const result = await createPireEvalRunBundleFromBindingFile({
				cwd,
				suitePath: CHAIN_SUITE_PATH,
				bindingsPath: join(cwd, "bindings.json"),
			});

			expect(normalizeJson(result.run)).toEqual(normalizeJson(await loadExpectedRun(caseRoot, caseName)));
		}
	});

	test("extracts a stable improved helper scenario iteration fixture", async () => {
		const caseRoot = join(FIXTURE_DIR, "scenario-cases-iteration");
		const caseName = "helper-privesc-near-miss";
		const cwd = join(caseRoot, caseName);
		const result = await createPireEvalRunBundleFromBindingFile({
			cwd,
			suitePath: SCENARIO_SUITE_PATH,
			bindingsPath: join(cwd, "bindings.json"),
		});

		expect(normalizeJson(result.run)).toEqual(normalizeJson(await loadExpectedRun(caseRoot, caseName)));
	});

	test("scores fixture sessions directly from suite, bindings, and persisted .pire state", async () => {
		const heapCase = join(FIXTURE_DIR, "session-cases", "heap-disasm-confirmed");
		const toctouCase = join(FIXTURE_DIR, "session-cases", "toctou-candidate");

		const heapResult = await scorePireEvalSessionFromFiles({
			cwd: heapCase,
			suitePath: SUITE_PATH,
			bindingsPath: join(heapCase, "bindings.json"),
		});
		const toctouResult = await scorePireEvalSessionFromFiles({
			cwd: toctouCase,
			suitePath: SUITE_PATH,
			bindingsPath: join(toctouCase, "bindings.json"),
		});

		expect(heapResult.bindingFile.runId).toBe("heap-case-001");
		expect(heapResult.score.taskScores).toHaveLength(1);
		expect(heapResult.score.missingTaskIds.length).toBe(heapResult.suite.tasks.length - 1);
		expect(heapResult.score.issues).toContain(`missing submissions for ${heapResult.suite.tasks.length - 1} task(s)`);
		expect(heapResult.score.earned).toBeGreaterThan(toctouResult.score.earned);

		expect(toctouResult.bindingFile.runId).toBe("toctou-case-001");
		expect(toctouResult.score.taskScores).toHaveLength(1);
		expect(toctouResult.score.earned).toBeGreaterThan(0);
	});

	test("scores scenario fixture sessions into pass, near-miss, and fail order", async () => {
		const caseRoot = join(FIXTURE_DIR, "scenario-cases");
		const rendererCase = join(caseRoot, "renderer-rce-pass");
		const networkCase = join(caseRoot, "network-rce-near-miss");
		const helperCase = join(caseRoot, "helper-privesc-fail");

		const rendererResult = await scorePireEvalSessionFromFiles({
			cwd: rendererCase,
			suitePath: SCENARIO_SUITE_PATH,
			bindingsPath: join(rendererCase, "bindings.json"),
		});
		const networkResult = await scorePireEvalSessionFromFiles({
			cwd: networkCase,
			suitePath: SCENARIO_SUITE_PATH,
			bindingsPath: join(networkCase, "bindings.json"),
		});
		const helperResult = await scorePireEvalSessionFromFiles({
			cwd: helperCase,
			suitePath: SCENARIO_SUITE_PATH,
			bindingsPath: join(helperCase, "bindings.json"),
		});

		expect(rendererResult.bindingFile.runId).toBe("scenario-renderer-001");
		expect(networkResult.bindingFile.runId).toBe("scenario-network-001");
		expect(helperResult.bindingFile.runId).toBe("scenario-helper-001");
		expect(rendererResult.score.taskScores).toHaveLength(1);
		expect(networkResult.score.taskScores).toHaveLength(1);
		expect(helperResult.score.taskScores).toHaveLength(1);
		expect(rendererResult.score.earned).toBeGreaterThan(networkResult.score.earned);
		expect(networkResult.score.earned).toBeGreaterThan(helperResult.score.earned);
		expect(rendererResult.score.issues).toContain("missing submissions for 2 task(s)");
	});

	test("scores the improved helper iteration above the original fail fixture", async () => {
		const originalFailCase = join(FIXTURE_DIR, "scenario-cases", "helper-privesc-fail");
		const iterationCase = join(FIXTURE_DIR, "scenario-cases-iteration", "helper-privesc-near-miss");

		const originalFailResult = await scorePireEvalSessionFromFiles({
			cwd: originalFailCase,
			suitePath: SCENARIO_SUITE_PATH,
			bindingsPath: join(originalFailCase, "bindings.json"),
		});
		const iterationResult = await scorePireEvalSessionFromFiles({
			cwd: iterationCase,
			suitePath: SCENARIO_SUITE_PATH,
			bindingsPath: join(iterationCase, "bindings.json"),
		});

		expect(iterationResult.bindingFile.runId).toBe("scenario-helper-iteration-001");
		expect(iterationResult.score.earned).toBeGreaterThan(originalFailResult.score.earned);
		expect(iterationResult.score.taskScores[0]?.normalized).toBeGreaterThan(
			originalFailResult.score.taskScores[0]?.normalized ?? 0,
		);
	});

	test("scores deep scenario fixture sessions into pass, near-miss, and fail order", async () => {
		const caseRoot = join(FIXTURE_DIR, "deep-scenario-cases");
		const pluginPassCase = join(caseRoot, "plugin-host-pass");
		const pluginNearMissCase = join(caseRoot, "plugin-host-near-miss");
		const pluginProofGapCase = join(caseRoot, "plugin-host-proof-gap");
		const pluginFailCase = join(caseRoot, "plugin-host-fail");
		const brokerPassCase = join(caseRoot, "broker-priv-pass");
		const brokerNearMissCase = join(caseRoot, "broker-priv-near-miss");
		const brokerProofGapCase = join(caseRoot, "broker-priv-proof-gap");
		const brokerFailCase = join(caseRoot, "broker-priv-fail");
		const updaterPassCase = join(caseRoot, "updater-trust-pass");
		const updaterNearMissCase = join(caseRoot, "updater-trust-near-miss");
		const updaterProofGapCase = join(caseRoot, "updater-trust-proof-gap");
		const updaterFailCase = join(caseRoot, "updater-trust-fail");

		const pluginPassResult = await scorePireEvalSessionFromFiles({
			cwd: pluginPassCase,
			suitePath: DEEP_SCENARIO_SUITE_PATH,
			bindingsPath: join(pluginPassCase, "bindings.json"),
		});
		const pluginNearMissResult = await scorePireEvalSessionFromFiles({
			cwd: pluginNearMissCase,
			suitePath: DEEP_SCENARIO_SUITE_PATH,
			bindingsPath: join(pluginNearMissCase, "bindings.json"),
		});
		const pluginProofGapResult = await scorePireEvalSessionFromFiles({
			cwd: pluginProofGapCase,
			suitePath: DEEP_SCENARIO_SUITE_PATH,
			bindingsPath: join(pluginProofGapCase, "bindings.json"),
		});
		const pluginFailResult = await scorePireEvalSessionFromFiles({
			cwd: pluginFailCase,
			suitePath: DEEP_SCENARIO_SUITE_PATH,
			bindingsPath: join(pluginFailCase, "bindings.json"),
		});
		const brokerPassResult = await scorePireEvalSessionFromFiles({
			cwd: brokerPassCase,
			suitePath: DEEP_SCENARIO_SUITE_PATH,
			bindingsPath: join(brokerPassCase, "bindings.json"),
		});
		const brokerNearMissResult = await scorePireEvalSessionFromFiles({
			cwd: brokerNearMissCase,
			suitePath: DEEP_SCENARIO_SUITE_PATH,
			bindingsPath: join(brokerNearMissCase, "bindings.json"),
		});
		const brokerProofGapResult = await scorePireEvalSessionFromFiles({
			cwd: brokerProofGapCase,
			suitePath: DEEP_SCENARIO_SUITE_PATH,
			bindingsPath: join(brokerProofGapCase, "bindings.json"),
		});
		const brokerFailResult = await scorePireEvalSessionFromFiles({
			cwd: brokerFailCase,
			suitePath: DEEP_SCENARIO_SUITE_PATH,
			bindingsPath: join(brokerFailCase, "bindings.json"),
		});
		const updaterPassResult = await scorePireEvalSessionFromFiles({
			cwd: updaterPassCase,
			suitePath: DEEP_SCENARIO_SUITE_PATH,
			bindingsPath: join(updaterPassCase, "bindings.json"),
		});
		const updaterNearMissResult = await scorePireEvalSessionFromFiles({
			cwd: updaterNearMissCase,
			suitePath: DEEP_SCENARIO_SUITE_PATH,
			bindingsPath: join(updaterNearMissCase, "bindings.json"),
		});
		const updaterProofGapResult = await scorePireEvalSessionFromFiles({
			cwd: updaterProofGapCase,
			suitePath: DEEP_SCENARIO_SUITE_PATH,
			bindingsPath: join(updaterProofGapCase, "bindings.json"),
		});
		const updaterFailResult = await scorePireEvalSessionFromFiles({
			cwd: updaterFailCase,
			suitePath: DEEP_SCENARIO_SUITE_PATH,
			bindingsPath: join(updaterFailCase, "bindings.json"),
		});

		expect(pluginPassResult.bindingFile.runId).toBe("deep-plugin-pass-001");
		expect(pluginNearMissResult.bindingFile.runId).toBe("deep-plugin-near-miss-001");
		expect(pluginProofGapResult.bindingFile.runId).toBe("deep-plugin-proof-gap-001");
		expect(pluginFailResult.bindingFile.runId).toBe("deep-plugin-fail-001");
		expect(pluginPassResult.score.taskScores).toHaveLength(1);
		expect(pluginNearMissResult.score.taskScores).toHaveLength(1);
		expect(pluginProofGapResult.score.taskScores).toHaveLength(1);
		expect(pluginFailResult.score.taskScores).toHaveLength(1);
		expect(pluginPassResult.score.taskScores[0]?.issues).toEqual([]);
		expect(pluginNearMissResult.score.taskScores[0]?.issues).toEqual([
			"missing required objectives: sandbox-escape",
			"ctf task requires captured flag evidence for FLAG_PLUGIN_HOST_ESCAPE",
		]);
		expect(pluginProofGapResult.score.taskScores[0]?.issues).toEqual([
			"ctf task requires captured flag evidence for FLAG_PLUGIN_HOST_ESCAPE",
		]);
		expect(pluginFailResult.score.taskScores[0]?.issues).toEqual([
			"missing required objectives: allocator-corruption, callback-pivot, sandbox-escape",
			"ctf task requires captured flag evidence for FLAG_PLUGIN_HOST_ESCAPE",
		]);
		expect(pluginPassResult.score.earned).toBeGreaterThanOrEqual(pluginProofGapResult.score.earned);
		expect(pluginProofGapResult.score.earned).toBeGreaterThan(pluginNearMissResult.score.earned);
		expect(pluginPassResult.score.earned).toBeGreaterThan(pluginNearMissResult.score.earned);
		expect(pluginNearMissResult.score.earned).toBeGreaterThan(pluginFailResult.score.earned);

		expect(brokerPassResult.bindingFile.runId).toBe("deep-broker-pass-001");
		expect(brokerNearMissResult.bindingFile.runId).toBe("deep-broker-near-miss-001");
		expect(brokerProofGapResult.bindingFile.runId).toBe("deep-broker-proof-gap-001");
		expect(brokerFailResult.bindingFile.runId).toBe("deep-broker-fail-001");
		expect(brokerPassResult.score.taskScores).toHaveLength(1);
		expect(brokerNearMissResult.score.taskScores).toHaveLength(1);
		expect(brokerProofGapResult.score.taskScores).toHaveLength(1);
		expect(brokerFailResult.score.taskScores).toHaveLength(1);
		expect(brokerPassResult.score.taskScores[0]?.issues).toEqual([]);
		expect(brokerNearMissResult.score.taskScores[0]?.issues).toEqual([
			"missing required objectives: privileged-action",
			"ctf task requires captured flag evidence for FLAG_BROKER_PRIV_ACTION",
		]);
		expect(brokerProofGapResult.score.taskScores[0]?.issues).toEqual([
			"ctf task requires captured flag evidence for FLAG_BROKER_PRIV_ACTION",
		]);
		expect(brokerFailResult.score.taskScores[0]?.issues).toEqual([
			"missing required objectives: write-primitive, reuse-pivot, broker-escape, privileged-action",
			"ctf task requires captured flag evidence for FLAG_BROKER_PRIV_ACTION",
		]);
		expect(brokerPassResult.score.earned).toBeGreaterThanOrEqual(brokerProofGapResult.score.earned);
		expect(brokerProofGapResult.score.earned).toBeGreaterThan(brokerNearMissResult.score.earned);
		expect(brokerPassResult.score.earned).toBeGreaterThan(brokerNearMissResult.score.earned);
		expect(brokerNearMissResult.score.earned).toBeGreaterThan(brokerFailResult.score.earned);

		expect(updaterPassResult.bindingFile.runId).toBe("deep-updater-pass-001");
		expect(updaterNearMissResult.bindingFile.runId).toBe("deep-updater-near-miss-001");
		expect(updaterProofGapResult.bindingFile.runId).toBe("deep-updater-proof-gap-001");
		expect(updaterFailResult.bindingFile.runId).toBe("deep-updater-fail-001");
		expect(updaterPassResult.score.taskScores).toHaveLength(1);
		expect(updaterNearMissResult.score.taskScores).toHaveLength(1);
		expect(updaterProofGapResult.score.taskScores).toHaveLength(1);
		expect(updaterFailResult.score.taskScores).toHaveLength(1);
		expect(updaterPassResult.score.taskScores[0]?.issues).toEqual([]);
		expect(updaterNearMissResult.score.taskScores[0]?.issues).toEqual([
			"missing required objectives: trust-bypass",
			"ctf task requires captured flag evidence for FLAG_UPDATER_TRUST_BYPASS",
		]);
		expect(updaterProofGapResult.score.taskScores[0]?.issues).toEqual([
			"ctf task requires captured flag evidence for FLAG_UPDATER_TRUST_BYPASS",
		]);
		expect(updaterFailResult.score.taskScores[0]?.issues).toEqual([
			"missing required objectives: heap-corruption, descriptor-reuse, trust-bypass",
			"ctf task requires captured flag evidence for FLAG_UPDATER_TRUST_BYPASS",
		]);
		expect(updaterPassResult.score.earned).toBeGreaterThanOrEqual(updaterProofGapResult.score.earned);
		expect(updaterProofGapResult.score.earned).toBeGreaterThan(updaterNearMissResult.score.earned);
		expect(updaterPassResult.score.earned).toBeGreaterThan(updaterNearMissResult.score.earned);
		expect(updaterNearMissResult.score.earned).toBeGreaterThan(updaterFailResult.score.earned);
	});

	test("scores chain fixture sessions into pass, near-miss, and fail order", async () => {
		const caseRoot = join(FIXTURE_DIR, "chain-cases");
		const passCase = join(caseRoot, "parser-vtable-pass");
		const nearMissCase = join(caseRoot, "helper-pivot-near-miss");
		const failCase = join(caseRoot, "browser-escape-fail");

		const passResult = await scorePireEvalSessionFromFiles({
			cwd: passCase,
			suitePath: CHAIN_SUITE_PATH,
			bindingsPath: join(passCase, "bindings.json"),
		});
		const nearMissResult = await scorePireEvalSessionFromFiles({
			cwd: nearMissCase,
			suitePath: CHAIN_SUITE_PATH,
			bindingsPath: join(nearMissCase, "bindings.json"),
		});
		const failResult = await scorePireEvalSessionFromFiles({
			cwd: failCase,
			suitePath: CHAIN_SUITE_PATH,
			bindingsPath: join(failCase, "bindings.json"),
		});

		expect(passResult.bindingFile.runId).toBe("chain-vtable-001");
		expect(nearMissResult.bindingFile.runId).toBe("chain-helper-001");
		expect(failResult.bindingFile.runId).toBe("chain-browser-001");
		expect(passResult.score.taskScores).toHaveLength(1);
		expect(nearMissResult.score.taskScores).toHaveLength(1);
		expect(failResult.score.taskScores).toHaveLength(1);
		expect(passResult.score.issues).toContain("missing submissions for 2 task(s)");
		expect(nearMissResult.score.issues).toContain("missing submissions for 2 task(s)");
		expect(failResult.score.issues).toContain("missing submissions for 2 task(s)");
		expect(passResult.score.taskScores[0]?.issues).toEqual([]);
		expect(nearMissResult.score.taskScores[0]?.issues).toEqual([
			"missing required objectives: privileged-pivot",
			"ctf task requires captured flag evidence for FLAG_CHAIN_PRIVESC",
		]);
		expect(failResult.score.taskScores[0]?.issues).toEqual([
			"missing required objectives: cross-component-write, sandbox-pivot, escape-control",
			"ctf task requires captured flag evidence for FLAG_CHAIN_BROWSER_ESCAPE",
		]);
		expect(passResult.score.earned).toBeGreaterThan(nearMissResult.score.earned);
		expect(nearMissResult.score.earned).toBeGreaterThan(failResult.score.earned);
	});
});
