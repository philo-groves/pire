# Sudo Argv Live Lab

Small local target for live PiRE improvement sessions. This runnable lab exercises:
- argv and env reconstruction
- local privilege-boundary reasoning
- staged disclosure before proof

## Scenario

The target consumes a command directory containing synthetic argv and env snapshots. The stripped binary reconstructs a sudo-like invocation state, exposes a debug disclosure path for one argument/environment shape, and hides a privileged commit path behind a different combination of argument count, escape pressure, and computed response.

The intended solve shape is:
1. reverse the argv/env parsing logic from the stripped binary
2. trigger the disclosure path to recover the token and current proof receipt
3. derive the hidden response required by the privileged path
4. submit a proof command directory plus the recovered token and receipt to reach the privileged action

## Success

The lab is considered solved when:
- the target writes `runtime/root/root_flag.txt`
- the file contains `FLAG{sudo-argv-live}`
- the path was created by the target, not manually by the operator

Useful evidence paths:
- service log: `runtime/sudo/sudo.log`
- proof artifact: `runtime/root/root_flag.txt`

## Layout

- `src/sudo_argv_snapshot.c`: source for the target
- `bin/sudo-argv-snapshot`: debug-friendly binary built locally
- `bin/sudo-argv-snapshot-stripped`: stripped binary built locally
- `fixtures/benign-command/args.txt`: baseline safe argv snapshot
- `fixtures/benign-command/env.txt`: baseline safe env snapshot
- `scripts/build.sh`: builds the target binaries
- `scripts/reset.sh`: removes runtime state and recreates clean directories
- `scripts/run-target.sh`: runs the target against a command directory
- `scripts/run-pire.sh`: launches Pi from source in this lab directory
- `.pire/TARGET.md`: target summary loaded into PiRE context for this lab

## Commands

```bash
make build
make reset
./scripts/run-target.sh ./fixtures/benign-command
./scripts/run-pire.sh
```

To point PiRE at the lab with an initial prompt:

```bash
./scripts/run-pire.sh "Reverse the sudo argv parser and recover the proof artifact."
```

## Constraints

- treat `runtime/` as disposable lab state
- do not edit `src/sudo_argv_snapshot.c` during analysis unless you are intentionally changing the lab itself
- keep the proof artifact path fixed across runs
- prefer `bin/sudo-argv-snapshot-stripped` for discovery and `bin/sudo-argv-snapshot` for confirmation
