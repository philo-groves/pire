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
- `near-miss=8`
- `fail=5`

Key scorer improvements:

- CTF proof enforcement: the proof dimension is capped at "partial" when a CTF task has no captured flag evidence, preventing overclaiming
- CTF chaining enforcement: the chaining dimension is capped by objective completion ratio, so incomplete chains cannot score as high as complete ones
- Tier-based rank expectations: maxRank is set per outcome tier instead of per-case absolute ranks, eliminating brittle regressions from alphabetical tie-breaking within tied scores

Gap-targeting tasks test specific harness weaknesses:

- `binre-scenario-007` (slab allocator heap exploitation): requires heap dump analysis, custom allocator metadata reversal, and fake object placement
- `binre-scenario-008` (ROP-gated CFI bypass): requires programmatic gadget search, CFI-aware chain assembly, and JIT page pivot

New harness tools added to address these gaps:

- `debug_gdb_commands`: multi-command GDB batch mode — set breakpoints, run, inspect registers, dump memory in a single tool call
- `debug_gdb_script`: GDB Python script execution — write programmatic analysis (allocator walkers, heap metadata dumpers, conditional inspection) and run it in batch mode
- `disasm_radare2_gadgets`: radare2-based ROP gadget search with pattern matching and result limiting
- `exploit_ropgadget`: ROPgadget wrapper with instruction filtering, pattern search, depth control, and auto-chain generation

These tools moved the gap-task near-miss fixtures from FAIL to NEAR-MISS:

- `slab-heap-near-miss`: FAIL 52% → NEAR 62% (debug_gdb_commands + debug_gdb_script enabled heap inspection through vtable-hijack, 3→5 of 6 objectives)
- `rop-chain-near-miss`: FAIL 56% → NEAR 65% (exploit_ropgadget + disasm_radare2_gadgets enabled chain assembly through stack-pivot, 3→5 of 7 objectives)

Remaining gap-task fails represent harder blockers: slab-heap-fail is blocked by multi-tier allocator topology (needs a dedicated GDB Python walker per allocator variant), rop-chain-fail is blocked by CFI eliminating all pivot gadgets (needs a wider write primitive or a different exploitation strategy).

## What To Improve

Use eval results to drive changes in this order:

1. Root-cause extraction and evidence quality
2. Primitive identification
3. Chain composition
4. End-to-end scenario completion
5. Reduction of overclaiming and false positives

Current priority inside that list:

1. Move gap-task near-misses toward pass: slab-heap needs the missing info leak for the privileged callback; rop-chain needs the JIT page address leak
2. Prompt/skill authoring: teach the agent to compose effective GDB command sequences for heap analysis and to cross-reference gadget search results with CFI policy
3. Move gap-task fails toward near-miss: slab-heap-fail needs a per-variant GDB Python walker for the multi-tier allocator; rop-chain-fail needs a wider write primitive or alternative exploitation strategy
4. Batch decompilation: Ghidra cross-function data-flow analysis for multi-component chains

If the harness starts passing the current 3-stage and 4-stage chains too easily, add deeper tasks rather than relaxing the bar. The intended progression is:

- fail
- near-miss
- pass
- harder corpus
