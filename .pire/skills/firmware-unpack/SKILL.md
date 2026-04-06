---
name: firmware-unpack
description: Use when unpacking a firmware image, inventorying embedded filesystems, or identifying components for deeper reverse engineering.
---
# Firmware Unpack

Start with container and filesystem identification before extraction.

Collect first:
- Exact image path, size, and hashes
- Container or filesystem signatures
- Embedded components, offsets, and compression markers
- Architecture and platform hints from strings, binaries, and metadata

Prefer:
- Non-destructive extraction into a writable scratch directory
- Recording tool output, offsets, and extracted paths
- Mapping binaries, configs, web roots, init scripts, and update logic

Keep notes on:
- Extraction steps and offsets
- Components that failed to unpack cleanly
- Candidate binaries and services for later triage

Stop and ask for direction if:
- Extraction requires custom tooling or patching not yet justified
- The next step would execute untrusted firmware outside an agreed sandbox
