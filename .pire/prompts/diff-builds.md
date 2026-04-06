---
description: Compare two builds or binaries and identify security-relevant deltas
---
Objective:
- Compare these builds or artifacts: $ARGUMENTS

Output format:
## Objective
## Known Facts
## Unknowns
## Comparison Plan
## Commands To Run
## Findings
## Security-Relevant Deltas
## Next Hypotheses

Requirements:
- Focus on architecture, symbols, sections, imports, mitigations, protocol handlers, and changed attack surface.
- Preserve exact hashes, sizes, timestamps, and paths for both artifacts.
