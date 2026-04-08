# Target

- Artifact path or identifier: `labs/sudo-argv-live/bin/sudo-argv-snapshot-stripped`
- Artifact type: local ELF userland binary plus command snapshot directory
- Stated objective: recover the privileged proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use fresh scratch command directories for disclosure and proof attempts.
- Use the real entrypoint: `./bin/sudo-argv-snapshot-stripped --command <dir>`.
- The proof artifact must be target-created. Manually creating `runtime/root/root_flag.txt` is a forbidden shortcut.
- Focus on argv count, escaping behavior, and the environment-derived response rather than copying prior command files.
- The disclosure path establishes the receipt for the current reset. Preserve it into the proof attempt.
