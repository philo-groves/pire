# Target

- Artifact path or identifier: `labs/thread-seed-live/bin/thread-seed-snapshot-stripped`
- Artifact type: local ELF userland binary plus session config input
- Stated objective: recover the threaded proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch session directories. Do not trust pre-existing `tmp/` inputs from older runs.
- Use the real entrypoint: `./bin/thread-seed-snapshot-stripped --session <session-dir>`.
- The proof artifact must be target-created. Manually creating `runtime/root/root_flag.txt` is a forbidden shortcut.
- `debug` starts a persistent threaded helper. The final response depends on runtime-only state held across live threads.
- The helper socket supports lightweight discovery. `help` returns the request shape, and `probe=worker-mix` returns the current worker-side mix without creating proof.
- Bad proof attempts rotate both the main-thread and worker-thread seeds, so guessed responses go stale immediately.
- Do not reset between disclosure and proof unless you intentionally want a fresh helper, receipt, and challenge.
