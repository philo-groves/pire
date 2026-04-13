---
name: parallel-work
description: Use when multiple independent tasks exist or when recon requires reading from multiple distinct sources. Provides patterns for parallel tool calls — the primary concurrency mechanism available.
---
# Parallel Work

Use this skill to avoid wasting time on sequential operations that could run concurrently.

## The mechanism: parallel tool calls

You can issue multiple tool calls in a single response message. The system executes them concurrently and returns all results together. This is your **only** concurrency mechanism — use it aggressively.

## When to parallelize

Recognize these signals:
- You need to read from 2+ distinct files, directories, or prior workspaces
- You need to grep/search across multiple paths or patterns
- You have 2+ independent bash commands to run
- A brief lists tasks that don't depend on each other
- You're about to issue a single read when you could batch it with 2-3 other reads you'll need soon

## Pattern 1: Batched reads

**When:** You need content from multiple files.

WRONG (sequential, wastes turns):
```
[message 1] Read ~/security-research/domains/kernel/network-controls/FINDINGS.md
[message 2] Read ~/bug-bounty/STATUS.md
[message 3] Read ~/bounty/PLANNING.md
```

RIGHT (parallel, single turn):
```
[one message with all three:]
Read ~/security-research/domains/kernel/network-controls/FINDINGS.md
Read ~/bug-bounty/STATUS.md
Read ~/bounty/PLANNING.md
```

## Pattern 2: Batched searches

**When:** You need to search across multiple directories or for multiple patterns.

RIGHT:
```
[one message:]
Bash: grep -rn "IOSurface" ~/xnu-src/iokit/ | head -30
Bash: grep -rn "IOSurface" ~/xnu-src/bsd/ | head -30
Bash: strings /System/Library/Frameworks/IOSurface.framework/IOSurface | grep -i create
Bash: nm -g /System/Library/PrivateFrameworks/SkyLight.framework/SkyLight | grep -i surface
```

## Pattern 3: Long command + productive reads

**When:** A bash command takes time (compile, VM boot, scp) and you have useful reads to do.

RIGHT:
```
[one message:]
Bash: cd ~/research/domains/kernel/iogpu/poc && clang -Wall -O0 -g -fobjc-arc -framework Metal -framework IOSurface -o probe probe.m
Read: ~/xnu-src/iokit/IOSurface/IOSurface.h
Read: ~/bug-bounty/domains/kernel/targets/iogpu/analysis/G1-ESCALATION-PLAN.md
```

The compile runs while the reads return. By the time you see all results, the compile is likely done too.

## Pattern 4: Shell background for very long commands

**When:** A command will definitely take 30+ seconds (VM boot, heavy analysis).

Use `&` in the bash command and batch it with other work:
```
[one message:]
Bash: su - philogroves -c 'tart run testing-vm &' && sleep 2 && echo "VM starting"
Read: ~/research/domains/kernel/iogpu/analysis/G1-IOSurface-WindowServer-boundary-proof-2026-04-13.md
Bash: grep -rn "CAWindowServer" ~/xnu-src/ | head -20
```

Then in a later message, check if the VM is ready:
```
Bash: ssh -o ConnectTimeout=5 testing-vm 'sw_vers' 2>&1 || echo "not ready yet"
```

## Pattern 5: Session brief decomposition

When a session brief lists tasks, decompose before executing:

```
Brief says: (1) Read prior G1 corpus, (2) Check WindowServer symbols, (3) Build PoC, (4) Run PoC
Dependency graph:
  - (1) and (2): independent → batch in one message
  - (3): depends on (1) → sequential after (1)
  - (4): depends on (3) → sequential after (3)

Plan: batch (1)+(2), then (3), then (4)
```

## Pattern 6: Subagents (spawn_agent)

**When:** An independent multi-step task can run in the background while you work on something else.

Correct pattern:
```
1. spawn_agent with task="Read X, Y, Z and return a summary" and maxTurns=12
2. Continue your own work (reads, writes, tool calls) — DO NOT call wait_agent yet
3. When you are DONE with your own work and need the result:
   wait_agent with agentId=<id> and NO timeoutMs
```

CRITICAL: Do NOT poll with `wait_agent(timeoutMs=1)` or `wait_agent(timeoutMs=2000)`. This wastes turns and always returns "still running". Instead, do your own productive work first, then call `wait_agent` without a timeout — it will block until the subagent is finished and return the complete report.

maxTurns guide:
- 8 turns: simple read-and-summarize tasks
- 12 turns: multi-file reads with analysis
- 15-20 turns: tasks that involve writing files, creating directories, packaging

## Anti-patterns

- Issuing a single `Read` when you know you'll need 3 more files in the next 2 turns — batch them
- Running `grep` on one directory, waiting, then running `grep` on another directory — batch them
- Reading a file to decide what to compile, then compiling, when you could read + start compiling together
- Issuing `bash: ls` alone when you could pair it with other commands
- **Polling wait_agent with short timeouts** — NEVER do this. Do your own work, then wait without a timeout.
- **Spawning a subagent and immediately waiting** — defeats the purpose. Do work between spawn and wait.

## Trigger phrases in briefs

If a session brief says any of these, apply this skill:
- "parallelizable"
- "launch these as parallel"
- "independent tasks"
- "while X runs, do Y"
- "batch"
- "subagent"
- "spawn_agent"
