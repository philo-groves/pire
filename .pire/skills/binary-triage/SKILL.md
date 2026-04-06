---
name: binary-triage
description: Use when triaging an executable, library, object file, or firmware component and the next step is to identify format, architecture, protections, and obvious analysis pivots.
---
# Binary Triage

Start with low-risk inventory. Prefer commands such as `file`, hashes, `readelf`, `objdump`, `nm`, `strings`, and hex inspection before mutation.

Collect first:
- Exact path and file size
- Cryptographic hashes if available
- Binary format, architecture, endianness, linkage, and interpreter
- Symbols, sections, imports, exports, and embedded strings
- Security properties such as PIE, NX, RELRO, canaries, and stripping status

Keep notes on:
- Commands run
- Artifacts generated
- Suspicious strings, symbols, and offsets
- Candidate entry points for deeper static or dynamic analysis

Stop and ask for direction if:
- Analysis requires executing an untrusted sample outside an agreed sandbox
- The sample appears packed, encrypted, or requires a specific emulation target you do not have
