# Target

- Artifact path or identifier: `labs/cron-write-live/bin/cron-snapshot-stripped`
- Artifact type: local ELF cron daemon binary plus spool config input
- Stated objective: recover the root-owned proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch spool configs. Create a new scratch directory for each solve.
- Use the target through its real entrypoint: `./bin/cron-snapshot-stripped --spool <spool-dir>`.
- The vulnerability is in where the binary reads directory permission metadata. Study `validate_job_access` and trace where `spool_mode` originates.
- Start by setting `debug=1`, run once, and read `runtime/spool/cron.log` to recover the token and proof receipt.
- The proof requires `run_as=root_exec` to survive the access check. The check reads `spool_mode` from the input and tests bit 020 (group-write). Set `spool_mode` to any octal value with the group-write bit set (e.g., `0770`), provide `token=<token>` plus `receipt=<receipt>`, and keep `debug=0` on the proof run.
- Do not reset between disclosure and proof.
