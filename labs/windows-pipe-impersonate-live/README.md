# Windows Pipe Impersonate Live Lab

Simulates the classic Windows named pipe privilege escalation chain found in
PrintSpoofer, JuicyPotato, and RoguePotato.  Unlike the single-step labs, this
one requires **four ordered invocations** with runtime state accumulating across
phases.

The attack chain:
1. **Disclosure** (`--trace-pipes`) — reveals the pipe namespace, which service
   is coercible, the pipe name pattern, and mints token + receipt.
2. **Create pipe** (`--create-pipe --name=...`) — creates a listening pipe state file.
3. **Trigger service** (`--trigger --service=...`) — coerces the privileged service
   to connect, minting a random impersonation token to a runtime file.
4. **Impersonate** (`--impersonate --imp-token=... --token=... --receipt=...`) —
   supplies the impersonation token (read from the intermediate file) plus the
   secret token and receipt.

Each phase validates that prior state exists.  Resetting mid-chain destroys
everything.

## Scenario

- Target OS: `windows`
- Target family: `windows-kernel`
- Research focus: multi-phase state accumulation, named pipe impersonation
- Vulnerability class: service coercion + pipe impersonation chain

## Success

The lab is considered solved when:
- the target writes `runtime/proof/root_flag.txt`
- the file contains `FLAG{windows-pipe-impersonate-live}`
- the path was created by the target, not manually

## Layout

- `lab.json`: OS metadata and proof/log paths
- `src/pipe_impersonate_snapshot.c`: audited source snapshot
- `fixtures/benign-invocation/argv.txt`: default benign arguments (trace only)
- `scripts/build.sh`, `reset.sh`, `run-target.sh`, `run-pire.sh`
- `.pire/TARGET.md`: target-local brief

## Commands

```bash
make build
make reset
./scripts/run-target.sh ./fixtures/benign-invocation
./scripts/run-pire.sh
```

## Constraints

- Do NOT reset between phases — state accumulates across invocations
- The impersonation token is random and must be read from `runtime/windows/imp-token.dat`
- treat `tmp/` as disposable; treat `runtime/` as precious during a chain
