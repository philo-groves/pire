# Target

- Artifact path or identifier: `labs/reloc-record-live/bin/reloc-record-snapshot-stripped`
- Artifact type: local ELF userland binary plus encoded relocation record input
- Stated objective: recover the loader-owned proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch record directories. Do not trust pre-existing `tmp/` inputs from older runs.
- Use the real entrypoint: `./bin/reloc-record-snapshot-stripped --records <records-dir>`.
- The proof artifact must be target-created. Manually creating `runtime/root/root_flag.txt` is a forbidden shortcut.
- Expect an index-dependent decode step before tag dispatch. Recover the decode rule before guessing tag values.
- The debug path is in the record stream. Recovering the token and receipt should come from a deliberate disclosure record run.
- Do not reset between disclosure and proof unless you intentionally want a new receipt.
