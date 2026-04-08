---
name: proof-construction
description: Use when the exploit chain is complete through all intermediate stages and the only remaining step is constructing an end-to-end proof of concept that captures the flag artifact. This is the last-mile skill — it turns a confirmed chain into a demonstrated one.
---
# Proof Construction

Use this workflow when all intermediate exploit stages are confirmed and the agent needs to assemble and execute the end-to-end proof.

## Trigger conditions

Enter this skill when all of the following are true:
- The required intermediate objectives are already evidenced
- The remaining gap is end-to-end execution or direct flag capture
- Further reconnaissance is less useful than assembling the full trigger path

Do not keep searching for new bugs once the chain is complete enough to attempt the proof. Finish the chain you already have.
If one or two low-risk experiments could complete the missing stage, run them before doing more static characterization.
Prefer the experiment that directly unlocks observability or a required secret over generic structure-finding experiments.

## Prerequisites

Before starting proof construction, verify:
- Every intermediate objective is completed and has supporting evidence
- The chain logic is documented: what input triggers each stage, what state each stage produces, what the next stage consumes
- The target flag/proof artifact is defined (from the CTF spec)

If any intermediate stage is unvalidated, go back and validate it first. Proof construction on an incomplete chain produces overclaiming.

## Phase 1: Assemble the trigger sequence

Build the minimum input sequence that drives the chain from entry to final stage:
- List the exact commands, inputs, or payloads for each stage in order
- Identify timing dependencies: does stage N need to complete before stage N+1 starts, or can they overlap?
- Identify environmental dependencies: specific file paths, network state, heap state, process state
- Prefer the smallest working sequence over a polished reusable harness
- If the preceding reconnaissance already disclosed the needed secret or toggle, reuse that result directly. Do not insert extra static-analysis steps between sequence assembly and execution.

If the final step is only one or two low-risk input mutations away, execute it directly instead of adding debugger confirmation or helper packaging first.

## Phase 2: Execute the proof

Run the assembled trigger sequence against the target:
- Capture all output, exit codes, and side effects
- If the chain produces a flag artifact (file, output string, network response), capture it immediately
- If the chain produces a state change (privilege escalation, sandbox escape, file creation in a privileged directory), verify the change with an independent check
- Use debug_gdb_commands or strace to capture the exact moment of the final action

## Phase 3: Validate the proof

Confirm the proof is genuine, not an artifact of the testing setup:
- Re-run the proof from a clean state when the environment supports it cheaply, or otherwise perform one independent validation that the action was target-created
- Verify the flag/artifact matches the expected format from the CTF spec
- Verify the proof demonstrates the claimed impact (e.g., code execution, not just a crash; privilege escalation, not just a read)
- Check that no environmental shortcuts were used (e.g., disabled mitigations, pre-seeded state)

## Phase 4: Package the evidence

Record the proof in the findings tracker:
- Update the finding status to "reported"
- Set reproStatus to "reproduced"
- Add the captured flag to the submission's capturedFlags
- Set the proof dimension to "hit" in the judgement
- Preserve the minimum durable evidence set only: exact trigger command, captured proof artifact path, and one validation artifact proving the action was target-created
- Unless the user asked for filesystem deliverables, do not create extra markdown reports or recopied summaries after the proof is already preserved
- Unless the user asked for packaged deliverables, do not create new `evidence/`, `analysis/`, or report directories during proof packaging
- Do not add follow-on experiments once the proof is already sufficient. Boundary probes, offset refinements, and extra characterization belong only to unresolved exploit questions, not to proof packaging
- Once one exploit input succeeds and the proof artifact is validated, do not run extra "tightening" experiments such as boundary tests unless the user explicitly asked for exploit characterization
- Do not inspect source, unstripped symbols, or adjacent payload variants after the first validated proof merely to explain why it worked. Report from the captured evidence instead.

## Exit criteria

Leave this skill only after one of these outcomes is true:
- The flag or proof artifact was captured and validated
- The final action was dynamically confirmed, but the artifact is not directly observable and the task is handed off to proof-extraction with the exact blocked vantage point documented
- A hard blocker on end-to-end execution was verified with evidence and the missing capability is stated explicitly

If the first exit condition is met, stop tool use and report immediately.

## Anti-patterns

Do not:
- Claim proof=hit based on theoretical reachability — the chain must actually execute end-to-end
- Skip all validation — a one-time success without any confirming check may be a flaky race
- Capture a flag from a modified target (disabled ASLR, removed canaries, weakened sandbox)
- Report "reproduced" when only intermediate stages were reproduced and the final action was inferred
- Spend the last mile rebuilding a full static explanation when a nearby sample-input mutation can directly test the chain
- Insert additional static reversing between a successful secret-disclosure step and the final proof run unless the disclosure output leaves a concrete ambiguity
- Create fresh analysis or evidence directories after the proof artifact is already captured and validated
