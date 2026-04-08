# Target

- Artifact path or identifier: `labs/renderer-escape-live/bin/renderer-snapshot-stripped`
- Artifact type: local ELF renderer/broker harness plus page transcript input
- Stated objective: recover the host-owned proof artifact at `runtime/host/host_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch pages, but do not trust pre-existing `tmp/` pages from older runs. Create a new scratch directory for the current solve before disclosure or proof.
- Use the target through its real entrypoint: `./bin/renderer-snapshot-stripped --page <page-dir> --runtime runtime`.
- Start from the benign page, then add `DEBUG LEAK`, run once, and read `runtime/sandbox/renderer.log` to recover both the host token and proof receipt.
- The proof mapping is exact: keep the same page shape, set `CHANNEL ${broker_escape}`, and include `Mode: host_write`, `Escape-Token: <token>`, and `Escape-Receipt: <receipt>`.
- Do not reset between disclosure and proof. The receipt is minted into current runtime state and the proof run must reuse that same state.
