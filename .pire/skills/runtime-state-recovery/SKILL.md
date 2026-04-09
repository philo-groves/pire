---
name: runtime-state-recovery
description: Use when decisive information or the final action depends on live process state rather than static files alone. Applies to helper daemons, worker threads, sockets, pipes, staged outputs, ephemeral credentials, service-owned state, or any task where static reversing should give way to observing the running target.
---
# Runtime State Recovery

Use this workflow when the next missing fact is most likely in a running process, a live IPC surface, or state that exists only after execution.

This skill is not limited to labs. Use it for live debugging, incident response, service triage, exploit development, reverse engineering, or local reproduction whenever static files are no longer the best source of truth.

## Typical triggers

- a `debug`, `trace`, `verbose`, or similar mode launches a helper or background worker
- the target writes a PID file, opens a socket, creates a pipe, or leaves shared-memory state
- the missing value is disclosed only after a live run
- the critical value is never written to disk in stable form
- the target mutates or burns state after wrong inputs, making guesses destructive
- the final action depends on thread-local, stack-local, heap-local, or service-owned state
- logs, receipts, nonces, tokens, or challenge values appear only after execution

## Goal

Recover the missing live state or observe the live effect with the least destructive path.

## Phase 1: Prove this is a runtime-state problem

Collect and record:
- active PID or PIDs
- socket, pipe, shared-memory, or runtime-file paths
- freshly disclosed values such as nonce, token, receipt, challenge, request id, or session id
- whether wrong attempts rotate, burn, or invalidate state
- which exact field or effect is still missing

State the gap explicitly:
- what value, action, or side effect is still unknown
- why it likely lives in runtime state
- which live surface is most likely to reveal it

If you cannot yet name the live surface, do one cheap observation step:
- `ps`
- `lsof`
- targeted log review
- list the runtime directory
- inspect open sockets or PID files

## Phase 2: Choose the cheapest live vantage point

Prefer these in order:

1. Runtime metadata already exposed
- PID files
- runtime logs
- receipts, nonce files, challenge files
- socket paths
- recently created runtime artifacts

2. IPC observation
- inspect a UNIX socket, named pipe, or loopback listener
- capture one benign transaction before sending a privileged or destructive one
- prefer protocol observation before mutation

3. Process inspection
- inspect the helper or worker that owns the state, not just the launcher
- use debugger, tracer, process handles, thread inspection, or a narrow local helper
- target the computation or validation boundary, not generic startup

4. Memory observation
- read only the region or field you actually need once the address or object is known
- prefer narrow targeted reads over broad dumping

## Phase 3: Keep the trajectory live-state oriented

After disclosure or runtime setup:
- do not widen back into broad repo inventory unless a specific ambiguity requires it
- do not reopen source snapshots or answer-key style files just because static analysis feels safer
- do not restart while the current live process still provides observability
- do not turn one missing runtime value into a full static RE project unless that is the only path left

Static reversing is still useful here, but only to answer a live question:
- which process owns the state
- which struct, frame, or protocol field matters
- which function computes the missing value
- where to break, trace, or probe next

## Phase 4: Match the runtime pattern

For daemon-backed targets:
- identify the long-lived struct or protocol state owned by the service
- capture the live fields that are not persisted
- inspect the daemon, not only the client wrapper

For stack-backed targets:
- focus on the active validation frame or near-return computation
- capture the stack-local value once
- avoid retries that destroy the frame you are trying to study

For thread-backed targets:
- identify which thread updates which state
- do not assume the main thread mirrors worker state
- inspect after the worker runs and before the final check consumes the value

For service or incident-response targets:
- treat the live service as the source of truth
- prefer runtime-safe observation first
- if the system is real or sensitive, avoid destabilizing guesses and record risk before attaching debuggers or tracers

## Phase 5: Avoid destructive guesses

Before any one-shot or stateful action, answer all of these:
- what exact live value, condition, or state transition did I recover
- where did it come from: PID, thread, socket, struct, register, frame, or runtime artifact
- how does it map to the final request, proof, or validation step
- why is this a justified attempt rather than a guess

If you cannot answer those, you are not ready for the final action.

## Phase 6: Execute one clean action

Once the live state is understood:
- compute or assemble the final input locally
- submit one deliberate action
- capture the resulting artifact or side effect immediately

If the attempt fails and the target rotates state:
- discard the old model
- refresh the live-state ledger from the new runtime

## Anti-patterns

Do not:
- default to repo-wide inventory after the target already disclosed the live surface
- keep searching for source files when the running process is the relevant source of truth
- inspect only the launcher when the helper or worker owns the real state
- brute-force a stateful or rotating validation path
- assume a logged token or receipt fully captures the hidden runtime state
- keep using a preferred tool after the environment proved it unavailable
- treat a blocked `/proc` or debugger path as a reason to abandon runtime observation entirely

## Tool-selection notes

Use the tools the environment actually supports.

If a preferred tool is unavailable:
- pivot immediately to another live-observation path
- prefer a small local helper over repeated failed shell probes
- if shell auditing blocks literal external-path references, generate or compile the helper inside the workspace and let the helper access the live OS surface

The objective is not “use procfs” or “use gdb.” The objective is: observe the running state with the least risky technique the environment allows.
