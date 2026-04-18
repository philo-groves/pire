# PiRE v2 Overview

## What We're Building

An autonomous security research agent that finds and exploits real
vulnerabilities, produces auditable trajectories, and resists shortcuts.

Built on [pi-mono](https://github.com/badlogic/pi-mono) as a foundation, with
targeted architectural changes rather than a full fork.

## Goals

1. **Score well on CyberGym and custom proofing labs** — especially on
   source-led proof construction and validation, without agent special-casing.
2. **Perform useful security research on real targets** — web apps, source
   audits, binary analysis — not just CTF challenges.
3. **Produce auditable trajectories** — a reviewer can reconstruct why the agent
   chose its path, what it tried, and what evidence changed its mind.
4. **Resist shortcuts and hostile instructions** — don't fabricate proof, don't
   follow injected instructions, don't claim findings without evidence.
5. **Pass@1 discipline** — succeed on the first attempt through good strategy,
   not through retry loops or broad exploratory churn.

## Non-Goals

- General-purpose coding assistant. PiRE v2 is a security research tool.
- Perfect benchmark scores. We optimize for real-target capability, not
  leaderboard position.
- Fully autonomous multi-day campaigns. v2 scope is single-session research
  (minutes to hours).
- Replacing human researchers. The agent is a force multiplier, not a
  replacement.

## Scope

### In scope for v2

- CyberGym proof-construction benchmarks as primary automated eval
- Source code auditing (real open-source targets)
- Custom lab challenges (binary RE, runtime state, privilege escalation)
- Single-session autonomous operation
- Human-in-the-loop oversight via pimote

### Deferred to v3+

- Multi-session campaigns with persistent findings
- Collaborative multi-agent research teams
- Automated report generation
- Integration with bug bounty platforms
- Fuzzing and coverage-guided testing

## Key Architectural Decisions

These are the high-level choices that differentiate v2 from v1. Each is
elaborated in the relevant design doc.

### 1. Thin customization layer, not a deep fork

v1 forked pi-mono and modified it extensively. v2 uses pi-mono as an upstream
dependency and customizes through its extension and tool APIs. This keeps the
agent runtime maintained by upstream while we focus on security-specific
capability.

### 2. Security tools as first-class tools, not bash wrappers

v1 relied entirely on bash for security work (curl commands, ad-hoc Python
scripts, shell one-liners). v2 adds structured tools for HTTP interaction,
Python execution, and a research notebook. These return structured data and
reduce the context cost of every interaction.

### 3. Research notebook for compaction-safe state

v1 relied on conversation history for state management. Values were lost to
compaction, and the agent frequently re-derived information it had already found.
v2 adds a notebook tool that persists outside the conversation window.

### 4. Minimal global prompt, heavy task-local context

v1's system prompt was 130+ lines of methodology, anti-patterns, and
lab-specific conventions. v2 targets ~20 lines of global posture. Challenge
descriptions, domain guidance, and workflow hints go in task-local context.

### 5. Eval harness completely separated from agent

v1's eval system modified agent behavior (hid files, blocked tools, injected
state). v2's eval harness is a separate package that treats the agent as a black
box: provide a target and description, check if the flag was captured. The agent
behaves identically during eval and real use.

## Success Criteria for v2

- [ ] CyberGym level0-level3 runs are tracked in `docs/CYBERGYM_RUNS.md`
- [ ] CyberGym pass rate trends upward across repeated runs
- [ ] Custom lab pass rate >= 60% on challenge-tier and runtime-tier
- [ ] No eval-specific behavior in agent code (same code path for eval and real use)
- [ ] Median time-to-first-useful-action < 3 tool calls
- [ ] Agent produces usable notebook/findings on failed attempts
- [ ] Successful trajectory is auditable by a third party
