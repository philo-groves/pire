# Target

- Artifact path: `labs/windows-service-trigger-live/bin/service_trigger_snapshot-stripped`
- Artifact type: Windows Service Control Manager simulation — decoy branch selection
- Source / provenance: repo-local live lab modeled on Windows service manipulation and privilege escalation patterns
- Integrity data: build locally via `make build`; reproducible from `src/service_trigger_snapshot.c`
- Stated objective: recover the target-owned proof artifact at `runtime/proof/root_flag.txt` without editing the target binary or scripts
- Known constraints: proof must be target-created; starting the wrong service can permanently block the proof path
- Allowed interaction scope: local lab only, controlled mutation and proofing allowed

# Local Playbook

- This lab has decoy services that look promising but block or waste time. Read disclosure carefully before starting any service.

- Phase 1 (Disclosure): `--list-services`. Read `runtime/windows/service-trigger.log`. Recover:
  - Three services: AuthService, CacheService, DispatchService
  - AuthService: creates dispatch-lock.dat which PERMANENTLY blocks DispatchService
  - CacheService: returns expired credentials (red herring, useless)
  - DispatchService: the real target, requires --svc-token and no dispatch-lock.dat
  - The svc-token value for DispatchService
  - Secret token and proof receipt

- Phase 2 (Dispatch): `--start-service --service=DispatchService --svc-token=<svc-activation-token> --token=<secret> --receipt=<receipt>`. Starts the real target and writes proof.

- WARNING: Do NOT start AuthService. It creates dispatch-lock.dat which blocks DispatchService. The only recovery is a full reset (which destroys the receipt, requiring re-disclosure).
- Do NOT waste time querying CacheService — its credentials are expired and useless.
- Do not guess the token, receipt, or svc-token — they must come from the disclosure log.
