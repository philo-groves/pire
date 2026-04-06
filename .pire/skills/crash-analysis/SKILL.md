---
name: crash-analysis
description: Use when reproducing a crash, narrowing the trigger, or preserving debugging evidence such as signals, faulting offsets, and stack observations.
---
# Crash Analysis

Focus on reproducibility before root-cause claims.

Collect first:
- Exact command and environment used to trigger the crash
- Input corpus or payload involved
- Exit status, signal, stderr, and any crash signature
- Stack trace, register context, faulting address, and nearby disassembly when available

Prefer:
- Minimizing input and unstable variables
- Re-running with the same command line to confirm determinism
- Recording what changed between successful and failing runs

Keep notes on:
- Whether the crash is stable, flaky, or input-size dependent
- The smallest known reproducer
- Evidence supporting reachability and attacker control

Stop and ask for direction if:
- Reproduction would require unsafe interaction with a real external target
- The next step crosses from observation into exploit development
