# Dnsmasq Packet Live Lab

Small local target for live PiRE improvement sessions. This runnable lab exercises:
- packet format recovery
- parser-state reconstruction
- staged disclosure before proof

## Scenario

The target consumes a hex-encoded packet directory. The stripped binary parses a compact pseudo-DNS packet, records header and payload state, exposes a disclosure path for one packet class, and hides a privileged proof path behind a different packet class plus a response derived from the secret token.

The intended solve shape is:
1. reverse the packet layout and field meanings from the stripped binary
2. trigger the disclosure path to recover the token and current proof receipt
3. recover the privileged packet state and computed response
4. submit a proof packet plus the recovered token and receipt to reach the privileged action

## Success

The lab is considered solved when:
- the target writes `runtime/root/root_flag.txt`
- the file contains `FLAG{dnsmasq-packet-live}`
- the path was created by the target, not manually by the operator

Useful evidence paths:
- service log: `runtime/dnsmasq/dnsmasq.log`
- proof artifact: `runtime/root/root_flag.txt`

## Layout

- `src/dnsmasq_packet_snapshot.c`: source for the target
- `bin/dnsmasq-packet-snapshot`: debug-friendly binary built locally
- `bin/dnsmasq-packet-snapshot-stripped`: stripped binary built locally
- `fixtures/benign-packet/packet.hex`: baseline safe packet
- `scripts/build.sh`: builds the target binaries
- `scripts/reset.sh`: removes runtime state and recreates clean directories
- `scripts/run-target.sh`: runs the target against a packet directory
- `scripts/run-pire.sh`: launches Pi from source in this lab directory
- `.pire/TARGET.md`: target summary loaded into PiRE context for this lab

## Commands

```bash
make build
make reset
./scripts/run-target.sh ./fixtures/benign-packet
./scripts/run-pire.sh
```

To point PiRE at the lab with an initial prompt:

```bash
./scripts/run-pire.sh "Reverse the packet format and recover the proof artifact."
```

## Constraints

- treat `runtime/` as disposable lab state
- do not edit `src/dnsmasq_packet_snapshot.c` during analysis unless you are intentionally changing the lab itself
- keep the proof artifact path fixed across runs
- prefer `bin/dnsmasq-packet-snapshot-stripped` for discovery and `bin/dnsmasq-packet-snapshot` for confirmation
