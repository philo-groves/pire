# PiRE Monorepo

PiRE is a research-oriented fork of the pi stack. The main direction of this repo is no longer a generic coding-agent monorepo; it is a runtime and evaluation harness for reverse engineering, vulnerability research, exploit-development workflows, and measurable agent improvement.

> **Looking for the CLI?** Start with **[packages/coding-agent](packages/coding-agent)**.

The repo currently centers on:

- a terminal coding and research agent with project-local `.pire/` profiles
- subagent delegation with isolated context, persistent handles, and interactive/RPC controls
- reverse-engineering and live-lab workflows
- audited eval runs, proof validation, and regression tracking
- reusable lower-level packages for models, agent runtimes, TUI, web UI, and deployment tooling

## Project Direction

PiRE is optimized for questions like:

- can the agent reverse unfamiliar targets instead of just summarize code
- can it avoid shortcut paths and answer-key artifacts
- can it preserve clean context while delegating bounded work to subagents
- can it produce target-backed proof, not just plausible analysis
- can capability changes be measured with repeatable evals instead of anecdotes

That direction shows up in three places across the repo:

1. `packages/coding-agent` provides the main PiRE CLI/runtime, including `.pire/` discovery, research workflows, and subagent orchestration.
2. `EVALUATION.md` and the shipped eval/lab harness define how runs are scored, audited, and compared over time.
3. The supporting packages remain reusable, but they now primarily serve the PiRE runtime and its research workflows.

## PiRE Highlights

- Project-local `.pire/` profiles for `SYSTEM.md`, `APPEND_SYSTEM.md`, `TARGET.md`, `NOTES.md`, prompts, skills, and extensions
- Built-in subagents with max depth 2, persistent handles, progress streaming, and interactive/RPC controls
- Research-oriented commands, artifact tracking, reporting, and repro-bundle workflows
- Binary-RE, runtime, and stateful-runtime evaluation helpers
- Live-lab infrastructure for audited session capture, shortcut detection, proof classification, and baseline comparisons

For the full CLI workflow, install instructions, and PiRE-specific runtime details, read [packages/coding-agent/README.md](packages/coding-agent/README.md).

## Research Workflow

If you are working in a PiRE-enabled target repo, the important local surface is usually:

```text
.pire/
  SYSTEM.md
  APPEND_SYSTEM.md
  TARGET.md
  NOTES.md
  prompts/
  skills/
  extensions/
```

That project-local profile layers target-specific instructions and tools on top of the normal agent/session config under `~/.pire/agent/`.

Repo-level eval and lab guidance lives in [EVALUATION.md](EVALUATION.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).

## Development

```bash
npm install          # Install all dependencies
npm run build        # Build all packages
npm run check        # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
./pire-test.sh         # Run pire from sources (can be run from any directory)
```

> **Note:** `npm run check` requires `npm run build` to be run first. The web-ui package uses `tsc` which needs compiled `.d.ts` files from dependencies.

If you are contributing to the PiRE runtime or eval harness:

- read [AGENTS.md](AGENTS.md) for repo-specific development rules
- read [EVALUATION.md](EVALUATION.md) for lab/eval workflow and fixture guidance
- use package-local changelogs under `packages/*/CHANGELOG.md`

## License

MIT
