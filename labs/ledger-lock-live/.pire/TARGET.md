# Target

- Artifact path or identifier: `labs/ledger-lock-live/bin/ledger-lock-snapshot-stripped`
- Artifact type: local ELF userland binary plus multi-file ledger bundle input
- Stated objective: recover the ledger-lock proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch bundle directories. Do not trust pre-existing `tmp/` inputs from older runs.
- Use the real entrypoint: `./bin/ledger-lock-snapshot --bundle <bundle-dir>`.
- The proof artifact must be target-created. Manually creating `runtime/root/root_flag.txt` is a forbidden shortcut.
- The decisive path is static and spread across account rows, link closure, and journal replay in separate translation units.
- Small synthetic bundles tend to satisfy only a local closure. The real proof gate depends on whole-ledger coverage and lock consistency, not a compact subgraph.
