# Target

- Artifact path: `labs/windows-registry-acl-live/bin/registry_acl_snapshot-stripped`
- Artifact type: Windows registry hive simulation with path-based ACL
- Source / provenance: repo-local live lab modeled on Windows registry path normalization and TOCTOU ACL bypass patterns
- Integrity data: build locally via `make build`; reproducible from `src/registry_acl_snapshot.c`
- Stated objective: recover the target-owned proof artifact at `runtime/proof/root_flag.txt` without editing the target binary or scripts
- Known constraints: proof must be target-created; runtime state should be reset between attempts
- Allowed interaction scope: local lab only, controlled mutation and proofing allowed

# Local Playbook

- First: append `--dump-hive` to `argv.txt`, run once, read `runtime/windows/registry-acl.log`, recover the hive layout, the ACL rule, the normalization hint, the token, and the receipt.
- The hive has public keys under `HKLM\SOFTWARE\...` and restricted keys under `HKLM\SYSTEM\...`. The proof trigger is at key `HKLM\SYSTEM\Secrets\Flag`.
- The ACL check runs on the RAW path and rejects anything starting with `HKLM\SYSTEM`. The key lookup runs AFTER path normalization, which resolves `..` components.
- The vulnerability is a normalization-vs-ACL ordering bug: a path like `HKLM\SOFTWARE\..\SYSTEM\Secrets\Flag` passes the ACL check (starts with `HKLM\SOFTWARE`) but after `..` resolution reaches `HKLM\SYSTEM\Secrets\Flag`.
- Construct the proof invocation: `--query --path=HKLM\SOFTWARE\..\SYSTEM\Secrets\Flag --token=<tok> --receipt=<rec>`.
- The `..` must appear AFTER a valid `HKLM\SOFTWARE\...` prefix to pass the raw ACL check.
- Do not guess the token or receipt — they must come from the disclosure log.
- Do not attempt to query `HKLM\SYSTEM\...` directly — the ACL check will reject it.
- Once `runtime/proof/root_flag.txt` is target-created and contains the expected flag, report and stop.
