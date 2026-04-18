# Lessons Learned from PiRE v1

This documents what we learned from the first iteration. These lessons should
directly inform v2 design decisions. Each lesson includes what we observed, why
it happened, and what to do differently.

## 1. Prompt engineering cannot substitute for architecture

**Observed**: After extensive prompt tuning (SYSTEM.md grew to 92 lines,
APPEND_SYSTEM.md to 36, plus 26 skill files), the agent still produced zero
validated proofs on live labs over hours of runtime.

**Why**: Instructions compete for attention in the context window. The more
guidance you add, the less the model follows any single piece. "Answer these
three gate questions" and "be concise" and "maintain a sweep ledger" and "keep
a running list of facts" cannot all be followed simultaneously under time
pressure. The model picks whichever instruction feels most salient in the
moment.

**v2 principle**: Enforce important behaviors in code (tool design, phase
management). Use prompts only for posture and priorities that genuinely require
LLM judgment.

## 2. Tool poverty forces expensive workarounds

**Observed**: The agent routinely wrote 30-50 line Python helpers or C programs
to do things that should be single tool calls: connecting to a socket, reading
a binary file, making a structured HTTP request, parsing an ELF header.

**Why**: The only tools were read/write/edit/bash/grep/find/ls — a software
engineer's toolkit. Every security operation went through bash as an
unstructured text pipe. Each helper script cost 3-5 tool calls (write file,
chmod, run, read output, debug errors) for what should be one call.

**v2 principle**: Add tools for the work the agent actually does. Structured
HTTP requests, Python execution with libraries pre-installed, and binary file
reading eliminate the most common workarounds. Each tool should return
structured data, not raw text.

## 3. Conversation history is not a state store

**Observed**: The agent frequently re-read files, re-derived values, and lost
track of intermediate results (tokens, receipts, offsets) across long sessions.
When compaction occurred, earlier tool outputs were summarized away and critical
values were lost.

**Why**: The only "memory" was the conversation window. No external state store.
The exploitability gate, sweep ledger, and live-state ledger from the prompt
were conventions the agent was supposed to maintain in its own output — but
that output gets compacted.

**v2 principle**: Provide a research notebook tool that persists to disk. The
agent writes findings, intermediate values, and chain state to the notebook.
The notebook contents are re-injected into context after compaction. Critical
state survives regardless of conversation length.

## 4. The eval harness was doing the agent's job

**Observed**: The live-lab harness hid answer keys, blocked tools in phase 2,
injected runtime ledgers, and used timeout-based phase transitions. The agent
succeeded only when the harness pre-structured its workflow.

**Why**: Each time the agent failed a lab, we added a harness-side
compensation: hide the README so the agent can't shortcut, block objdump so it
doesn't waste time on static analysis, inject the ledger so it doesn't lose
state. This meant the agent worked in the harness but would fail on any real
target without those crutches.

**v2 principle**: The eval harness provides a target and checks for a flag.
Nothing else. No file hiding, no tool blocking, no state injection. If the
agent needs scaffolding, that scaffolding must be part of the agent itself, not
the eval.

## 5. Lab-specific prompt tuning creates eval-shaped agents

**Observed**: The SYSTEM.md accumulated references to lab artifacts:
`session.ini`, `runtime/` directories, `TARGET.md`, disclosure markers, proof
receipts, `scratch/` directories. The `RUNTIME_FIRST_PROMPT_PREFIX` was a
17-line step-by-step walkthrough for 3 specific labs.

**Why**: Each failed lab run led to a prompt patch targeting that specific
failure mode. Over time, the "general methodology" became a collection of
lab-specific workarounds masquerading as principles.

**v2 principle**: The global prompt knows nothing about labs. Lab-specific
guidance goes in the challenge description provided by the eval harness.
General methodology is limited to principles that apply to all targets.

## 6. "Reason before acting" fights the model's strengths

**Observed**: The prompt told the agent to answer three exploitability gate
questions before each action, reason extensively about each candidate,
distinguish facts from inferences in plain text, and avoid writing code until
analysis was complete. The agent produced long analytical essays that burned
context without advancing the investigation. "Over-analysis before proof" was
a recognized failure mode.

**Why**: LLMs are better at rapid hypothesis-test cycles (generate probe, run
it, interpret result) than sustained multi-step reasoning without external
anchoring. The prompt was optimizing for a human researcher's workflow, not an
LLM's strengths.

**v2 principle**: Channel the model's strengths. Let it act quickly and
iterate. Use the notebook tool for anchoring: record what you learned, check
what you already know. Replace "think for 3 paragraphs before each action"
with "run the cheapest test, record the result."

## 7. Massive system prompt crowds out working memory

**Observed**: Between SYSTEM.md, APPEND_SYSTEM.md, all loaded skills, tool
descriptions, and context files, the system prompt consumed an estimated
10-20K tokens. On a 5-minute lab run with 15-25 turns, this left limited room
for tool outputs (binary disassembly, log files) and reasoning.

**Why**: Each new skill, guideline, or anti-pattern made the system prompt
larger. No pruning mechanism existed. Skills were loaded eagerly based on file
presence, not relevance to the current task.

**v2 principle**: System prompt budget is ~1K tokens. Skills load on demand.
Context is a scarce resource — every token of system prompt competes with tool
output and reasoning.

## 8. The fork created a maintenance and complexity burden

**Observed**: The codebase contained 141 TypeScript files in coding-agent, 62
in agent core, 8 packages, 15+ LLM provider implementations, a TUI, a web
UI, a Slack bot, GPU pod management, and a full extension system. Most of this
was irrelevant to security research.

**Why**: Forking pi-mono gave us a working agent immediately but also gave us
everything else in the monorepo. Customizations were interleaved with upstream
code, making it hard to pull upstream improvements or understand what we had
changed.

**v2 principle**: Depend on pi-mono as an upstream package. Customize through
its extension and tool APIs. Keep PiRE-specific code in a separate, small
codebase. When pi-mono improves, we get the improvements without merge
conflicts.

## 9. Sequential single-agent execution is a bottleneck

**Observed**: The agent operated as one sequential actor. On complex challenges,
it spent turns on filesystem inventory that could have run in parallel with
initial probes. On multi-stage challenges, it couldn't monitor a process while
interacting with it.

**Why**: The live-lab harness spawned a single agent in print mode. The
subagent mechanism existed in pi-mono but wasn't used by the eval harness.
The parallel-work skill only described "multiple tool calls in one response."

**v2 principle**: Parallel tool calls are the baseline. For complex tasks,
subagent decomposition should be available but not forced. The agent decides
when to parallelize, not the framework.

## 10. Binary scoring reveals nothing about trajectory quality

**Observed**: Lab results were labeled as "validated-proof," "proof-missing,"
"no-signal," etc. A "proof-missing" run that got 90% of the way there was
scored identically to a run that did nothing useful.

**Why**: The eval system checked for flag presence, not trajectory quality.
There was no partial credit, no "good trajectory but missed proof" category,
no metric for how close the agent got or how efficiently it worked.

**v2 principle**: Binary benchmark pass/fail is the primary metric. But
supplement it with trajectory metrics: time-to-first-useful-action,
number of wasted turns, hypothesis quality, notebook completeness. These
secondary metrics guide prompt and tool improvements even when flag capture
rate plateaus.
