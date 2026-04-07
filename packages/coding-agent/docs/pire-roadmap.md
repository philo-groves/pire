# Pire Roadmap

`pire` should be a reverse-engineering and security-research harness built on Pi's extension points, not just a rebranded coding agent. The core shift is from "edit code to satisfy a task" to "collect evidence, test hypotheses, preserve chain-of-reasoning artifacts, and only write code when it advances analysis."

## What Pi Already Gives Us

Pi already has the right seams for this:

- System prompt composition and project context loading via [`system-prompt.ts`](/home/philo/pire/packages/coding-agent/src/core/system-prompt.ts) and [`resource-loader.ts`](/home/philo/pire/packages/coding-agent/src/core/resource-loader.ts)
- Tool registration and tool-specific prompt guidance via [`agent-session.ts`](/home/philo/pire/packages/coding-agent/src/core/agent-session.ts)
- An extension system for workflow/UI/tool changes via [`types.ts`](/home/philo/pire/packages/coding-agent/src/core/extensions/types.ts)
- Existing examples for read-only planning and delegated subagents via [`examples/extensions/plan-mode`](/home/philo/pire/packages/coding-agent/examples/extensions/plan-mode/README.md) and [`examples/extensions/subagent`](/home/philo/pire/packages/coding-agent/examples/extensions/subagent/README.md)
- Built-in compaction/session infrastructure via [`compaction.ts`](/home/philo/pire/packages/coding-agent/src/core/compaction/compaction.ts)

That means `pire` can start as a focused package/profile on top of Pi, then selectively grow runtime changes where the current coding assumptions become a liability.

## Goals

1. Make security research the default behavior, not an optional prompt style.
2. Bias the agent toward evidence gathering, reproducibility, and hypothesis tracking.
3. Reduce accidental destructive actions against targets, corpora, and work products.
4. Preserve research state better than code-oriented compaction does today.
5. Make common RE tasks first-class: triage, static analysis, dynamic analysis, exploit prototyping, and reporting.

## Phase 1: Low-Risk, High-Leverage Changes

These can mostly be implemented as prompt/templates/skills/extensions without deep runtime changes.

### 1. Research-First System Prompt

Create a `pire` base prompt that changes the default operating model:

- Treat the target as evidence, not as code to edit
- Prefer reconnaissance, environment validation, artifact inventory, and hypothesis generation before action
- Distinguish clearly between facts, inferences, and unverified assumptions
- Preserve exact commands, offsets, hashes, addresses, symbols, and crash signatures
- Default to non-destructive and read-only actions unless the user explicitly wants proofing or mutation
- When writing code, keep it scoped to helpers: parsers, emulators, repro harnesses, exploit proof-of-concepts, decoders, fuzz scaffolds

Implementation shape:

- Add a `pire` custom system prompt override on top of [`buildSystemPrompt()`](/home/philo/pire/packages/coding-agent/src/core/system-prompt.ts)
- Add `pire`-specific append sections for engagement rules, opsec notes, and evidence handling
- Load repo-level `AGENTS.md` plus optional research-local context such as `.pire/TARGET.md` or `.pire/NOTES.md`

### 2. Curated Prompt Templates

Ship prompt templates for recurring workflows:

- `/triage-binary`
- `/triage-pcap`
- `/triage-firmware`
- `/repro-crash`
- `/diff-builds`
- `/audit-surface`
- `/trace-behavior`
- `/summarize-findings`
- `/write-report`

Each template should force structured output:

- Objective
- Known facts
- Unknowns
- Planned evidence collection
- Commands to run
- Findings
- Next hypotheses

### 3. Core Skills for RE and Security Research

Add skills that encode concrete workflows instead of generic advice:

- `binary-triage`
- `crash-analysis`
- `fuzzing-setup`
- `pcap-analysis`
- `firmware-unpack`
- `web-target-recon`
- `malware-sandbox-notes`
- `exploit-repro`
- `write-up`

Each skill should tell the agent:

- Which artifacts to collect first
- Which commands/tools to prefer
- What intermediate notes to keep
- When to stop and ask for a decision

### 4. Read-Only by Default Modes

Pi already has a plan-mode example. `pire` should make that mindset central:

- Default session mode should be reconnaissance/read-only
- Escalate into proofing, mutation, or exploit development explicitly
- Add visible mode labels like `recon`, `dynamic`, `proofing`, `report`

This prevents the coding-agent failure mode where the model starts editing files or generating patches before the research picture is stable.

## Phase 2: Tooling Changes That Matter

This is where `pire` starts feeling materially different from Pi.

### 5. Research Tool Packs

Pi’s built-in tool set is generic (`read`, `grep`, `find`, `ls`, `bash`, `edit`, `write`). `pire` should add named tool packs with task-level wrappers:

- `binary` pack: `file`, `strings`, `readelf`, `objdump`, `nm`, `xxd`, hashers
- `disasm` pack: wrappers for `rizin/radare2`, `ghidra` headless flows, or other configured disassemblers
- `debug` pack: `gdb`, `lldb`, `rr`, `strace`, `ltrace`, `perf`, `bpftrace` where available
- `unpack` pack: firmware/archive/container extraction helpers
- `net` pack: `tcpdump`, `tshark`, `curl`, protocol probing helpers
- `fuzz` pack: AFL/libFuzzer/honggfuzz harness helpers

Important design choice: prefer structured wrappers over raw bash whenever possible. Raw `bash` is still needed, but wrappers should return normalized fields such as:

- file path
- tool name/version
- command executed
- parsed findings
- artifacts generated

That makes compaction, reporting, and subagent handoff much more reliable.

### 6. Environment Introspection Tool

Add a first-class tool that answers:

- What analysis tools are installed?
- What version are they?
- What architecture/container/OS am I in?
- What sandbox/network restrictions apply?
- Where are writable scratch directories?

This should run early in most sessions so the model stops guessing whether `gdb`, `rizin`, `qemu`, or `tshark` exist.

### 7. Artifact Registry

Current compaction tracks read/modified files, which is useful for coding but weak for RE. `pire` should register artifacts as first-class session objects:

- binaries
- pcaps
- memory dumps
- traces
- screenshots
- disassembly exports
- crash inputs
- minimized repros
- notes/reports

For each artifact, store:

- path
- type
- hash
- provenance
- related commands
- related findings

This should feed both UI and compaction.

## Phase 3: Workflow-Specific Runtime Features

### 8. Hypothesis and Findings Tracker

Security research is iterative. Add a structured tracker for:

- hypotheses
- evidence supporting/refuting them
- open questions
- confirmed findings
- dead ends worth remembering

The agent should be able to update this state during a session and render it in a sidebar/widget. This is more useful than a generic todo list because the unit of work is not "edit file X" but "determine whether parser Y is reachable with attacker-controlled length."

Tracker shape:

- Keep the canonical state in a session-local file such as `.pire/session/findings.json`
- Mirror a human-readable projection in `.pire/session/findings.md`
- Treat hypotheses, findings, questions, and evidence as separate record types with stable IDs
- Require explicit links between records instead of burying relationships in freeform prose
- Preserve command references and artifact references so compaction can summarize without dropping provenance

Suggested record model:

- `hypothesis`
  - `id`, `title`, `status`
  - `claim`
  - `rationale`
  - `relatedEvidenceIds`
  - `relatedArtifactIds`
  - `relatedQuestionIds`
  - `confidence`
- `finding`
  - `id`, `title`, `severity`
  - `statement`
  - `basis`
  - `relatedEvidenceIds`
  - `relatedArtifactIds`
  - `reproStatus`
- `question`
  - `id`, `prompt`, `status`
  - `owner`
  - `blockedOn`
- `evidence`
  - `id`, `kind`
  - `summary`
  - `commandId`
  - `artifactId`
  - `supports`
  - `refutes`
- `deadEnd`
  - `id`, `summary`
  - `whyItFailed`
  - `artifactsChecked`
  - `doNotRepeatUntil`

Suggested statuses:

- Hypotheses: `open`, `supported`, `refuted`, `needs-more-evidence`
- Findings: `candidate`, `confirmed`, `reported`
- Questions: `open`, `answered`, `blocked`

Update rules:

1. Every non-trivial investigation step should either add evidence, update a hypothesis, answer a question, or explicitly record a dead end.
2. Commands that produce artifacts or observations should attach a short evidence entry immediately after execution rather than relying on transcript recovery later.
3. A finding should only move from `candidate` to `confirmed` when it cites concrete evidence records, not just narrative reasoning.
4. If a hypothesis is refuted, keep it in the tracker with its refuting evidence instead of deleting it.
5. Compaction should preserve the tracker as structured state, not flatten it into a prose summary.

Minimal UI behavior:

- Left sidebar shows open hypotheses, confirmed findings, and blocked questions
- Selecting a record reveals linked commands, artifacts, and supporting/refuting evidence
- Filters for `open`, `confirmed`, `blocked`, and `dead-end`
- Quick actions: `support hypothesis`, `refute hypothesis`, `promote to finding`, `mark dead end`

Example:

```json
{
  "hypotheses": [
    {
      "id": "hyp-004",
      "title": "Length field reaches parser copy loop",
      "status": "supported",
      "claim": "The packet length field can drive an unchecked copy in parse_frame().",
      "rationale": "Static review shows a length-controlled memcpy candidate.",
      "relatedEvidenceIds": ["ev-011", "ev-014"],
      "relatedArtifactIds": ["artifact-bin-main", "artifact-pcap-crash-01"],
      "relatedQuestionIds": ["q-002"],
      "confidence": "medium"
    }
  ],
  "findings": [
    {
      "id": "find-002",
      "title": "Out-of-bounds read in parse_frame()",
      "severity": "high",
      "statement": "A crafted frame triggers an out-of-bounds read before checksum validation.",
      "basis": ["ev-014", "ev-018"],
      "relatedEvidenceIds": ["ev-014", "ev-018"],
      "relatedArtifactIds": ["artifact-pcap-crash-01"],
      "reproStatus": "reproduced"
    }
  ]
}
```

This tracker should land before deeper compaction changes. Without it, later reporting and multi-agent handoff will still depend too heavily on transcript archaeology.

### 9. Better Compaction for Research Sessions

Current compaction is conversation-oriented and file-operation-oriented. `pire` needs compaction that preserves research state:

- key artifacts and hashes
- exact repro steps
- crash metadata
- memory/register observations
- important addresses/offsets/symbols
- narrowed hypotheses
- discarded avenues

The summary format should be structured enough that a future turn can resume an investigation without re-deriving the same analysis.

### 10. Multi-Agent Research Roles

The subagent example is already a good fit. `pire` should formalize specialized roles:

- `scout`: artifact inventory and quick triage
- `reverser`: static analysis and disassembly review
- `tracer`: dynamic analysis and runtime observation
- `fuzzer`: harness planning and corpus strategy
- `reviewer`: sanity-check findings and challenge weak assumptions
- `writer`: turn notes into a report or advisory

This is especially useful when the main thread needs one agent to keep the big picture while side agents inspect symbols, trace paths, or compare builds.

### 11. Session Types

Add startup/session presets:

- Binary RE
- Crash triage
- Network/protocol analysis
- Firmware analysis
- Web security review
- Malware analysis

Each preset selects:

- default tools
- default prompt appendices
- recommended model
- safety restrictions
- compaction format

## Phase 4: Safety, Reproducibility, and Reporting

### 12. Explicit Safety Posture

`pire` needs a clearer safety model than a generic coding harness:

- Separate benign local research from interaction with real external targets
- Require explicit user confirmation before network scanning or high-volume active probing
- Differentiate observation from exploitation from persistence
- Bias toward local samples, sanctioned labs, and offline reproduction

This should be enforced partly in prompting and partly with tool gating.

### 13. Research Notebook Export

Add export formats beyond plain session transcript:

- timeline of actions
- command log
- artifact manifest
- findings summary
- remediation/report draft

Ideal output formats:

- Markdown
- JSON for machine post-processing
- HTML report with expandable evidence

### 14. Repro Bundle Generation

For mature findings, generate a reproducible bundle:

- exact commands
- minimized input
- helper scripts
- environment notes
- expected outcome

That closes the loop between investigation and proof.

## Recommended Build Order

1. Prompt/profile layer: `pire` system prompt, templates, skills, and mode labels.
2. Tool wrappers: environment introspection, artifact-aware wrappers around common RE commands.
3. Research state: findings/hypothesis tracker plus artifact registry.
4. Research compaction: preserve artifacts, repro steps, and conclusions across long sessions.
5. Subagent roles and session presets.
6. Reporting/export/repro bundle features.

## Concrete First Milestone

The first milestone should be small enough to ship quickly but opinionated enough to change behavior:

- Add a `pire` profile with a research-first system prompt
- Add `recon` and `proofing` modes
- Ship 5-8 prompt templates for common RE/security tasks
- Ship 3-5 core skills
- Add an environment/tool-inventory command
- Add an artifact manifest file for session persistence

Current coding-agent progress:

- `pire` now ships a dedicated base prompt via `.pire/SYSTEM.md` instead of relying only on appended instructions.
- The `.pire/prompts` set now covers the full initial workflow list: binary, pcap, firmware, crash repro, build diffing, surface audit, runtime tracing, finding summaries, and report writing.
- The `.pire/skills` set now covers the full initial workflow list: binary triage, crash analysis, fuzzing setup, pcap analysis, firmware unpacking, web recon, malware sandbox notes, exploit repro, and write-up support.
- Extension tests cover default mode/tool gating and proofing-mode escalation.
- `pire` now persists an explicit safety posture with confirmation-backed active probing gates, notebook export commands, and repro bundle generation for mature findings.

If this milestone works, the harness will already feel different from Pi even before deeper runtime work lands.

## Non-Goals

At least initially, avoid:

- Building a full disassembler inside Pi
- Tightly coupling to a single commercial RE platform
- Auto-exploitation workflows by default
- Heavy automation that hides commands/evidence from the user

`pire` should be a strong research operator interface, not a black box.
