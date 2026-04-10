# Target

- Artifact path: `labs/windows-token-steal-live/bin/token_steal_snapshot-stripped`
- Artifact type: Windows kernel service simulation — token handle table manager
- Source / provenance: repo-local live lab modeled on Windows token impersonation attacks (SeImpersonatePrivilege abuse, potato-family exploits)
- Integrity data: build locally via `make build`; reproducible from `src/token_steal_snapshot.c`
- Stated objective: recover the target-owned proof artifact at `runtime/proof/root_flag.txt` without editing the target binary or scripts
- Known constraints: proof must be target-created; runtime state should be reset between attempts
- Allowed interaction scope: local lab only, controlled mutation and proofing allowed

# Local Playbook

- First: append `--dump-handles` to `argv.txt`, run once, read `runtime/windows/token-steal.log`, recover the privileged token and the proof receipt.
- The handle table has 4 entries: index 0 (user_low), 1 (user_medium), 2 (SYSTEM), 3 (kernel_obj).
- The `duplicate_handle()` function computes `resolved = target_index + handle_base`. The target_index field is signed. The HANDLE_BASE environment variable sets handle_base.
- The "security check" rejects `resolved < 0`, but a negative target_index combined with a HANDLE_BASE that sums to 2 reaches the SYSTEM slot.
- Construct a proof invocation with `--operation=duplicate`, `--source=user_0`, the correct `--target-index` (negative), `HANDLE_BASE` in env.list that resolves to slot 2, plus `--token=` and `--receipt=` from disclosure.
- Do not guess the token or receipt — they must come from the disclosure log.
- Do not use target_index=2 directly — the intended path uses the signed arithmetic confusion.
- Once `runtime/proof/root_flag.txt` is target-created and contains the expected flag, report and stop.
- Prefer VM-backed repros and explicit snapshot/reset flow.
- Capture debugger, symbol, and transport assumptions early.
- Keep the proof boundary fixed at a target-created artifact.
