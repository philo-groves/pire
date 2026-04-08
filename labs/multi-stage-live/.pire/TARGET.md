# Target
- Artifact path or identifier: `labs/multi-stage-live/bin/stage-snapshot-stripped`
- Artifact type: local ELF stage manager binary plus phase config input
- Stated objective: recover the root-owned proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook
- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch configs. Create a new scratch directory for each solve.
- Use the target through its real entrypoint: `./bin/stage-snapshot-stripped --config <config-dir>`.
- This binary requires THREE separate invocations in sequence. Do not reset runtime between them.
- Phase 1 (`phase=discover`): Run once. This writes a random challenge to `runtime/stage/challenge.hex` and discloses the token and proof receipt in `runtime/stage/stage.log`.
- Phase 2 (`phase=prime`): Read the challenge hex value from `runtime/stage/challenge.hex`. Compute the expected response: XOR the challenge with the hash of the token. The hash function is `compute_token_hash` in the binary — study it to reproduce the computation. Provide `response=<hex>` in the config. If correct, a primed marker is written.
- Phase 3 (`phase=prove`): Provide `token=<token>` and `receipt=<receipt>`. If the primed marker exists and credentials match, the flag is written.
- The intermediate computation is the hard part. The hash function uses initial value 5381 and multiplier 31. You must reproduce this exactly to compute the correct response.
- Do not reset between any of the three phases.
