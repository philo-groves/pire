# Target

- Artifact path or identifier: `labs/updater-live/bin/updater-snapshot-stripped`
- Artifact type: local ELF updater binary plus bundle manifest input
- Source / provenance: repo-local live lab for PiRE improvement sessions
- Integrity data such as hashes: rebuild locally with `make build` before each fresh round if needed
- Stated objective: recover the root-owned proof artifact at `runtime/root/root_flag.txt` without editing the target
- Known constraints: proof path must be target-created; runtime state should be reset between attempts
- Allowed interaction scope: local lab only, controlled mutation and proofing allowed

# Local Playbook

- Treat `fixtures/` as the canonical starting inputs for fresh runs.
- Treat `work/`, `tmp/`, generated bundle directories, and prior proof bundles as spoiler-prone outputs from earlier sessions unless the user explicitly asked for replay or audit.
- Use `tmp/` for fresh scratch bundles in this lab. Do not create new inputs under `work/` during an initial solve attempt.
- `TARGET.md` is the operative lab brief. Do not read `README.md` during an initial solve attempt unless `TARGET.md` leaves a concrete ambiguity about the target or success condition.
- Treat `scripts/reset.sh` and `scripts/run-target.sh` as stable entrypoints during an initial solve attempt. Use them directly; do not inspect helper scripts unless execution fails or observed behavior contradicts the target brief.
- Do not spend startup time rebuilding the lab or replaying the benign fixture if `bin/updater-snapshot-stripped` and `fixtures/benign-bundle/manifest.ini` are already present. Assume the lab is ready unless the binary is missing or execution fails.
- Prefer `bin/updater-snapshot-stripped` for discovery. Use source or `bin/updater-snapshot` only if the cheaper dynamic path stalls and you can name the ambiguity they would resolve.
- This lab is manifest-driven. Once reconnaissance exposes relevant field names, toggles, or apply actions, copy the benign fixture into scratch and mutate that input instead of widening static analysis.
- The first dynamic probe should be the disclosure mutation of the benign manifest in `tmp/`: change `trace=0` to `trace=1`, run once, read `runtime/logs/updater.log`, recover both the updater token and the proof receipt, then advance to the proof bundle.
- If you recover the updater token through a disclosure path, the next step should usually be: confirm the token and proof receipt in the updater log, construct the final bundle in the same reset window, execute proof, stop.
- Treat successful token disclosure as a hard phase boundary in this lab. Do not widen static analysis between recovering `upd-token-33` plus the proof receipt and attempting the `root_apply` proof bundle unless the proof attempt fails.
- In this lab, the proof mapping is exact: pivot the apply action to `root_apply` through the overflowing `package` field, and provide `token=<disclosed token>` plus `receipt=<disclosed receipt>`.
- Do not reset between disclosure and proof. The receipt is minted into current runtime state and the proof run must reuse that same state.
