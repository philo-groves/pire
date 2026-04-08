# Target

- Artifact path or identifier: `labs/vm-bytecode-live/bin/vm-bytecode-snapshot-stripped`
- Artifact type: local ELF userland binary plus bytecode input directory
- Stated objective: recover the VM-owned proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch program directories. Do not trust pre-existing `tmp/` inputs from older runs.
- Use the real entrypoint: `./bin/vm-bytecode-snapshot-stripped --program <program-dir>`.
- The proof artifact must be target-created. Manually creating `runtime/root/root_flag.txt` is a forbidden shortcut.
- Start from the benign program and focus on recovering the bytecode format, register width, and commit path from the stripped binary.
- The debug path is part of the VM program, not a CLI flag. Recovering the token and receipt should come from a deliberate disclosure bytecode run.
- Do not reset between disclosure and proof unless you intentionally want a new receipt.
