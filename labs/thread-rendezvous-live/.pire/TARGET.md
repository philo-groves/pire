# Target

- Artifact path or identifier: `labs/thread-rendezvous-live/bin/thread-rendezvous-snapshot-stripped`
- Artifact type: local ELF userland binary plus threaded handshake input
- Stated objective: recover the rendezvous-owned proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch handshake directories. Do not trust pre-existing `tmp/` inputs from older runs.
- Use the real entrypoint: `./bin/thread-rendezvous-snapshot-stripped --handshake <handshake-dir>`.
- The proof artifact must be target-created. Manually creating `runtime/root/root_flag.txt` is a forbidden shortcut.
- Expect the hard part to be the worker-state transitions and the derived rendezvous response, not the file format.
- The disclosure path is encoded in the handshake script. Recover the token and receipt through a deliberate disclosure run, then build the proof handshake.
- This lab is meant to benefit from debugger-assisted inspection. If static analysis stalls, inspect thread state transitions dynamically instead of widening guesses.
- Do not reset between disclosure and proof unless you intentionally want a new receipt.
