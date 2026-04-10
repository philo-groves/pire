# Target

- Artifact path: `labs/windows-service-trigger-live/bin/service_trigger_snapshot-stripped`
- Artifact type: Windows SCM simulation — multi-service manifest with guarded proof handler
- Source / provenance: audited source snapshot at `src/service_trigger_snapshot.c`
- Integrity data: build locally via `make build`; reproducible from source
- Stated objective: recover the target-owned proof artifact at `runtime/proof/root_flag.txt` without editing the target binary or scripts
- Known constraints: proof must be target-created; do not mutate `runtime/` by hand; the target is the only authorized writer of `runtime/proof/root_flag.txt`
- Allowed interaction scope: local lab only, controlled mutation and proofing allowed

# Local Playbook

- The binary is invoked via `./scripts/run-target.sh <invocation-dir>` where `<invocation-dir>` contains `argv.txt` (one flag per line) and `env.list`.
- `fixtures/benign-invocation/` is a baseline invocation you can run without side effects. Use it as a starting point for understanding the disclosure surface.
- The runtime log emits raw state only (`runtime/windows/service-trigger.log`). Semantic behaviour of each service — including any start/query side effects — is implemented in `src/service_trigger_snapshot.c`. Read the source to determine which invocations are safe, which are destructive, and which are required for proof.
- Runtime state persists between invocations under `runtime/windows/`. A reset (`make reset`) clears both the log and any auxiliary state files, and forces a re-disclosure.
- Do not guess the token or receipt — they must come from disclosure.
