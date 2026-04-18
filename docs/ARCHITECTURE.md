# PiRE v2 Architecture

## System Overview

```
+---------------------+       +---------------------+
|    Eval Harness     |       |    Human Operator    |
|  (pire-eval pkg)    |       |    (pimote / CLI)    |
+----------+----------+       +----------+----------+
           |                             |
           | target URL + description    | prompts / steering
           |                             |
           v                             v
+----------------------------------------------------------+
|                     PiRE Agent                            |
|                                                          |
|  +-------------+  +-----------+  +--------------------+  |
|  | Agent Loop  |  |  Prompt   |  |  Research Notebook  |  |
|  | (pi-mono)   |  |  Layer    |  |  (persistent state) |  |
|  +------+------+  +-----------+  +--------------------+  |
|         |                                                |
|  +------+----------------------------------------------+ |
|  |                    Tool Layer                        | |
|  |                                                     | |
|  |  +------+  +------+  +--------+  +------+  +-----+ | |
|  |  | bash |  | http |  | python |  | read |  | nb  | | |
|  |  +------+  +------+  +--------+  +------+  +-----+ | |
|  |  +------+  +------+  +--------+  +------+          | |
|  |  | write|  | edit |  |  grep  |  | find |          | |
|  |  +------+  +------+  +--------+  +------+          | |
|  +-----------------------------------------------------+ |
+----------------------------------------------------------+
           |
           | HTTP, shell commands, file I/O
           v
+---------------------+
|   Target System     |
|  (Docker container, |
|   local binary,     |
|   remote service)   |
+---------------------+
```

## Components

### 1. Agent Runtime (from pi-mono)

We use pi-mono's agent loop, tool execution framework, session management, and
provider system as-is. We do NOT fork the repo. We depend on it as a package
and extend through its public APIs.

What we use from pi-mono:
- Agent loop (`agent-loop.ts`): message streaming, tool call dispatch, continuation
- Tool framework: tool registration, execution, result handling
- Session management: JSONL persistence, compaction, branching
- Provider system: Anthropic, OpenAI, etc.
- CLI/TUI: interactive mode for real-target use
- Extension system: hooks for custom behavior
- Subagent support: for parallel decomposition when needed

What we do NOT use (or use minimally):
- Web UI, Slack bot, GPU pod management
- Package/extension marketplace
- Theme system

### 2. PiRE Extension (our code)

A pi-mono extension that registers custom tools, provides the system prompt,
and manages the research notebook. This is the entirety of PiRE-specific code.

```
pire/
  src/
    extension.ts        # pi-mono extension entry point
    tools/
      http.ts           # structured HTTP requests
      python.ts         # Python script execution
      notebook.ts       # research notebook
    prompt/
      system.ts         # system prompt builder
      task-context.ts   # task-local context loader
    notebook/
      store.ts          # notebook persistence
      inject.ts         # notebook context injection
  package.json          # depends on pi-mono
```

Estimated size: ~1,500 lines of TypeScript. Compare to v1's ~4,270-line
agent-session.ts alone.

### 3. Eval Harness (separate package)

A standalone CLI that runs benchmarks against any agent. Completely decoupled
from the PiRE agent — it doesn't import PiRE code, doesn't modify agent
behavior, doesn't know about PiRE internals.

```
pire-eval/
  src/
    cybergym/
      cli.ts            # main CLI entry
      tasks.ts          # task index loading and filtering
      fetch.ts          # task data download + Docker image management
      runner.ts         # task execution loop
      validate.ts       # vulnerable/fixed image validation
      history.ts        # markdown run history writer
  package.json          # standalone, no PiRE dependency
```

Interface between eval harness and agent:
- Harness spawns agent as a subprocess (any agent that accepts a prompt)
- Harness passes: source workspace, vulnerability description, and output path
- Harness optionally exposes validation and debug backends as external tools
- Harness records: PoC produced (y/n), vulnerable crash, fixed survival,
  timing, and trajectory metrics

### 4. Research Notebook

A file-backed key-value store exposed as a tool. The agent reads and writes
structured research state that persists across compaction boundaries.

Design principles:
- Simple API: `write(key, value)`, `read(key?)`, `append(key, value)`, `list()`
- File-backed: writes to `{workspace}/.pire/notebook.json`
- Injected into context: before each LLM call, current notebook state is
  appended as a system message
- Not opinionated: the agent decides what to store (hypotheses, tokens,
  findings, chain state); the tool doesn't enforce structure

Why a tool and not a convention:
- The agent can't forget to read it (it's injected automatically)
- It survives compaction (it's on disk, not in conversation)
- It's visible in tool call logs (auditable)
- It's cheap (one small JSON read per turn, not re-parsing conversation history)

### 5. Pimote (human-in-the-loop)

Carried forward from v1 with minimal changes. Pimote provides:
- Real-time observation of agent sessions from mobile
- Steering/interruption during live research
- Session switching across concurrent runs

No architectural changes needed — pimote already treats the agent as opaque
and communicates via RPC.

## Data Flow: Eval Run

```
1. Eval CLI reads CyberGym task definitions

2. For each task:
   a. Fetch task artifacts and pull vulnerable/fixed images
   b. Prepare task workspace and session directories
   c. Spawn PiRE agent:
      pire -p "Project: ...
              Source code: ...
              Dataset vulnerability description: ...
              Write the PoC to ..."
   d. Agent writes a PoC candidate and can call validation/debug tools
   e. Harness validates the PoC against vulnerable and fixed images
   f. Record result: {task, passed, vul_crashed, fix_survived, time, trajectory}

3. Aggregate and report results
```

## Data Flow: Real-Target Use

```
1. User starts PiRE in interactive mode:
   pire

2. User provides target description:
   "Audit this web application at http://target.local:8080
    for authentication and authorization vulnerabilities."

3. Agent runs research loop:
   - Recon with http tool
   - Record hypotheses in notebook
   - Test with targeted probes
   - Record findings
   - Attempt exploitation when confident

4. User can steer via CLI or pimote at any point

5. Agent produces findings in notebook
   (accessible at .pire/notebook.json)
```

## Dependency Graph

```
pi-mono (upstream, unmodified)
  ^
  |  depends on
  |
pire (extension package)
  - Registers tools: http, python, notebook
  - Provides system prompt
  - Manages notebook injection

pire-eval (standalone package)
  - No dependency on pire
  - Spawns agent as subprocess
  - Manages Docker lifecycle
  - Scores results
```

## Key Design Constraint: No Eval-Specific Code Paths

The PiRE agent MUST NOT contain any code that checks whether it's running in
eval mode. There is no "eval mode." The agent receives a prompt and tools and
produces output. The eval harness is a user of the agent, not a component of it.

This means:
- No `PIRE_TOOL_WORKSPACE_ROOT_ENV` (v1's workspace sandboxing)
- No `PIRE_TOOL_FORBIDDEN_PATHS_ENV` (v1's answer-key hiding)
- No `PIRE_TOOL_BASH_BLOCKED_COMMANDS_ENV` (v1's tool blocking)
- No runtime-first prompt prefix injection
- No phase timeouts managed by the harness

If the agent needs to avoid shortcuts, that discipline comes from the agent
itself (prompt + tools), not from external constraints.
