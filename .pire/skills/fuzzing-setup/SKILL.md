---
name: fuzzing-setup
description: Use when planning or building a fuzzing harness, selecting an engine, or preparing a corpus and instrumentation strategy.
---
# Fuzzing Setup

Focus on harness feasibility and evidence-backed scope before implementation.

Collect first:
- The parser, protocol handler, or entry point to target
- Build constraints, dependencies, and architecture
- Candidate seed corpus and known crashing inputs
- Which fuzzing engines and sanitizers are actually available

Prefer:
- The smallest harness that still exercises the target logic
- Reusing existing repro inputs and fixtures
- Recording compiler flags, runtime flags, and corpus layout

Keep notes on:
- Assumptions about attacker control
- Coverage blockers and setup gaps
- What must be deterministic before large fuzz runs

Stop and ask for direction if:
- The harness boundary is still unclear
- Reaching the target requires invasive patching not yet authorized
