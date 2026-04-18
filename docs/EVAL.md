# PiRE v2 Evaluation Design

## Principle: The eval is a user, not a component

The eval harness treats the agent as a black box. It provides a target, local
artifacts, and a success condition. It does not hide files, inject private
answers, block tools, or change agent behavior.

This means:
- The agent behaves the same in eval and real use
- Harness changes and agent changes stay decoupled
- There is no benchmark-only mode in the agent

## Primary Eval: CyberGym

Primary dataset: CyberGym source-led vulnerability proof tasks.

Each task gives the agent:
- a source tree
- a vulnerability description
- optional trace and patch artifacts
- a location where the PoC must be written
- vulnerable and fixed container images for validation

The harness validates the candidate PoC against both images and scores the run
on the real outcome:
- vulnerable image crashes or otherwise triggers
- fixed image survives

This matches the current agent direction better than flag-capture web
benchmarks because it directly measures proof construction, validation
discipline, and target anchoring.

## CLI Interface

The active CLI is `pire-eval`, backed by the CyberGym runner.

```bash
# Run one task
pire-eval --task arvo:1065 --difficulty level1

# Run a shuffled slice
pire-eval --task-type arvo --difficulty level3 --limit 5

# Run one project family
pire-eval --project sudoers --difficulty level3 --limit 3

# Reproduce a shuffled selection
pire-eval --task-type arvo --difficulty level2 --limit 10 --seed 123

# Save machine-readable results
pire-eval --task arvo:1065 --difficulty level1 --json --save result.json

# Append markdown run history somewhere else
pire-eval --task arvo:1065 --history-file ./notes/cybergym-runs.md
```

## Runner Logic

For each selected task:

1. Load task metadata from the CyberGym index
2. Download source and supporting artifacts lazily
3. Pull vulnerable and fixed images
4. Prepare a task workspace and session directory
5. Spawn the agent with:
   - source path
   - vulnerability description
   - output PoC path
   - optional trace / patch context
6. Expose validation and debug backends through generic agent tools
7. Let the agent write and iterate on the candidate artifact
8. Validate the final PoC against vulnerable and fixed images
9. Record pass/fail plus trajectory metrics
10. Append the run to `docs/CYBERGYM_RUNS.md`

## Success Criteria

A task passes if and only if:
- the agent produced a PoC artifact
- the vulnerable target triggers
- the fixed target survives

The harness also records useful failure splits:
- no PoC produced
- vulnerable target did not trigger
- fixed target also triggered
- timeout or harness error

## Metrics

### Primary

| Metric | Description |
|---|---|
| Pass rate | passed tasks / total tasks |
| Pass rate by difficulty | `level0` to `level3` |
| Pass rate by project | project-family weak spots |

### Secondary

| Metric | Description |
|---|---|
| Time to completion | wall clock per task |
| Setup vs agent time | Docker/data overhead vs actual reasoning |
| Notebook entries | persistent state usage |
| Surface map usage | whether ranked triage was used |
| Plan usage | whether the task was decomposed |

These secondary metrics help distinguish:
- wrong-target drift
- last-mile proofing failures
- validator/runtime blockers
- wasted exploration

## Run History

Every completed CLI run appends a short entry to
`docs/CYBERGYM_RUNS.md` with:
- timestamp
- run label
- result summary
- difficulty and selection mode
- repository commit hash at run time
- per-task outcomes

This replaces the old ad hoc `.tmp-cybergym-*.json` sprawl as the durable human
record. JSON output is still available when needed for scripts.

## Custom Labs

CyberGym is the primary automated benchmark, not the only eval. We still want
custom labs for areas CyberGym under-covers:
- runtime state recovery
- debugger-driven proofing
- live web/browser workflows
- binary RE and exploit chains
- privilege escalation / multi-step extraction

Those labs should use the same core principle:
- agent is black box
- no hidden hints
- generic validation/debug interfaces
- no benchmark-shaped prompt behavior in the base agent

## What the eval does NOT do

- hide files from the agent
- remove useful tools
- inject hidden benchmark answers
- force phases
- teach benchmark-specific tactics inside the agent

If the agent needs a capability to succeed, that capability should exist for
real usage too.
