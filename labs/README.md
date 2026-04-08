# Live Labs

This directory holds runnable local targets for PiRE live improvement sessions.

Goals:
- give PiRE a real target to investigate instead of only fixture metadata
- keep runs repeatable with explicit build, reset, and proof-artifact paths
- make it easy to rerun the same target after prompt or workflow changes

Current labs:
- `plugin-host-live`: objective tracking, disclosure, callback pivoting, and proof capture
- `sudoedit-live`: policy-boundary overflow shaping, disclosure, and proof capture
- `pkexec-live`: environment confusion, disclosure, and privilege-boundary proof
- `mail-service-live`: service request-stream abuse, disclosure, and service-owned proof
- `updater-live`: trust-boundary bypass, disclosure, and root-owned proof
- `broker-live`: multi-stage broker escape with disclosure, pivot, and privileged action
- `print-spool-live`: spool queue abuse and root-side print action proof
- `renderer-escape-live`: renderer-to-host escape shaping and host-side proof
- `helper-privesc-live`: helper misuse and root-owned proof capture
- `log-rotate-live`: privileged rotation path abuse and proof capture
- `dns-proxy-live`: unauthorized transfer path and proof capture
- `image-decoder-live`: parser-to-proof transition from a media input
- `triage-multi-bug-live`: bug triage pressure with one real proof path
- `prompt-inject-live`: prompt injection resistance plus authorization-state tracking
- `shortcut-tempt-live`: reckless-shortcut resistance and dynamic proof validation
- `dirty-pipe-live`: cached write-path abuse and proof capture
- `netfilter-uaf-live`: kernel-adjacent queue state abuse and root-side proof
- `futex-requeue-live`: scheduler state tracking, stale PI boost, and privileged action
- `cron-write-live`: root job creation path and proof capture
- `setuid-tmp-live`: temporary-file state abuse and privileged proof
- `chmod-drift-live`: permission drift state tracking and proof capture
- `multi-stage-live`: explicit three-phase state accumulation before proof
- `encoded-config-live`: encoded-input recovery and proof activation
- `dispatch-table-live`: dispatch slot recovery and hidden privileged handler discovery
- `vm-bytecode-live`: VM bytecode RE lab focused on opcode recovery, register-state reconstruction, and hidden commit discovery
- `reloc-record-live`: packed relocation stream RE lab focused on bitfield decoding, encoded record reconstruction, and handler mapping
- `license-fsm-live`: custom alphabet and FSM RE lab focused on decoder recovery, checksum reconstruction, and proof-state activation
- `thread-rendezvous-live`: threaded state RE lab focused on worker transition recovery, rendezvous gating, and debugger-assisted proof derivation

Recommended workflow:
1. `cd` into the lab directory
2. run `make build`
3. run `make reset`
4. launch PiRE from that directory with `./scripts/run-pire.sh`
5. keep the proof boundary stable between iterations
