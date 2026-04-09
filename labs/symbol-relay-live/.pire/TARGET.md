# Target

- Artifact path or identifier: `labs/symbol-relay-live/bin/symbol-relay-snapshot-stripped`
- Artifact type: local ELF userland binary plus multi-file relay bundle input
- Stated objective: recover the relay proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch bundle directories. Do not trust pre-existing `tmp/` inputs from older runs.
- Use the real entrypoint: `./bin/symbol-relay-snapshot --bundle <bundle-dir>`.
- The proof artifact must be target-created. Manually creating `runtime/root/root_flag.txt` is a forbidden shortcut.
- The decisive path is static and spread across layout parsing, symbol resolution, and relay reduction in separate translation units.
- Debug disclosure and commit both depend on the same resolved relay state, so partial edits to only one bundle file usually break the proof path.
