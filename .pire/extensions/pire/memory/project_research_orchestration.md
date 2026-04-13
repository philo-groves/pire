---
name: research-orchestration-gameplan
description: Gameplan for Claude Code orchestrating PiRE security research sessions across ~/research workspace, referencing prior work in ~/security-research and ~/bug-bounty
type: project
---

## Research Orchestration Gameplan

Claude Code acts as strategic orchestrator for PiRE sessions in ~/research.

### Operating model
- After each PiRE run, user says "review the session" → I read state → write next brief
- Session briefs go to ~/research as initial PiRE messages
- I track cross-workspace findings (~/security-research, ~/bounty, ~/bug-bounty)

### Existing research assets (as of 2026-04-13)
- ~/bug-bounty has 20+ findings (W1-W7, S1-S4, R1, F1, K1-K20, C1, E1, G1, I1)
  - G1: GPU TOCTOU → chained kernel write with controllable size, confirmed on iPhone from sandbox — HIGHEST VALUE
  - K13: immutability bypass in child process, confirmed with PoC
  - K16: coalition_info missing authz, confirmed on real iOS from sandbox
  - K1: lio_listio + process exit race → kernel watchdog panic, confirmed
  - S1: darwin notify zero access control, confirmed on real iPhone
  - S4: securityd entitlement bypass, confirmed on iOS
  - E1: full surveillance suite from sandbox, 9 channels, confirmed
  - W1-W4: WebKit findings, multiple confirmed
- ~/security-research has 10 session findings (find-001 to find-010)
  - find-004 + find-008: flow-divert chain, report-candidate
  - find-010: rapport IDS injection, active but hitting entitlement gates
  - 53+ domain findings in backlog across kernel subsystems

### Priority for new sessions
1. Package G1 (GPU TOCTOU kernel write) for submission — highest bounty potential
2. Package flow-divert chain (find-004 + find-008) for submission
3. Fresh kernel attack surface exploration (Skywalk channels, new XNU areas)
4. De-escalated finding re-evaluation with new primitives

**Why:** preference toward shipping confirmed → reportable over discovering new leads.
**How to apply:** first sessions should focus on proof packaging and report writing for the strongest confirmed findings.
