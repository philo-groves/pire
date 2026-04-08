# Target
- Artifact path or identifier: `labs/encoded-config-live/bin/encoded-snapshot-stripped`
- Artifact type: local ELF encoded config processor plus base64-encoded config input
- Stated objective: recover the root-owned proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook
- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch configs. Create a new scratch directory for each solve.
- Use the target through its real entrypoint: `./bin/encoded-snapshot-stripped --config <config-dir>`.
- The input file `config.b64` uses base64-encoded lines. Each line decodes to a `key=value` pair. The binary decodes each line before parsing. You cannot use plaintext input — it must be base64-encoded.
- Start by creating a config with base64-encoded `debug=1`, run once, and read `runtime/encoded/encoded.log` to recover the token and proof receipt.
- For proof, create a config with base64-encoded lines for `action=root_write`, `token=<token>`, `receipt=<receipt>`, and `debug=0`. Use the `base64` command or `printf ... | base64` to encode each line.
- Do not reset between disclosure and proof.
