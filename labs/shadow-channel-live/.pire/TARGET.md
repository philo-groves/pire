# Target

- Artifact path or identifier: `labs/shadow-channel-live/bin/shadow-channel-snapshot-stripped`
- Artifact type: local ELF userland binary plus session config input
- Stated objective: recover the channel-owned proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch session directories. Do not trust pre-existing `tmp/` inputs from older runs.
- Use the real entrypoint: `./bin/shadow-channel-snapshot-stripped --session <session-dir>`.
- The proof artifact must be target-created. Manually creating `runtime/root/root_flag.txt` is a forbidden shortcut.
- There are multiple disclosure branches. The obvious one is not sufficient for privileged proof.
- A wrong commit on the shadow branch invalidates the current challenge, so avoid guessing through commit attempts.
