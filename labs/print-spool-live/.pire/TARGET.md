# Target

- Artifact path or identifier: `labs/print-spool-live/bin/spool-snapshot-stripped`
- Artifact type: local ELF spooler binary plus print-job transcript input
- Stated objective: recover the root-owned proof artifact at `runtime/spool/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch jobs.
- Start with the benign job, then add `@DEBUG TOKEN`, read `runtime/spool/spool.log`, and recover both the spool token and proof receipt.
- The proof mapping is exact: set `DEST ${root_print}`, then include `@PJL SET OWNER=root`, `@PJL SET TOKEN=<token>`, and `@PJL SET RECEIPT=<receipt>`.
- Do not reset between disclosure and proof.
