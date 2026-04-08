# Target

- Artifact path or identifier: `labs/ephemeral-window-live/bin/ephemeral-window-snapshot-stripped`
- Artifact type: local ELF userland binary plus session config input
- Stated objective: recover the window-owned proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch session directories. Do not trust pre-existing `tmp/` inputs from older runs.
- Use the real entrypoint: `./bin/ephemeral-window-snapshot-stripped --session <session-dir>`.
- The proof artifact must be target-created. Manually creating `runtime/root/root_flag.txt` is a forbidden shortcut.
- The disclosure window is one-shot. Wrong proof attempts burn the current window and force a fresh disclosure run.
- Do not reset between disclosure and proof unless you intentionally want a new receipt and challenge.
