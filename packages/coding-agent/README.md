# PiRE

PiRE is a terminal coding and research agent focused on reverse engineering, vulnerability research, exploit development, and evaluation-driven agent improvement.

It keeps the core coding-agent ergonomics of the underlying harness, but the repo and default workflow are oriented around:

- binary and protocol reversing
- live-lab capability measurement
- audited eval runs with proof validation
- research profiles layered through `.pire/`
- extensions, skills, prompts, and themes for security work

PiRE runs on Linux, macOS, and Windows with a bash shell.

## Installation

```bash
npm install -g @philogroves/pire
```

Then launch it with:

```bash
pire
```

For a one-shot run:

```bash
pire -p "Summarize the reversing target and propose an initial plan."
```

## What PiRE Adds

PiRE is not just a rename. This repo layers a research-focused profile and eval harness on top of the coding agent runtime.

The key PiRE-specific pieces are:

- `.pire/` profile loading for system prompts, append prompts, skills, prompts, and extensions
- binary-RE and live-lab evaluation helpers
- audited live-lab runs with shortcut detection
- RE/security-oriented commands, reporting, and campaign tracking
- live labs for static RE, runtime RE, and stateful-runtime failures

If you are working inside a repository that contains a `.pire/` directory, PiRE automatically discovers:

- `.pire/SYSTEM.md`
- `.pire/APPEND_SYSTEM.md`
- `.pire/TARGET.md`
- `.pire/NOTES.md`
- `.pire/prompts/`
- `.pire/skills/`
- `.pire/extensions/`

## Quick Start

Interactive:

```bash
pire
pire "Review the target and identify likely attack surfaces."
pire @notes.md @artifact.txt "Build a concise exploit plan."
```

Print mode:

```bash
pire -p "List likely bug classes in this binary."
cat README.md | pire -p "Summarize this target description."
```

Sessions:

```bash
pire -c
pire -r
pire --session <path-or-id>
pire --fork <path-or-id>
pire --no-session
```

## Core Tools

By default PiRE exposes:

- `read`
- `webfetch`
- `bash`
- `edit`
- `write`

You can restrict tools for safer review flows:

```bash
pire --tools read,grep,find,ls -p "Audit this codebase without editing."
```

## Models and Providers

PiRE supports the same provider/model system as the underlying coding agent runtime. You can select a model directly:

```bash
pire --provider openai --model gpt-4o
pire --model openai/gpt-4o
pire --model sonnet:high
pire --models "anthropic/*,openai/gpt-4o"
```

Custom providers and models can be configured through:

- `~/.pi/agent/models.json`
- extensions

Use `/model` in interactive mode to switch models.

## Reverse Engineering Workflow

PiRE is designed for workflows like:

1. triage the target
2. collect disclosure artifacts
3. decide whether the task is static, runtime, or stateful-runtime
4. avoid shortcut paths and answer-key files
5. produce a target-created proof artifact
6. score the run with eval helpers

The current lab/eval process is documented in [EVALUATION.md](../../EVALUATION.md).

Important categories used in this repo:

- `static-re`
- `runtime-re`
- `stateful-runtime`

## Live Labs and Evals

This repo includes a substantial live-lab harness. The important entrypoints are:

- `pire-evals`
- `pire-eval-scaffold`
- `pire-live-labs`

Examples:

```bash
pire-live-labs --help
pire-live-labs --sweep re-tier --json
pire-live-labs --sweep runtime-tier --json
pire-live-labs --sweep failure-tier --json
```

The harness supports:

- audited session capture
- shortcut detection
- proof classification
- benign-path validation
- sweep tiers for stronger regression tracking

For repo-level eval guidance, lab authoring rules, and scoring expectations, read [EVALUATION.md](../../EVALUATION.md).

## PiRE Profile Layout

PiRE uses `.pire/` for project-local research behavior. Typical structure:

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

This is separate from the normal config/session directory under `~/.pi/agent/`.

## Global and Project Config

PiRE keeps the existing config storage layout:

- global settings: `~/.pi/agent/settings.json`
- project settings: `.pi/settings.json`
- sessions: `~/.pi/agent/sessions/`

That is intentional. The repo already uses `.pire/` as a project-local research profile, so `.pi/` remains the general config namespace.

## Prompt Templates

Prompt templates are Markdown files loaded from:

- `~/.pi/agent/prompts/`
- `.pi/prompts/`
- `.pire/prompts/`

Example:

```md
---
description: Audit a target for likely memory corruption issues
---

Review this target for memory corruption issues. Focus on:
- ownership and lifetime mistakes
- untrusted length fields
- parser state inconsistencies
- obvious proof and shortcut boundaries
```

## Skills

Skills are loaded from:

- `~/.pi/agent/skills/`
- `~/.agents/skills/`
- `.pi/skills/`
- `.pire/skills/`
- `.agents/skills/`

Each skill lives in a directory with `SKILL.md`.

## Extensions

Extensions are TypeScript modules that can:

- register tools
- register slash commands
- hook agent/tool/session events
- add UI components
- add provider integrations

They can live in:

- `~/.pi/agent/extensions/`
- `.pi/extensions/`
- `.pire/extensions/`
- installed packages

The published extension API is imported from:

```ts
import type { ExtensionAPI } from "@philogroves/pire";
```

## Packages

PiRE supports installable packages for extensions, skills, prompts, and themes:

```bash
pire install npm:@foo/pire-tools
pire install npm:@foo/pire-tools@1.2.3
pire install git:github.com/user/repo
pire remove npm:@foo/pire-tools
pire uninstall npm:@foo/pire-tools
pire update
pire list
pire config
```

Packages install globally under the agent directory or project-locally with `-l`.

## RPC and SDK Use

You can use PiRE headlessly:

```bash
pire --mode rpc
```

Or consume the package programmatically:

```ts
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@philogroves/pire";
```

This package exposes the same core runtime pieces used by the CLI.

## CLI Synopsis

```bash
pire [options] [@files...] [messages...]

pire install <source> [-l]
pire remove <source> [-l]
pire uninstall <source> [-l]
pire update [source]
pire list
pire config
```

Useful flags:

- `--print`, `-p`
- `--provider`
- `--model`
- `--models`
- `--thinking`
- `--session`
- `--fork`
- `--session-dir`
- `--no-session`
- `--tools`
- `--offline`
- `--list-models`

Run `pire --help` for the full CLI help text.

## Environment Variables

Common variables:

| Variable | Meaning |
| --- | --- |
| `PIRE_CODING_AGENT_DIR` | Override the agent directory (default: `~/.pi/agent`) |
| `PIRE_PACKAGE_DIR` | Override package asset directory |
| `PIRE_OFFLINE` | Disable startup network operations |
| `PIRE_SKIP_VERSION_CHECK` | Disable version checks |
| `PIRE_SHARE_VIEWER_URL` | Base URL for `/share` |
| `PIRE_AI_ANTIGRAVITY_VERSION` | Override Antigravity User-Agent version |

Provider API keys are still the usual provider-specific env vars such as:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `OPENROUTER_API_KEY`

## Themes

Themes are loaded from:

- built-in themes
- `~/.pi/agent/themes/`
- `.pi/themes/`
- installed packages

Use `/theme` in interactive mode to switch themes.

## Documentation

Useful docs in this package:

- [docs/extensions.md](docs/extensions.md)
- [docs/skills.md](docs/skills.md)
- [docs/prompt-templates.md](docs/prompt-templates.md)
- [docs/themes.md](docs/themes.md)
- [docs/sdk.md](docs/sdk.md)
- [docs/rpc.md](docs/rpc.md)
- [docs/models.md](docs/models.md)
- [docs/custom-provider.md](docs/custom-provider.md)

Repo-level guidance:

- [EVALUATION.md](../../EVALUATION.md)

## Philosophy

PiRE is intentionally opinionated in a different direction than a generic coding assistant. The goal is not just code generation. The goal is measurable research capability:

- can it reverse unfamiliar targets
- can it avoid shortcuts
- can it handle runtime state
- can it produce target-validated proof
- can we track improvements and failures over time

That is why the repo invests so heavily in labs, audited runs, and eval harnessing.
