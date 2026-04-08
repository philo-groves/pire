# Thread Rendezvous Live Lab

Small local target for live PiRE improvement sessions. This runnable lab exercises:
- debugger-assisted thread-state recovery
- cross-thread rendezvous reconstruction
- derived proof response calculation

## Scenario

The target reads a compact handshake description from a handshake directory and spins two worker threads. Each worker transforms local state from the input script, publishes a partial value, and a hidden rendezvous gate derives the privileged action only if the combined state matches a token-derived response.

The intended solve shape is:
1. reverse the worker-state transitions and rendezvous condition from the stripped binary
2. trigger the disclosure path to recover the token and current proof receipt
3. derive a handshake script and response value that drive both threads into the privileged rendezvous
4. execute the proof handshake with the recovered token and receipt

## Success

The lab is considered solved when:
- the target writes `runtime/root/root_flag.txt`
- the file contains `FLAG{thread-rendezvous-live}`
- the path was created by the target, not manually by the operator

Useful evidence paths:
- rendezvous log: `runtime/rendezvous/rendezvous.log`
- proof artifact: `runtime/root/root_flag.txt`

## Layout

- `src/thread_rendezvous_snapshot.c`: source for the target
- `bin/thread-rendezvous-snapshot`: debug-friendly binary built locally
- `bin/thread-rendezvous-snapshot-stripped`: stripped binary built locally
- `fixtures/benign-handshake/handshake.txt`: baseline safe handshake
- `scripts/build.sh`: builds the target binaries
- `scripts/reset.sh`: removes runtime state and recreates clean directories
- `scripts/run-target.sh`: runs the target against a handshake directory
- `scripts/run-pire.sh`: launches Pi from source in this lab directory
- `.pire/TARGET.md`: target summary loaded into PiRE context for this lab

## Commands

```bash
make build
make reset
./scripts/run-target.sh ./fixtures/benign-handshake
./scripts/run-pire.sh
```

To point PiRE at the lab with an initial prompt:

```bash
./scripts/run-pire.sh "Reverse the threaded rendezvous gate and recover the proof artifact."
```

## Constraints

- treat `runtime/` as disposable lab state
- do not edit `src/thread_rendezvous_snapshot.c` during analysis unless you are intentionally changing the lab itself
- keep the proof artifact path fixed across runs
- prefer `bin/thread-rendezvous-snapshot-stripped` for discovery and `bin/thread-rendezvous-snapshot` for confirmation
