# Target

- Artifact path or identifier: `labs/plugin-host-live/bin/plugin-host-stripped`
- Artifact type: local ELF userland binary plus bundle manifest input
- Source / provenance: repo-local live lab for PiRE improvement sessions
- Integrity data such as hashes: rebuild locally with `make build` before each fresh round if needed
- Stated objective: recover the host-owned proof artifact at `runtime/host/host_flag.txt` without editing the target
- Known constraints: proof path must be target-created; runtime state should be reset between attempts
- Allowed interaction scope: local lab only, controlled mutation and proofing allowed
