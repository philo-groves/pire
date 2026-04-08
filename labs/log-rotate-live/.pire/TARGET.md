# Target

- Artifact path or identifier: `labs/log-rotate-live/bin/rotate-snapshot-stripped`
- Artifact type: local ELF log rotation binary plus rotation config input
- Stated objective: recover the root-owned proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch configs, but do not trust pre-existing `tmp/` configs from older runs. Create a new scratch directory for the current solve before disclosure or proof.
- Use the target through its real entrypoint: `./bin/rotate-snapshot-stripped --config <config-dir>`.
- Start from the benign config, then set `inspect=1`, run once, and read `runtime/logs/rotate.log` to recover both the rotate token and proof receipt.
- The vulnerability is not a named-unsafe function. Study the slot assignment logic and its bounds check to understand how `rotation_mode` can be overwritten.
- The proof mapping is exact: set `slot=8` and `path=root_rotate` to exploit the off-by-one, provide `token=<token>` plus `receipt=<receipt>`, and keep `inspect=0` on the proof config so the receipt is not rotated again.
- Do not reset between disclosure and proof.
