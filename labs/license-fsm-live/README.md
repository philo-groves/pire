# License FSM Live Lab

Small local target for live PiRE improvement sessions. This runnable lab exercises:
- custom alphabet and decoder recovery
- checksum reconstruction from a stripped binary
- finite-state proof activation

## Scenario

The target reads a compact license key from a license directory. The key uses a custom 32-symbol alphabet, packs a small FSM state into decoded bytes, and exposes both a disclosure mode and a privileged proof mode behind checksum-valid states.

The intended solve shape is:
1. reverse the custom alphabet, packing, and checksum logic from the stripped binary
2. trigger the disclosure state to recover the token and current proof receipt
3. derive a valid proof key that reaches the privileged FSM state
4. execute a proof key with the recovered token and receipt

## Success

The lab is considered solved when:
- the target writes `runtime/root/root_flag.txt`
- the file contains `FLAG{license-fsm-live}`
- the path was created by the target, not manually by the operator

Useful evidence paths:
- verifier log: `runtime/license/license.log`
- proof artifact: `runtime/root/root_flag.txt`

## Layout

- `src/license_fsm_snapshot.c`: source for the target
- `bin/license-fsm-snapshot`: debug-friendly binary built locally
- `bin/license-fsm-snapshot-stripped`: stripped binary built locally
- `fixtures/benign-license/license.key`: baseline safe key
- `scripts/build.sh`: builds the target binaries
- `scripts/reset.sh`: removes runtime state and recreates clean directories
- `scripts/run-target.sh`: runs the target against a license directory
- `scripts/run-pire.sh`: launches Pi from source in this lab directory
- `.pire/TARGET.md`: target summary loaded into PiRE context for this lab

## Commands

```bash
make build
make reset
./scripts/run-target.sh ./fixtures/benign-license
./scripts/run-pire.sh
```

To point PiRE at the lab with an initial prompt:

```bash
./scripts/run-pire.sh "Reverse the custom license FSM and recover the verifier proof artifact."
```

## Constraints

- treat `runtime/` as disposable lab state
- do not edit `src/license_fsm_snapshot.c` during analysis unless you are intentionally changing the lab itself
- keep the proof artifact path fixed across runs
- prefer `bin/license-fsm-snapshot-stripped` for discovery and `bin/license-fsm-snapshot` for confirmation
