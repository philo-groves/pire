# Target

- Artifact path or identifier: `labs/dns-proxy-live/bin/proxy-snapshot-stripped`
- Artifact type: local ELF DNS proxy binary plus command query input
- Stated objective: recover the root-owned proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch queries, but do not trust pre-existing `tmp/` queries from older runs. Create a new scratch directory for the current solve before disclosure or proof.
- Use the target through its real entrypoint: `./bin/proxy-snapshot-stripped --query <query-dir>`.
- Start from the benign query, then add a `TRACE` command, run once, and read `runtime/proxy/proxy.log` to recover both the proxy token and proof receipt.
- The vulnerability is a logic bug in privilege checking, not a buffer overflow or string expansion. Study the privilege enum values and how `process_zone` validates the caller's level.
- The proof mapping is exact: issue `AUTH user` then `ZONE root_zone` (which succeeds due to the privilege check flaw), set `MODE transfer`, provide `TOKEN <token>` plus `RECEIPT <receipt>`, and omit `TRACE` on the proof query so the receipt is not rotated again.
- Do not reset between disclosure and proof.
