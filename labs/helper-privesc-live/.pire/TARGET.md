# Target

- Artifact path or identifier: `labs/helper-privesc-live/bin/helper-snapshot-stripped`
- Artifact type: local ELF helper binary plus request manifest input
- Stated objective: recover the root-owned proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch requests.
- Start from the benign request, then set `debug=1`, run once, and read `runtime/user/helper.log` to recover both the helper token and proof receipt.
- The proof mapping is exact: keep the same request shape, set `resource=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAroot_exec`, and provide `token=<token>` plus `receipt=<receipt>`.
- Do not reset between disclosure and proof.
