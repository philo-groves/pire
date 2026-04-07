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

Primary case directories:

- `packages/coding-agent/test/fixtures/pire-evals/session-cases`
- `packages/coding-agent/test/fixtures/pire-evals/chain-cases`
- `packages/coding-agent/test/fixtures/pire-evals/scenario-cases`

The real fixture metadata now carries expected outcome shape in `case.json` and `cases.json`, including:

- normalized score floors
- issue ceilings
- chain pass / near-miss / fail expectations
- scenario pass / near-miss / fail expectations
- baseline drift thresholds

## What To Improve

Use eval results to drive changes in this order:

1. Root-cause extraction and evidence quality
2. Primitive identification
3. Chain composition
4. End-to-end scenario completion
5. Reduction of overclaiming and false positives

If the harness starts passing the current 3-stage and 4-stage chains too easily, add deeper tasks rather than relaxing the bar. The intended progression is:

- fail
- near-miss
- pass
- harder corpus
