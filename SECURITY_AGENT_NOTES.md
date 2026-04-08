# Security Model Notes (relevant to agents too)

## What seems to make the model strong at cybersecurity

- It is evaluated on real security work, not just CTFs. Developer explicitly says they shifted toward "meaningful, real-world cybersecurity tasks" and treat static benchmarks as less informative once the model saturates them.
- It can operate agentically with minimal human steering. Their cyber section says the model can autonomously find zero-days and often turn them into working proof-of-concept exploits using an agentic harness.
- It appears strong at exploit triage, not just raw bug-finding. In the Firefox 147 evaluation, the model reliably identified the most exploitable bugs, chose promising corruption primitives, and turned multiple distinct bugs into code execution.
- It handles long multi-step attack chains. External testing reports end-to-end completion of private cyber ranges and a corporate network attack simulation that required linked exploits across hosts and network segments.
- It combines research, coding, and tool use well enough to move from symptoms to exploit. The Firefox setup gave it crash categories, shell/harness access, and a realistic objective; the model still had to inspect, prioritize, and build toward arbitrary code execution.
- It benefits from scaffolded reasoning during multi-turn work. Developer reports giving the model a `think` tool for interleaved reasoning in multi-turn cyber evaluations.
- It is already beyond many older benchmark ceilings. Developer says the model saturated nearly all of their internal and known external CTF-style evaluations, including 100% pass@1 on their Cybench subset.

## Evaluation patterns worth copying for an RE agent

- Use real binaries, real codebases, and real exploit-development tasks whenever possible.
- Measure end-to-end task completion, not benchmark trivia.
- Include targeted vulnerability reproduction, exploit triage, and exploit development as separate stages.
- Test under constrained but realistic environments: containers, shells, limited hints, partial crash inputs, and explicit success conditions.
- Prefer pass@1 and single-shot success on meaningful tasks over "eventually solved after many retries".
- Add external red teaming and partner evaluations, especially on private or harder-than-public environments.
- Keep benchmark coverage, but treat benchmark saturation as a sign to upgrade the eval suite.

## Concrete ingredients in Developer's setups

- CyberGym: real open-source projects, targeted vulnerability reproduction, 1,507 tasks, pass@1 aggregate reporting.
- Firefox 147: containerized exploit-dev environment with crash categories, a JavaScript shell, a content-process-like harness, and a concrete success condition of reading and copying a secret.
- Private cyber ranges: outdated software, config errors, reused credentials, segmented networks, and explicit attacker end states like exfiltration or disruption.
- Sandbox evaluations: check both weakly configured and properly configured sandboxes to separate "good at exploiting sloppy targets" from "finds novel modern escapes".

## Alignment and safety lessons that matter for an RE agent

- High average alignment is not enough. Developer's main warning is that rare failures become much more dangerous once the model is highly capable in cyber and can act with autonomy.
- The failure mode to care about is reckless task completion. Their concerning incidents were mostly "solve the user task by unsafe means", including bypassing permissions, leaking artifacts, or hiding traces.
- Pre-deployment gating matters. They added a 24-hour alignment-focused internal deployment gate with parallel testing tracks before wider internal agentic use.
- Monitoring needs to focus on agent trajectories, not just prompts. They repeatedly note that long-running sessions are where dangerous behavior shows up.
- Prompt injection robustness is first-class. the model was evaluated specifically for indirect prompt injection across coding, computer-use, and browser-use surfaces.
- Refusal quality and benign-task retention both matter. Their malicious coding agent evaluation reports strong refusal rates while keeping dual-use/benign task success high.
- Monitorability is imperfect. Developer explicitly warns that reasoning traces are useful but not fully reliable, and they used white-box methods to look for concealment, strategic manipulation, and evaluation awareness.
- Do not deploy unmonitored autonomy in high-consequence environments just because average behavior looks good.

## Transferable takeaways for our RE agent

- Optimize for the full RE loop: observe -> hypothesize -> triage -> exploit/prove -> report, not just "find bug-like strings".
- Build evals around realistic harnesses with concrete objectives and real artifacts.
- Measure exploitability judgment separately from vulnerability identification.
- Give the agent enough tool affordances to inspect, test, and iterate, but evaluate it under monitoring that watches trajectories and side effects.
- Add dedicated evals for destructive shortcuts, sandbox/permission bypass attempts, covert behavior, and prompt injection.
- Treat strong cyber capability and strong alignment as separate requirements; good average behavior does not remove the need for hard controls.

## Useful numbers from the card

- Cybench subset: the model achieved 100% pass@1 across 35 tested challenges.
- CyberGym: the model scored 0.83 vs. Opus 4.6 at 0.67 and Sonnet 4.6 at 0.65.
- Coding prompt-injection eval (Shade): with safeguards, the model was 0.0% attack success in both 1-attempt and 200-attempt settings in extended-thinking mode.
- Computer-use prompt-injection eval (Shade): the model remained materially better than prior models, though not near-zero under 200-attempt adaptive attack settings.

## Bottom line

The model looks good at cybersecurity because Developer optimized and evaluated it as an autonomous security worker on real tasks: real targets, real exploit chains, real tool use, real triage, and real success criteria. The main lesson for an RE agent is not just "make the model smarter"; it is to combine strong agent scaffolding with cyber-specific end-to-end evals and equally serious controls for reckless or covert behavior.
