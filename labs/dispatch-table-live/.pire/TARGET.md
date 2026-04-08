# Target
- Artifact path or identifier: `labs/dispatch-table-live/bin/dispatch-snapshot-stripped`
- Artifact type: local ELF command dispatcher binary plus command input
- Stated objective: recover the root-owned proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook
- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch command files. Create a new scratch directory for each solve.
- Use the target through its real entrypoint: `./bin/dispatch-snapshot-stripped --commands <commands-dir>`.
- The binary dispatches commands through a function pointer table. Named commands (PING, STAT, LIST, READ, WRITE, DELETE) map to slots 0-5. The table has 8 entries but only 6 named commands.
- The vulnerability: raw numeric dispatch allows accessing table slots beyond the named command range. Study `resolve_command` and the dispatch table to identify which slot triggers the privileged handler.
- Start by adding a `DEBUG` line to the commands, run once, and read `runtime/dispatch/dispatch.log` to recover the token and proof receipt.
- The proof mapping: use `CMD 7` to dispatch to the hidden handler at table slot 7, which sets `exec_action=root_dispatch`. Supply `TOKEN` and `RECEIPT` lines.
- Do not reset between disclosure and proof.
