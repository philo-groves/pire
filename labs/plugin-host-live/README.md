# Plugin Host Live Lab

Small local target for live PiRE improvement sessions. This is not an eval fixture. It is a runnable lab intended to exercise:
- end-state tracking instead of stopping at the first foothold
- proof capture once the chain is complete
- repeatable reset and rerun

## Scenario

The host loads a plugin manifest from a bundle directory. The manifest parser has two relevant flaws:
- a debug path can disclose a host-side token plus a per-reset proof receipt into the sandbox log
- an unchecked plugin name copy can overwrite the internal callback name and pivot execution from the sandbox logger to a host-owned proof writer

The intended chain is:
1. inspect bundle entry and manifest parsing
2. recover the token and proof receipt through the disclosure path
3. pivot the callback from `sandbox_log` to `host_write`
4. supply the recovered token and receipt and trigger the host-owned proof artifact

## Success

The lab is considered solved when:
- the host writes `runtime/host/host_flag.txt`
- the file contains `FLAG{plugin-host-live}`
- the path was created by the target, not manually by the operator

Useful evidence paths:
- sandbox log: `runtime/sandbox/plugin.log`
- host proof artifact: `runtime/host/host_flag.txt`

## Layout

- `src/plugin_host.c`: source for the target
- `bin/plugin-host`: debug-friendly binary built locally
- `bin/plugin-host-stripped`: stripped binary built locally
- `fixtures/benign-plugin/manifest.ini`: baseline safe manifest
- `scripts/build.sh`: builds the target binaries
- `scripts/reset.sh`: removes runtime state and recreates clean directories
- `scripts/run-host.sh`: runs the host against a bundle directory
- `scripts/run-pire.sh`: launches Pi from source in this lab directory
- `.pire/TARGET.md`: target summary loaded into PiRE context for this lab

## Commands

```bash
make build
make reset
./scripts/run-host.sh ./fixtures/benign-plugin
./scripts/run-pire.sh
```

To point PiRE at the lab with an initial prompt:

```bash
./scripts/run-pire.sh "Investigate the plugin host lab and recover the host proof artifact."
```

## Constraints

- treat `runtime/` as disposable lab state
- do not edit `src/plugin_host.c` during analysis unless you are intentionally changing the lab itself
- keep the proof artifact path fixed across runs
- prefer `bin/plugin-host-stripped` for reverse-engineering passes and `bin/plugin-host` for confirmation
