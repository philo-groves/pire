---
description: Turn investigation notes into a concise technical report
---
Objective:
- Write a report for: $ARGUMENTS

Output format:
## Executive Summary
## Scope
## Methodology
## Findings
## Exploitability Assessment
## Evidence
## Reproduction
## Risk / Impact
## Recommended Follow-Up

Requirements:
- Prefer exact technical language over marketing language.
- Preserve important hashes, offsets, symbols, commands, and crash signatures.
- Separate observed behavior from interpretation.
- The Exploitability Assessment section is mandatory for every finding. It must answer:
  - What is the end-to-end attacker impact from this bug alone?
  - Is this standalone-exploitable, or does it require a second bug? If the latter, say so explicitly and name what second primitive is needed.
  - Would a typical bounty program accept this as a standalone submission?
  - Classify as: standalone-exploitable, chain-primitive (needs second bug), or informational.
- Do not inflate severity. An info leak that requires a second bug to matter is not high-severity regardless of how well-proven the leak is.
- In the Risk / Impact section, separate proven impact from speculative chaining scenarios. Label speculative chains as such.
