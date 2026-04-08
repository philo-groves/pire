# Target

- Artifact path or identifier: `labs/image-decoder-live/bin/decoder-snapshot-stripped`
- Artifact type: local ELF image decoder binary plus header config input
- Stated objective: recover the decoder-owned proof artifact at `runtime/decoder/decode_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch headers, but do not trust pre-existing `tmp/` headers from older runs. Create a new scratch directory for the current solve before disclosure or proof.
- Use the target through its real entrypoint: `./bin/decoder-snapshot-stripped --header <header-dir>`.
- Start from the benign header, then set `debug_header=1`, run once, and read `runtime/decoder/decoder.log` to recover both the image token and proof receipt.
- The vulnerability is an integer truncation in dimension validation. Study how `validate_dimensions` computes and casts the pixel total to understand how large dimensions can wrap to a small value, bypassing the size gate.
- The proof mapping is exact: choose `width` and `height` whose product wraps the `unsigned short` cast to a value at or below 4096 (for example `width=256` and `height=256` wraps to zero), set `channel=raw_write`, provide `token=<token>` plus `receipt=<receipt>`, and keep `debug_header=0` on the proof header so the receipt is not rotated again.
- Do not reset between disclosure and proof.
