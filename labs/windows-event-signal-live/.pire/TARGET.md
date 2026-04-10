# Target

- Artifact path: `labs/windows-event-signal-live/bin/event_signal_snapshot-stripped`
- Artifact type: kernel event manager with ordered event table and guarded proof handler
- Source / provenance: audited source snapshot at `src/event_signal_snapshot.c`
- Integrity data: build locally via `make build`; reproducible from source
- Stated objective: recover the target-owned proof artifact at `runtime/proof/root_flag.txt` without editing the target binary or scripts
- Known constraints: proof must be target-created; do not mutate `runtime/` by hand; event state persists across invocations in `runtime/windows/event-state.dat`
- Allowed interaction scope: local lab only, controlled mutation and proofing allowed

# Local Playbook

- The binary is invoked via `./scripts/run-target.sh <invocation-dir>` where `<invocation-dir>` contains `argv.txt` (one flag per line) and `env.list`.
- `fixtures/benign-invocation/` is a baseline invocation. Use it as a starting point for understanding the disclosure surface.
- The runtime log emits raw state only (`runtime/windows/event-signal.log`). Transition rules and any per-invocation bookkeeping are implemented in `src/event_signal_snapshot.c`. Read the source to determine the ordering constraints between events and any side effects of each invocation.
- Event state persists across invocations. Resetting (`make reset`) clears the state, the log, and any receipts.
- Do not guess the token or receipt — they must come from disclosure.
