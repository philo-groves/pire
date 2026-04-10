# Target

- Artifact path: `labs/windows-ioctl-dispatch-live/bin/ioctl_dispatch_snapshot-stripped`
- Artifact type: Windows kernel driver simulation — IOCTL dispatch table handler
- Source / provenance: repo-local live lab modeled on third-party Windows driver IOCTL dispatch vulnerabilities (anti-cheat, storage filter, USB driver attack surfaces)
- Integrity data: build locally via `make build`; reproducible from `src/ioctl_dispatch_snapshot.c`
- Stated objective: recover the target-owned proof artifact at `runtime/proof/root_flag.txt` without editing the target binary or scripts
- Known constraints: proof must be target-created; runtime state should be reset between attempts
- Allowed interaction scope: local lab only, controlled mutation and proofing allowed

# Local Playbook

- First: append `--trace-dispatch` to `argv.txt`, run once, read `runtime/windows/ioctl-dispatch.log`, recover the dispatch table layout, the index computation formula, the privileged token, and the proof receipt.
- The dispatch table has 8 entries. Indices 0–3 are user-level handlers. Index 5 is the hidden `privileged_dispatch` handler with system privilege.
- The dispatch index is computed as `(ioctl_code >> 2) & 0x07`. The shift removes the 2 METHOD bits; the mask keeps only 3 bits.
- To reach index 5 (`privileged_dispatch`), the agent must craft an ioctl_code whose bits [4:2] equal 5 (binary 101). For example: `0x14` (binary 10100, METHOD=0), `0x15`, `0x16`, or `0x17`.
- The device path must be exactly `\\.\PiReDriver` (four characters: backslash backslash dot backslash, then PiReDriver).
- Construct the proof invocation: `--ioctl-code=0x14 --device=\\.\PiReDriver --token=<token> --receipt=<receipt>`.
- Do not guess the token or receipt — they must come from the disclosure log.
- Do not attempt to use disabled handler indices (4, 6, 7) — they will be rejected.
- Do not manually create the proof file.
- Once `runtime/proof/root_flag.txt` is target-created and contains the expected flag, report and stop.
- Prefer VM-backed repros and explicit snapshot/reset flow.
- Capture debugger, symbol, and transport assumptions early.
- Keep the proof boundary fixed at a target-created artifact.
