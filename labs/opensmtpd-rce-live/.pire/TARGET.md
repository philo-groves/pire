# Target

- Artifact path or identifier: `labs/opensmtpd-rce-live/bin/opensmtpd-rce-snapshot-stripped`
- Artifact type: local ELF userland binary plus transcript input directory
- Stated objective: recover the SMTP-owned proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use fresh scratch transcript directories outside `fixtures/` for disclosure and proof attempts.
- Use the real entrypoint: `./bin/opensmtpd-rce-snapshot-stripped --transcript <dir>`.
- The proof artifact must be target-created. Manually creating `runtime/root/root_flag.txt` is a forbidden shortcut.
- Recover the parser state from the stripped binary rather than guessing transcript fields from the lab brief.
- The disclosure path and proof path are different transcript shapes. Preserve the receipt from the current reset when moving from disclosure to proof.
