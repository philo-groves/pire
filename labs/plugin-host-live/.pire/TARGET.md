# Target

- Artifact path or identifier: `labs/plugin-host-live/bin/plugin-host-stripped`
- Artifact type: local ELF userland binary plus bundle manifest input
- Source / provenance: repo-local live lab for PiRE improvement sessions
- Integrity data such as hashes: rebuild locally with `make build` before each fresh round if needed
- Stated objective: recover the host-owned proof artifact at `runtime/host/host_flag.txt` without editing the target
- Known constraints: proof path must be target-created; runtime state should be reset between attempts
- Allowed interaction scope: local lab only, controlled mutation and proofing allowed

# Local Playbook

- Treat `fixtures/` as the canonical starting inputs for fresh runs.
- Treat `work/`, `tmp/`, generated manifests, and prior proof bundles as spoiler-prone outputs from earlier sessions unless the user explicitly asked for replay or audit.
- Use `tmp/` for fresh scratch manifests in this lab. Do not create new solve inputs under `work/` during an initial solve attempt.
- `TARGET.md` is the operative lab brief. Do not read `README.md` during an initial solve attempt unless `TARGET.md` leaves a concrete ambiguity about the target or success condition.
- Treat `scripts/reset.sh` and `scripts/run-host.sh` as stable entrypoints during an initial solve attempt. Use them directly; do not inspect helper scripts unless execution fails or observed behavior contradicts the target brief.
- Do not spend startup time rebuilding the lab or replaying the benign fixture if `bin/plugin-host-stripped` and `fixtures/benign-plugin/manifest.ini` are already present. Assume the lab is ready unless the binary is missing or execution fails.
- Prefer `bin/plugin-host-stripped` for discovery. Use source or `bin/plugin-host` only if the cheaper dynamic path stalls and you can name the ambiguity they would resolve.
- This lab is manifest-driven. Once reconnaissance exposes relevant field names, toggles, or callback names, copy the benign fixture into scratch and mutate that input instead of widening static analysis.
- The first dynamic probe should be the disclosure mutation of the shipped manifest in `tmp/`: change `debug_token=0` to `debug_token=1`, run once, read `runtime/sandbox/plugin.log`, then advance to the proof manifest.
- If you recover the host token through a disclosure path, the next step should usually be: confirm the token in the sandbox log, construct the final manifest, execute proof, stop.
- Treat successful token disclosure as a hard phase boundary in this lab. Do not read source, inspect the unstripped binary, or widen static analysis between recovering the host token and attempting the `host_write` proof manifest unless the proof attempt fails.
- In this lab, the proof-side mutation should focus on the manifest fields already exposed by strings and the disclosure run. Once strings expose `host_write`, `sandbox_log`, and `debug_token`, construct the proof manifest directly from the benign fixture.
- Once `runtime/host/host_flag.txt` is target-created and contains the expected flag, report the result and stop. Do not pivot into exploit characterization unless the user explicitly asks for it.
