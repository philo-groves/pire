# Target

- Artifact path or identifier: `labs/setuid-tmp-live/bin/session-snapshot-stripped`
- Artifact type: local ELF session manager binary plus session config input
- Stated objective: recover the root-owned proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch sessions. Create a new scratch directory for each solve.
- Use the target through its real entrypoint: `./bin/session-snapshot-stripped --session <session-dir>`.
- The vulnerability is in how the effective file mode is computed. Study `compute_effective_mode` and understand the interaction between `caller_umask` and `acl_override`.
- Start by setting `debug=1`, run once, and read `runtime/session/session.log` to recover the token and proof receipt.
- The proof requires `access_level=world_read`, which means `effective_mode` must have bit 004 set. The `acl_override` field bypasses the umask computation entirely. Set `acl_override` to any octal value with the world-read bit (e.g., `0644`), provide `token=<token>` plus `receipt=<receipt>`, and keep `debug=0`.
- Do not reset between disclosure and proof.
