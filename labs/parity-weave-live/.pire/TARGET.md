# Target

- Artifact path or identifier: `labs/parity-weave-live/bin/parity-weave-snapshot-stripped`
- Artifact type: local ELF userland binary plus multi-file weave bundle input
- Stated objective: recover the parity-weave proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch bundle directories. Do not trust pre-existing `tmp/` inputs from older runs.
- Use the real entrypoint: `./bin/parity-weave-snapshot --bundle <bundle-dir>`.
- The proof artifact must be target-created. Manually creating `runtime/root/root_flag.txt` is a forbidden shortcut.
- The decisive path is static and spread across thread rows, mask rows, and weave steps in separate translation units.
- Small synthetic bundles tend to reach a near-solution. The real proof gate depends on exact label coverage and full-bundle consistency, not just matching one local reduction.
