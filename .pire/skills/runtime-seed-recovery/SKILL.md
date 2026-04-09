---
name: runtime-seed-recovery
description: Use when a target launches a helper process or live threads and the decisive proof value appears to be generated at runtime rather than persisted to disk. Guides the shift from static reversing to debugger, procfs, and IPC inspection.
---
# Runtime Seed Recovery

Use this workflow when a target reveals that the missing proof value lives in a running process.

Typical triggers:
- `debug` or a similar mode launches a helper daemon or background process
- the target writes a PID file, creates a UNIX socket, or leaves a live IPC endpoint
- the proof formula references a value that is never written to disk
- wrong proof attempts rotate or burn state, making guessed commits destructive
- the target uses threads or helper processes to derive the final response

This is not a static-reversing skill. The point is to switch early to observing the live state.

## Goal

Recover the runtime-only value needed for proof without burning the live state on guesses.

## Phase 1: Confirm that the missing state is live

Collect and record:
- helper PID or PIDs
- socket, pipe, shared-memory, or procfs path
- disclosed token
- disclosed receipt
- disclosed challenge
- whether bad commits rotate or burn state

State the current gap explicitly:
- what response field is still unknown
- why the target likely derives it from live state
- which live surface is most likely to reveal it

If you cannot name the live surface, do one cheap observation step first:
- `ps`, `ls /proc/$PID`, `lsof`, socket inspection, or log review

## Phase 2: Choose the cheapest live vantage point

Prefer these in order:

1. Procfs or on-disk runtime metadata
- `cat /proc/$PID/maps`
- `/proc/$PID/fd`
- `/proc/$PID/root`
- socket paths, pid files, or receipts already written by the target

2. IPC observation
- inspect the UNIX socket protocol
- trace `connect`, `send`, `recv`, `read`, or `write`
- capture one benign transaction before attempting proof

3. Debugger or tracer inspection
- attach to the helper, not just the launcher
- break near the response-computation or validation path
- inspect the struct, stack frame, registers, or thread-local state holding the missing value

4. Memory inspection
- read the relevant process memory once the address or region is known
- prefer narrow targeted reads over broad dumping

Do not reopen source snapshots or broad repo context once the runtime surface is already known. The next action should reduce uncertainty about the live value.

## Phase 3: Recover the live value

For daemon-backed targets:
- identify the long-lived struct holding token, receipt, challenge, and hidden seed
- look for one field that is not persisted to disk
- recover that field with the smallest reliable observation

For stack-backed targets:
- inspect the active stack frame around the validation or response-computation path
- prefer breakpoints immediately before the expected-response comparison
- capture the stack-local seed once, then compute the response offline

For thread-backed targets:
- identify which thread owns which part of the state
- do not assume the main thread holds everything
- inspect thread-local or worker-updated fields after the worker runs and before commit validation

## Phase 4: Avoid destructive proof attempts

Before any commit, answer all of these:
- What exact runtime value did I recover?
- From which PID, thread, stack frame, register, or struct field did it come?
- How does that value combine with the disclosed token, receipt, or challenge?
- Why should this be a one-shot proof rather than a guess?

If you cannot answer those, you are not ready to commit.

## Phase 5: Execute one clean proof

Once the runtime value is recovered:
- compute the response locally
- submit one proof attempt with the disclosed token and receipt
- capture the proof artifact immediately

If the attempt fails and the target rotates state:
- do not reuse the old challenge model
- re-establish the live-state ledger from the fresh runtime

## Anti-patterns

Do not:
- keep reading source after the target has already told you where the live surface is
- brute-force the commit path on a state-rotating target
- inspect only the launcher when the helper daemon owns the real state
- assume thread state is mirrored into a file or socket just because the target logs token and receipt
- restart reflexively when the current live process is still providing observability
