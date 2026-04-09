# Target

- Artifact path or identifier: `labs/alias-maze-live/bin/alias-maze-snapshot-stripped`
- Artifact type: local ELF userland binary plus multi-file alias bundle input
- Stated objective: recover the alias proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch bundle directories. Do not trust pre-existing `tmp/` inputs from older runs.
- Use the real entrypoint: `./bin/alias-maze-snapshot --bundle <bundle-dir>`.
- The proof artifact must be target-created. Manually creating `runtime/root/root_flag.txt` is a forbidden shortcut.
- The decisive path is static and spread across base symbol loading, alias resolution, and action-plan reduction in separate translation units.
- Obvious alias chains tend to land on a near-solution. The proof path depends on canonical resolution, not the first plausible alias edge.
