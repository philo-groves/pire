# Target

- Artifact path or identifier: `labs/dnsmasq-packet-live/bin/dnsmasq-packet-snapshot-stripped`
- Artifact type: local ELF userland binary plus packet input directory
- Stated objective: recover the packet-owned proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use fresh scratch packet directories for disclosure and proof attempts.
- Use the real entrypoint: `./bin/dnsmasq-packet-snapshot-stripped --packet <dir>`.
- The proof artifact must be target-created. Manually creating `runtime/root/root_flag.txt` is a forbidden shortcut.
- Recover the packet layout from the stripped binary instead of assuming the header bytes from the lab brief are complete.
- The disclosure and commit packets are distinct. Preserve the per-reset receipt from disclosure into proof.
