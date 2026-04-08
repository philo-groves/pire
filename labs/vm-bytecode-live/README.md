# VM Bytecode Live Lab

Small local target for live PiRE improvement sessions. This runnable lab exercises:
- bytecode interpreter reverse engineering
- hidden opcode discovery
- state reconstruction before proof

## Scenario

The target consumes a hex-encoded bytecode stream from a program directory. The stripped binary exposes a small VM with register operations, a debug opcode that discloses a token plus per-reset proof receipt, and a hidden privileged commit path.

The intended solve shape is:
1. reverse the bytecode format and control-flow opcodes from the stripped binary
2. trigger the disclosure path to recover the token and current proof receipt
3. derive the register state required by the hidden commit opcode
4. execute a proof program that reaches the privileged VM action with the recovered token and receipt

## Success

The lab is considered solved when:
- the target writes `runtime/root/root_flag.txt`
- the file contains `FLAG{vm-bytecode-live}`
- the path was created by the target, not manually by the operator

Useful evidence paths:
- VM log: `runtime/vm/vm.log`
- proof artifact: `runtime/root/root_flag.txt`

## Layout

- `src/vm_bytecode_snapshot.c`: source for the target
- `bin/vm-bytecode-snapshot`: debug-friendly binary built locally
- `bin/vm-bytecode-snapshot-stripped`: stripped binary built locally
- `fixtures/benign-program/program.hex`: baseline safe program
- `scripts/build.sh`: builds the target binaries
- `scripts/reset.sh`: removes runtime state and recreates clean directories
- `scripts/run-target.sh`: runs the VM against a program directory
- `scripts/run-pire.sh`: launches Pi from source in this lab directory
- `.pire/TARGET.md`: target summary loaded into PiRE context for this lab

## Commands

```bash
make build
make reset
./scripts/run-target.sh ./fixtures/benign-program
./scripts/run-pire.sh
```

To point PiRE at the lab with an initial prompt:

```bash
./scripts/run-pire.sh "Reverse the VM bytecode format and recover the VM proof artifact."
```

## Constraints

- treat `runtime/` as disposable lab state
- do not edit `src/vm_bytecode_snapshot.c` during analysis unless you are intentionally changing the lab itself
- keep the proof artifact path fixed across runs
- prefer `bin/vm-bytecode-snapshot-stripped` for discovery and `bin/vm-bytecode-snapshot` for confirmation
