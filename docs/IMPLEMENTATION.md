# PiRE v2 Implementation Plan

## Build Order

Work is organized in phases. Each phase has a concrete deliverable and a
validation step. Later phases depend on earlier ones.

## Phase 0: Scaffolding (day 1)

**Goal**: Fresh repo with pi-mono as a dependency, PiRE extension skeleton,
and one tool working end-to-end.

### Steps

1. Fork https://github.com/badlogic/pi-mono fresh
2. Create `pire/` directory (the extension package):
   ```
   pire/
     package.json        # depends on pi-mono packages
     tsconfig.json
     src/
       extension.ts      # pi-mono extension entry point
       tools/            # empty, will hold custom tools
       prompt/           # empty, will hold system prompt
       notebook/         # empty, will hold notebook logic
   ```
3. Create `pire-eval/` directory (the eval harness):
   ```
   pire-eval/
     package.json        # standalone, no pire dependency
     tsconfig.json
     src/
       cli.ts
       runner.ts
       docker.ts
       scoring.ts
   ```
4. Register the extension with pi-mono so `pire` CLI loads it
5. Add the `notebook_write` / `notebook_read` tools as a proof of concept
6. Verify: `pire -p "Write 'hello' to the notebook, then read it back"` works

### Validation

- [ ] `pire` CLI starts and loads the extension
- [ ] Notebook tool writes to `.pire/notebook.json`
- [ ] Notebook tool reads back what was written
- [ ] Session JSONL records notebook tool calls

## Phase 1: Core Tools (days 2-3)

**Goal**: All custom tools working, system prompt in place, agent can do basic
web security work.

### Steps

1. Implement `http` tool:
   - Node.js fetch-based HTTP client
   - Structured response format (status, headers, body)
   - Truncation for large responses
   - Redirect following
   - Timeout handling

2. Implement `python` tool:
   - Spawn `python3` subprocess
   - Capture stdout/stderr
   - Timeout/kill
   - Pre-install security libraries (requirements.txt in workspace)

3. Complete notebook tools:
   - `notebook_write`, `notebook_read`, `notebook_append`, `notebook_delete`
   - File persistence to `.pire/notebook.json`
   - Context injection: hook pi-mono's before-agent-start event to inject
     notebook state as system message

4. Set system prompt:
   - The ~20 lines from PROMPTS.md
   - Tool descriptions auto-generated from Zod schemas
   - No skills, no context files, no eager loading

### Validation

- [ ] `http` tool: `pire -p "Make a GET request to http://httpbin.org/get"`
- [ ] `python` tool: `pire -p "Run a Python script that prints 'hello'"`
- [ ] Notebook injection: agent sees `[Research Notebook]` in every turn
- [ ] System prompt is under 600 tokens (measure with tokenizer)
- [ ] Manual test: point agent at a local vulnerable app, observe trajectory

## Phase 2: Eval Harness — CyberGym (days 4-6)

**Goal**: Run CyberGym tasks automatically, produce scored results, and record
run history.

### Steps

1. Implement task index loading:
   - Load CyberGym task metadata
   - Index by task ID, task type, project, and difficulty
   - Support shuffled and reproducible selection

2. Implement task fetch and Docker lifecycle:
   - Download source and auxiliary task artifacts lazily
   - Pull vulnerable and fixed images on demand
   - Keep disk usage bounded with cleanup after each run

3. Implement agent spawner:
   - Spawn `pire -p "{prompt}"` as subprocess
   - Stream stdout/stderr
   - Timeout with SIGTERM → SIGKILL escalation
   - Capture full output

4. Implement PoC validation:
   - Validate candidate artifact against vulnerable and fixed images
   - Record `pocFound`, `vulCrashed`, `fixSurvived`, `passed`
   - Expose validator/debug adapters to the agent through generic tool specs

5. Implement scoring and reporting:
   - Per-task results (pass/fail, time, trajectory)
   - Aggregate by difficulty, task type, and project
   - JSON output format
   - Markdown run history format

6. Implement CLI:
   - `--task <id>` (single)
   - `--task-type <type>`, `--project <name>`, `--difficulty <level>`
   - `--limit <n>`, `--shuffle`, `--seed <n>`
   - `--timeout <seconds>`
   - `--json`, `--save <path>`, `--history-file <path>`

### Validation

- [ ] Load the CyberGym task index without error
- [ ] Download one task and validate one candidate artifact end-to-end
- [ ] Run agent against one task and record the result
- [ ] A multi-task run completes without crashing (pass rate doesn't matter yet)
- [ ] JSON output matches schema from EVAL.md
- [ ] `docs/CYBERGYM_RUNS.md` is updated automatically

## Phase 3: Baseline and Iteration (days 7-14)

**Goal**: Establish baseline pass rate, identify weak categories, iterate on
agent capability until target pass rate is reached.

### Steps

1. Run baseline CyberGym slices, record baseline:
   - Overall pass rate
   - Pass rate by level
   - Pass rate by project family
   - Save JSON snapshots and append markdown history

2. Analyze failures by category:
   - Which difficulty bands and project families have lowest pass rate?
   - For each failed task: what did the agent do? Where did it get stuck?
   - Classify failures: tool limitation, prompt issue, model limitation,
     timeout, Docker issue

3. Iterate on weak categories (priority order):
   a. **Target anchoring failures**
      - Wrong-path drift, unrelated crashes, or bad reachability assumptions
   b. **Artifact acceptance failures**
      - Candidate structure is wrong even when the path is right
   c. **Runtime-state blockers**
      - Validation shows the right path but success depends on live state
   d. **Logic/spec reasoning failures**
      - Intended-vs-implemented mismatches are not modeled explicitly
   e. **Live-target recon gaps**
      - Auth/session/upload/browser/IPC priors are underused

4. For each iteration:
   - Identify specific failure in trajectory
   - Make ONE change (tool fix, prompt tweak, or harness fix)
   - Re-run affected tasks
   - Re-run representative slices for regression check
   - Record results

5. Stabilize with improving pass rate and lower variance on repeated slices

### Validation

- [ ] Baseline recorded
- [ ] At least 3 iteration cycles completed
- [ ] Pass rate trending upward
- [ ] No single change causes > 2 benchmark regressions
- [ ] System prompt has not grown beyond 600 tokens

## Phase 4: Custom Labs (days 15-20)

**Goal**: Port high-value v1 labs to v2 format, run them through the eval
harness, establish baseline.

### Steps

1. Design custom lab format (`lab.json`):
   - Compatible with eval harness interface
   - Supports Docker and non-Docker targets
   - No hidden files, no tool blocking, no phase management

2. Port 10-15 highest-value v1 labs:
   - Priority: labs that test capabilities CyberGym doesn't cover well
   - Binary RE: `vm-bytecode-live`, `reloc-record-live`
   - Runtime state: `daemon-seed-live`, `stack-seed-live`
   - Multi-stage: `opensmtpd-rce-live`, `sudo-baron-samedit-live`
   - Redesign each to be solvable without harness scaffolding

3. Add custom lab support to eval harness:
   - `pire-eval --labs <dir>` flag
   - Same runner logic, different metadata parser

4. Run ported labs, establish baseline

5. If binary RE labs need it, implement `disassemble` and `binary_info` tools

### Validation

- [ ] 10+ labs ported to v2 format
- [ ] Each lab buildable and runnable via eval harness
- [ ] Benign path produces no flag (fail-closed)
- [ ] At least one lab passes (agent captures flag)
- [ ] Baseline recorded for custom labs

## Phase 5: Pimote Integration (days 21-23)

**Goal**: Human-in-the-loop oversight works with v2 agent.

### Steps

1. Verify pimote works with pi-mono's extension system
2. Test: start `pire`, connect via pimote iOS app, observe agent session
3. Test: steer agent mid-session via pimote
4. Test: run eval task, observe via pimote simultaneously

### Validation

- [ ] Pimote connects to v2 agent session
- [ ] Message streaming works
- [ ] Steering/follow-up works
- [ ] Notebook state visible in session messages

## Phase 6: Polish and CI (days 24-28)

**Goal**: Reliable, automated eval pipeline. Ready for daily use.

### Steps

1. CI pipeline:
   - Build PiRE extension
   - Run CyberGym slices (subset for speed, larger scheduled runs separately)
   - Regression check against baseline
   - Report results

2. Documentation:
   - README for the new repo
   - Quick start guide
   - Contributing guide for adding labs

3. Trajectory analysis tooling:
   - Script to extract secondary metrics from session logs
   - Notebook completeness score
   - Time-to-first-useful-action measurement

4. Performance optimization:
   - Parallel benchmark execution (multiple Docker containers)
   - Result caching for unchanged benchmarks

### Validation

- [ ] CI runs on push
- [ ] Full suite completes in < 2 hours
- [ ] Regression baseline is maintained
- [ ] New contributor can run one benchmark from README instructions

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| pi-mono extension API doesn't support our needs | High | Investigate API surface in Phase 0 before committing. Fall back to minimal fork if needed. |
| CyberGym Docker/image pulls are flaky | Medium | Cache images locally. Retry on Docker errors. |
| Model can't reach 85% regardless of tooling | High | Analyze failure modes. Consider model-specific prompt variants. Adjust target if fundamentally blocked. |
| Notebook injection inflates context too much | Low | Cap notebook size. Summarize old entries. |
| Custom labs need capabilities not in tool set | Medium | Add tools as needed in Phase 4. Binary RE tools are the most likely addition. |
| Pimote doesn't work with extension-based approach | Low | Pimote talks RPC to pi-mono, not to our extension. Should work by default. |

## Decision Log

Record major decisions here as they're made during implementation.

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-16 | Use CyberGym as primary automated eval | Matches proof construction, source-led reasoning, and vulnerable/fixed validation |
| 2026-04-16 | Separate eval harness from agent | v1 lesson: eval compensating for agent weakness creates eval-shaped agents |
| 2026-04-16 | Notebook as primary state management | v1 lesson: conversation history is not a state store |
| 2026-04-16 | 20-line system prompt cap | v1 lesson: prompt inflation crowds out working memory |
| 2026-04-16 | Extension-based, not fork-based | v1 lesson: fork creates maintenance burden |
