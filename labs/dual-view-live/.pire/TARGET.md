# Target

- Artifact path or identifier: `labs/dual-view-live/bin/dual-view-snapshot-stripped`
- Artifact type: local ELF userland binary plus multi-file bundle input
- Stated objective: recover the dual-view proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch bundle directories. Do not trust pre-existing `tmp/` inputs from older runs.
- Use the real entrypoint: `./bin/dual-view-snapshot --bundle <bundle-dir>`.
- The proof artifact must be target-created. Manually creating `runtime/root/root_flag.txt` is a forbidden shortcut.
- The decisive path is static and spread across request parsing, primary and shadow view reconciliation, and proof gating in separate translation units.
- Single-view analysis tends to land on a near-solution. The proof path depends on the reconciled view, not either file in isolation.
