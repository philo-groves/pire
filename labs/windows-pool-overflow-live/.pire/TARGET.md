# Target

- Artifact path: `labs/windows-pool-overflow-live/bin/pool_overflow_snapshot-stripped`
- Artifact type: Windows kernel pool allocator simulation — typed chunk manager
- Source / provenance: repo-local live lab modeled on Windows kernel pool overflow attacks (CVE-2021-31956 NTFS pool overflow, CVE-2020-17087 cng.sys corruption)
- Integrity data: build locally via `make build`; reproducible from `src/pool_overflow_snapshot.c`
- Stated objective: recover the target-owned proof artifact at `runtime/proof/root_flag.txt` without editing the target binary or scripts
- Known constraints: proof must be target-created; runtime state should be reset between attempts
- Allowed interaction scope: local lab only, controlled mutation and proofing allowed

# Local Playbook

- First: append `--pool-trace` to `argv.txt`, run once, read `runtime/windows/pool-overflow.log`, recover the pool layout, the privileged token, and the proof receipt.
- The pool has 4 chunks: slot 0 (user_obj, offset 0, alloc_size 32, active), slot 1 (guard, offset 32, alloc_size 16, active), slot 2 (system_obj, offset 48), slot 3 (free, offset 64).
- The `extend_chunk()` function checks `new_size <= chunk.alloc_size` but does not check whether the write reaches past the gap to the next chunk. Slot 0's alloc_size (32) equals the gap to slot 1 (also 32 bytes), so extending slot 0 to its full alloc_size writes into slot 1's type_tag.
- The proof requires that the overflow overwrites slot 1's type_tag to exactly `"system_obj"`. This means `--overflow-tag=system_obj` must be supplied.
- Construct the proof invocation: `--op=extend --slot=0 --size=32 --overflow-tag=system_obj --token=<token> --receipt=<receipt>`.
- Do not guess the token or receipt — they must come from the disclosure log.
- Do not manually create the proof file or modify the pool state outside the target.
- Once `runtime/proof/root_flag.txt` is target-created and contains the expected flag, report and stop.
- Prefer VM-backed repros and explicit snapshot/reset flow.
- Capture debugger, symbol, and transport assumptions early.
- Keep the proof boundary fixed at a target-created artifact.
