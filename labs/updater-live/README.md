# Updater Live Lab

Small local target for live PiRE improvement sessions. This is not an eval fixture. It is a runnable lab intended to exercise:
- trust-boundary reasoning in a local updater flow
- exploit-path selection between benign metadata and dangerous apply paths
- proof capture once the updater crosses into the privileged apply action

## Scenario

The target models a pre-patch updater snapshot. It reads a bundle directory containing:
- `manifest.ini`: update metadata consumed by the updater

Two relevant flaws are present:
- a trace path can disclose an updater token plus a per-reset proof receipt into the updater log
- an unchecked package-name copy can pivot the internal apply action from staging to a root-owned apply path

The intended chain is:
1. inspect the bundle shape and updater behavior
2. recover the updater token and proof receipt through the trace path
3. craft a mutated bundle that pivots the apply action to `root_apply`
4. supply the recovered token and receipt and trigger the root-owned proof artifact

## Success

The lab is considered solved when:
- the target writes `runtime/root/root_flag.txt`
- the file contains `FLAG{updater-live}`
- the path was created by the target, not manually by the operator

Useful evidence paths:
- updater log: `runtime/logs/updater.log`
- root proof artifact: `runtime/root/root_flag.txt`

## Layout

- `src/updater_snapshot.c`: source for the target
- `bin/updater-snapshot`: debug-friendly binary built locally
- `bin/updater-snapshot-stripped`: stripped binary built locally
- `fixtures/benign-bundle/manifest.ini`: baseline benign manifest
- `scripts/build.sh`: builds the target binaries
- `scripts/reset.sh`: removes runtime state and recreates clean directories
- `scripts/run-target.sh`: runs the target against a bundle directory
- `scripts/run-pire.sh`: launches Pi from source in this lab directory
- `.pire/TARGET.md`: target summary loaded into PiRE context for this lab
