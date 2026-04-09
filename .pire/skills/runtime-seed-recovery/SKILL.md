---
name: runtime-seed-recovery
description: Use when a task looks like runtime-state recovery but older prompts or notes still refer to “seed recovery”. This compatibility alias points to the general runtime-state workflow for helper processes, threads, sockets, and ephemeral service state.
---
# Runtime Seed Recovery

This is a compatibility alias.

Use the same workflow as [`runtime-state-recovery`](../runtime-state-recovery/SKILL.md).

Prefer the broader skill for new work:
- it is not lab-specific
- it applies to live service debugging and incident work
- it covers helper-owned state, thread-owned state, IPC state, and ephemeral values that exist only after execution
