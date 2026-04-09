---
name: browser-runtime-tracing
description: Use when a web task depends on live browser state, renderer-worker boundaries, or client-side decisions that are not clear from static assets alone.
---
# Browser Runtime Tracing

When the decisive state is in a running browser, pivot early from passive recon to runtime observation.

Collect:
- The exact target URL, title, and target type
- Browser-owned state that matters to the current hypothesis
- Evidence of which execution context owns the interesting data: page, iframe, worker, or service worker
- Any session, cache, storage, or CSP state that changes exploitability

Preferred order:
1. Confirm the target inventory.
2. Ask one narrow runtime question with read-only evaluation.
3. Preserve the output and update the hypothesis ledger.
4. Only then expand to additional contexts or network/state questions.

Good questions:
- Is the secret or decision point in client state or server responses?
- Which frame or worker receives attacker-controlled input?
- Which browser boundary must the chain cross after renderer control?

Bad habits:
- Dumping large amounts of browser state without a question
- Confusing DOM access with a completed browser exploit chain
- Repeating the same runtime query after the answer is already preserved
