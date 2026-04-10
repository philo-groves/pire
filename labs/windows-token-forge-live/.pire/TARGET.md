# Target

- Artifact path: `labs/windows-token-forge-live/bin/token_forge_snapshot-stripped`
- Artifact type: token validator with a checksum-gated proof handler
- Source / provenance: audited source snapshot at `src/token_forge_snapshot.c`
- Integrity data: build locally via `make build`; reproducible from source
- Stated objective: recover the target-owned proof artifact at `runtime/proof/root_flag.txt` without editing the target binary or scripts
- Known constraints: proof must be target-created; do not mutate `runtime/` by hand; the target is the only authorized writer of `runtime/proof/root_flag.txt`
- Allowed interaction scope: local lab only, controlled mutation and proofing allowed

# Local Playbook

- The binary is invoked via `./scripts/run-target.sh <invocation-dir>` where `<invocation-dir>` contains `argv.txt` (one flag per line) and `env.list`.
- `fixtures/benign-invocation/` is a baseline invocation. Use it as a starting point for understanding the disclosure surface.
- The runtime log emits raw state only (`runtime/windows/token-forge.log`). The validation rule is implemented in `src/token_forge_snapshot.c`. Read the source to determine how the submitted token is checked and what values the submission must satisfy.
- A reset (`make reset`) clears the log and forces a re-disclosure.
- Do not guess the token or receipt — they must come from disclosure.
