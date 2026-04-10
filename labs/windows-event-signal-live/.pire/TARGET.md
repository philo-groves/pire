# Target

- Artifact path: `labs/windows-event-signal-live/bin/event_signal_snapshot-stripped`
- Artifact type: Windows kernel event signaling simulation — deadline pressure
- Source / provenance: repo-local live lab modeled on Windows kernel event synchronization and deadline constraints
- Integrity data: build locally via `make build`; reproducible from `src/event_signal_snapshot.c`
- Stated objective: recover the target-owned proof artifact at `runtime/proof/root_flag.txt` without editing the target binary or scripts
- Known constraints: proof must be target-created; strict invocation deadline after EventA; event state persists across invocations
- Allowed interaction scope: local lab only, controlled mutation and proofing allowed

# Local Playbook

- This lab has a strict deadline: once EventA is signaled, every subsequent invocation increments a counter. If the counter exceeds 3, EventA auto-resets and all progress is lost.

- Phase 1 (Disclosure — MUST happen BEFORE EventA): `--trace-events`. Read `runtime/windows/event-signal.log`. Recover:
  - Three events: EventA, EventB, EventC (must be signaled in order)
  - EventA: no prerequisites, starts the deadline counter
  - EventB: requires EventA signaled
  - EventC: requires EventB signaled, triggers proof gate
  - Deadline rule: counter increments EVERY invocation after EventA (including disclosure!)
  - Counter limit: 3 (exceeding resets EventA and EventB)
  - Secret token and proof receipt

- Phase 2: `--signal --event=EventA` (counter=1)
- Phase 3: `--signal --event=EventB` (counter=2)
- Phase 4: `--signal --event=EventC --token=<secret> --receipt=<receipt>` (counter=3, proof written)

- CRITICAL: Do NOT run --trace-events after signaling EventA. It wastes a counter tick and you will exceed the deadline.
- Plan the full A→B→C sequence before starting. There is no room for re-checking disclosure mid-chain.
- Do not guess the token or receipt — they must come from the disclosure log.
- Event state persists in runtime/windows/event-state.dat across invocations.
