# Target

- Artifact path or identifier: `labs/chmod-drift-live/bin/volume-snapshot-stripped`
- Artifact type: local ELF volume manager binary plus volume config input
- Stated objective: recover the root-owned proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch volume configs. Create a new scratch directory for each solve.
- Use the target through its real entrypoint: `./bin/volume-snapshot-stripped --volume <volume-dir>`.
- The vulnerability is in how `compute_effective_mode` combines owner and mount permissions. Study the bitwise operation and determine whether it computes the intersection or the union of the two mode fields.
- Start by setting `debug=1`, run once, and read `runtime/volume/volume.log` to recover the token and proof receipt.
- The proof requires `write_level=world_write`, which means `effective_mode` must have bit 002 set. With the buggy union operation, set one mode with the world-write bit (e.g., `mount_mode=0002`) while the other remains restrictive. Provide `token=<token>` plus `receipt=<receipt>`, and keep `debug=0`.
- Do not reset between disclosure and proof.
