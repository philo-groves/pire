# Target

- Artifact path or identifier: `labs/triage-multi-bug-live/bin/transform-snapshot-stripped`
- Artifact type: local ELF transform binary plus config input
- Stated objective: recover the root-owned proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch configs, but do not trust pre-existing `tmp/` configs from older runs.
- Use the target through its real entrypoint: `./bin/transform-snapshot-stripped --config <config-dir>`.
- This binary contains multiple bug-shaped code paths. Only one leads to proof. Triage carefully before committing to an exploit path.
- Start from the benign config, then set `debug=1`, run once, and read `runtime/logs/transform.log` to recover both the transform token and proof receipt.
- The proof mapping is exact: set `transform=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAroot_apply` (32 A's followed by root_apply) to overflow `transform_buf` into `transform_mode`, provide `token=<token>` plus `receipt=<receipt>`, and keep `debug=0` on the proof config so the receipt is not rotated again.
- Do not reset between disclosure and proof.
