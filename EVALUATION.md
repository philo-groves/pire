# Evaluation Guide

This repository treats evals as the main loop for improving `pire`:

1. Run a stable fixture suite or captured session corpus.
2. Observe where the agent fails, stalls, or overclaims.
3. Change the harness, prompts, or workflow.
4. Re-run the same evals until the failure becomes a near-miss or pass.

## Current Focus

The current eval program is centered on binary reverse engineering rather than web exploitation:

- shell-first workflows
- binary triage and disassembly
- exploitability analysis
- multi-stage chain construction
- end-to-end scenario execution

Complex `chain` and `scenario` tasks use CTF-style success criteria:

- required intermediate objectives
- captured-flag evidence for a full pass
- explicit pass / near-miss / fail summaries
- baseline drift enforcement in CI

## Core Commands

Run from `packages/coding-agent`:

```bash
npx tsx ./src/pire-eval-cli.ts \
  --suite test/fixtures/pire-evals/chain-suite.json \
  --cases-dir test/fixtures/pire-evals/chain-cases
```

```bash
npx tsx ./src/pire-eval-cli.ts \
  --suite test/fixtures/pire-evals/scenario-suite.json \
  --cases-dir test/fixtures/pire-evals/scenario-cases \
  --json
```

Scaffold a new deep-case starter from an existing task:

```bash
npx tsx ./src/pire-eval-scaffold-cli.ts \
  --suite test/fixtures/pire-evals/deep-scenario-suite.json \
  --cases-dir test/fixtures/pire-evals/deep-scenario-cases \
  --task-id binre-scenario-006 \
  --preset proof-gap \
  --case-name broker-proof-gap-next
```

Save or compare baselines:

```bash
npx tsx ./src/pire-eval-cli.ts \
  --suite test/fixtures/pire-evals/scenario-suite.json \
  --cases-dir test/fixtures/pire-evals/scenario-cases \
  --save-baseline last-good
```

```bash
npx tsx ./src/pire-eval-cli.ts \
  --suite test/fixtures/pire-evals/scenario-suite.json \
  --cases-dir test/fixtures/pire-evals/scenario-cases \
  --baseline @last-good \
  --enforce
```

## Fixture Suites

Primary fixture suites:

- `packages/coding-agent/test/fixtures/pire-evals/binary-re-starter-suite.json`
- `packages/coding-agent/test/fixtures/pire-evals/chain-suite.json`
- `packages/coding-agent/test/fixtures/pire-evals/scenario-suite.json`
- `packages/coding-agent/test/fixtures/pire-evals/deep-scenario-suite.json`

Primary case directories:

- `packages/coding-agent/test/fixtures/pire-evals/session-cases`
- `packages/coding-agent/test/fixtures/pire-evals/chain-cases`
- `packages/coding-agent/test/fixtures/pire-evals/scenario-cases`
- `packages/coding-agent/test/fixtures/pire-evals/deep-scenario-cases`

The real fixture metadata now carries expected outcome shape in `case.json` and `cases.json`, including:

- normalized score floors
- issue ceilings
- chain pass / near-miss / fail expectations
- scenario pass / near-miss / fail expectations
- baseline drift thresholds

## Current Status

Current direct eval runs show:

- `binary-re-starter-suite.json`: passes
- `scenario-suite.json`: passes
- `chain-suite.json`: passes
- `deep-scenario-suite.json`: passes

All four suites pass expectation enforcement with zero regressions. The deep suite produces 16 cases:

- `pass=3`
- `near-miss=6`
- `fail=7`

Key scorer improvements:

- CTF proof enforcement: the proof dimension is capped at "partial" when a CTF task has no captured flag evidence, preventing overclaiming
- CTF chaining enforcement: the chaining dimension is capped by objective completion ratio, so incomplete chains cannot score as high as complete ones
- Tier-based rank expectations: maxRank is set per outcome tier instead of per-case absolute ranks, eliminating brittle regressions from alphabetical tie-breaking within tied scores

Gap-targeting tasks added to the deep suite expose specific harness weaknesses:

- `binre-scenario-007` (slab allocator heap exploitation): requires heap dump analysis, custom allocator metadata reversal, and fake object placement — the harness lacks heap introspection and interactive debugging, so it stalls at the allocator-reversal stage
- `binre-scenario-008` (ROP-gated CFI bypass): requires programmatic gadget search, CFI-aware chain assembly, and JIT page pivot — the harness has no ROP tooling, so it can only manually identify a few gadgets via objdump but cannot assemble or validate a chain

Both gap tasks currently produce only fail outcomes. Moving either to near-miss requires new harness capabilities (interactive debugging, heap dump parsing, gadget search, or chain assembly tooling).

## What To Improve

Use eval results to drive changes in this order:

1. Root-cause extraction and evidence quality
2. Primitive identification
3. Chain composition
4. End-to-end scenario completion
5. Reduction of overclaiming and false positives

Current priority inside that list:

1. Heap introspection: interactive GDB breakpoints on allocator internals, heap dump parsing, fake object validation — would unblock binre-scenario-007 from fail to near-miss
2. ROP/gadget tooling: programmatic gadget search with CFI-aware filtering, chain assembly, stack pivot validation — would unblock binre-scenario-008 from fail to near-miss
3. Batch decompilation: Ghidra cross-function data-flow analysis for multi-component chains
4. Reduction of overclaiming and false positives in near-miss cases

If the harness starts passing the current 3-stage and 4-stage chains too easily, add deeper tasks rather than relaxing the bar. The intended progression is:

- fail
- near-miss
- pass
- harder corpus
