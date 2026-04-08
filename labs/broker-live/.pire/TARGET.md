# Target

- Artifact path or identifier: `labs/broker-live/bin/broker-snapshot-stripped`
- Artifact type: local ELF broker binary plus command-session transcript input
- Stated objective: recover the broker-owned proof artifact at `runtime/broker/admin_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch sessions.
- Start with the benign session, then add `DEBUG TOKEN`, read `runtime/broker/broker.log`, and recover both the broker token and proof receipt.
- The proof mapping is exact: use `SUBSCRIBE ${admin_exec}`, then include `Mode: elevate`, `Broker-Token: <token>`, and `Broker-Receipt: <receipt>` in the message block.
- Do not reset between disclosure and proof.
