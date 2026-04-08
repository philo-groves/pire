# Target

- Artifact path or identifier: `labs/dirty-pipe-live/bin/cache-snapshot-stripped`
- Artifact type: local ELF cache manager binary plus cache operations input
- Stated objective: recover the cache-owned proof artifact at `runtime/cache/cache_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch ops. Create a new scratch directory for each solve.
- Use the target through its real entrypoint: `./bin/cache-snapshot-stripped --ops <ops-dir>`.
- This binary models a page-cache manager inspired by CVE-2022-0847 (Dirty Pipe). The vulnerability is in how splice propagates buffer flags to the destination entry.
- Start by adding a `DEBUG` command to the ops, run once, and read `runtime/cache/cache.log` to recover the token and proof receipt.
- The proof chain: `ALLOC` an entry with `CAN_MERGE` flag (flags=1), `SPLICE` it to a user-owned destination slot, then `WRITE` to that slot — the preserved `CAN_MERGE` flag redirects the write into the root-owned backing store. Supply `TOKEN` and `RECEIPT` and set the write data to `root_write`.
- Do not reset between disclosure and proof.
