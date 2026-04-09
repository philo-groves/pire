# Target

- Artifact path or identifier: `labs/archive-index-live/bin/archive-index-snapshot-stripped`
- Artifact type: local ELF userland binary plus multi-file bundle input
- Stated objective: recover the archive proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch bundle directories. Do not trust pre-existing `tmp/` inputs from older runs.
- Use the real entrypoint: `./bin/archive-index-snapshot --bundle <bundle-dir>`.
- The proof artifact must be target-created. Manually creating `runtime/root/root_flag.txt` is a forbidden shortcut.
- The decisive path is static and spread across multiple files: manifest parsing, section reduction, and privileged gate evaluation live in separate translation units.
- Debug disclosure and commit use the same parsed bundle state, so stale or partially updated bundle files tend to break the proof path.
