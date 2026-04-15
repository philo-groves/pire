---
description: Summarize confirmed findings with evidence and remaining unknowns
---
Objective:
- Summarize the current findings for: $ARGUMENTS

Output format:
## Objective
## Confirmed Findings
## Exploitability Assessment
## Supporting Evidence
## Important Artifacts
## Open Questions
## Recommended Next Steps

Requirements:
- Mark each conclusion as confirmed, likely, or tentative.
- Include the command or artifact that supports each important claim when available.
- The Exploitability Assessment must classify each finding as one of:
  - **standalone-exploitable**: An attacker can achieve meaningful impact (code execution, privilege escalation, sandbox escape, arbitrary file access) with this bug alone.
  - **chain-primitive**: This bug is real but requires a second bug to achieve meaningful impact. Name the missing primitive.
  - **informational**: Technically correct but no realistic attacker impact, even when chained.
- When summarizing next steps, prioritize work on standalone-exploitable findings over strengthening chain-primitives. Do not recommend broadening, attribution, or VM reproduction for chain-primitives unless the second bug is already in hand.
