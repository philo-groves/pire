# Changelog

## [Unreleased]

### Added
- Initial `pi-security-agent` package scaffold.
- Added a styled interactive red-team TUI with a live transcript, tool panels, execution dashboard, and prompt composer.
- Added `/model` and `/effort` interactive commands to inspect and change the active model and reasoning effort without leaving the TUI.
- Added `/login` and `/logout` interactive commands backed by the shared OAuth provider flows used by `coding-agent`, including provider selection and in-TUI login prompts.
- Added a local `/new` command to start a fresh conversation without leaving the TUI.
- Added `/option <letter|number>` as a convenience command that submits `Let's go with option <arg>`.
- Added a local `/graph` command that exports the current research graph state to a self-contained HTML file in the system temp directory and prints a clickable `file://` URL in the TUI.
- Added stored conversation persistence plus `/resume` to reopen previous security-agent sessions from the interactive TUI.
- Added a block-letter startup banner for `Pi for Reverse Engineers` in the interactive TUI.
- Added startup `Recommended Actions` cards that summarize next steps from saved notebook, logic-map, and surface-map research when a workspace already has prior security-agent state.

### Changed
- Made `/graph` export links WSL-aware so displayed file paths and clickable file URLs translate `/mnt/<drive>` paths to Windows drive paths and native WSL paths to `wsl.localhost` UNC URLs.
- Compact the interactive plan panel by removing `[output truncated]` labels from snapshot summaries, collapsing plan step whitespace, and using `Shift+Up`/`Shift+Down` for plan scrolling plus `Shift+Left`/`Shift+Right` for surfaces scrolling.
- Simplified the plan panel to raw terminal lines with no card background, padding, title row, or timestamp row, and fixed it to render every step in each visible phase instead of only the first step.
- Restyled the raw plan panel so phase names render in white, steps render in subdued grey, and both phases and steps use green/grey block markers for derived completion state.
- Added explicit in-progress plan rendering by keeping active plan blocks grey while animating active phase and step text with a subtle loading gradient.
- Animated all unfinished steps inside active parallel phases, hid the hardware cursor during timer-driven plan repaints to avoid cursor flashes on plan lines, and removed the remaining `awaiting X tool execution` assistant filler.
- Added one column of horizontal padding on both sides of the entire chat history above the composer so timeline entries do not sit flush against the terminal edges.
- Right-aligned plain assistant response metadata in place of the old `complete` status label and added a small extra inset to plain assistant response bodies.
- Fixed plain assistant response wrapping so the extra chat-history padding no longer forces right-edge `...` truncation on already-wrapped lines.
- Restyled assistant thinking traces as compact `THOUGHT` cards with a near-black neutral background and padded content, instead of rendering them directly on the terminal background.
- Changed plain assistant metadata from `agent @ ...` to `response @ ...`, and upgraded thinking cards to use a solid grey `THOUGHT` badge with right-aligned `thought @ ...` metadata plus usage when available.
- Changed the `THOUGHT` badge text to white so it matches the solid label treatment used by other tool-style headers.
- Tightened startup recommendation filtering so promoted/validated closed loops and surfaces already covered by confirmed durable findings stop resurfacing as next actions.
- Rendered the executed bash command line in white inside bash tool cards, without changing other tool-card text colors.
- Rendered the first body line of every tool card in white, leaving the remaining tool-card metadata and result text colors unchanged.
- Removed the duplicate secondary summary line from plan tool cards so plan updates only show the phase count once, while clear actions still show `plan cleared`.
- Fixed plan progress state so removed steps and phases turn green as subsequent plan updates complete them, and automatically clear the plan panel once every tracked item is complete.
- Switched the interactive composer and auth prompt inputs to the terminal hardware cursor instead of a static rendered block cursor.
- Switched the security-agent TUI primary accent color from yellow to blue to match the session and resume badges.
- Retinted successful agent response cards, including startup `Recommended Actions`, to a dark blue-black background instead of the older warm yellow-black tone.
- Simplified the startup `Recommended Actions` card by removing the saved-research summary and extra meta line, leaving only lettered action options.
- Included the startup `Recommended Actions` option list in injected workspace context so first-turn references like `option A` or `option 1` resolve correctly.
- Excluded workspace context files like `AGENTS.md` and `CLAUDE.md` from recommendation ranking and future surface/prior seeding so the agent does not target its own instruction files.
- Refreshed startup `Recommended Actions` so they stop resurfacing covered or stale branches, filter out lowered and closed-out paths from prior evidence, and backfill with fresh workspace-graph exploration targets when tracked surfaces are exhausted.
- Collapsed default assistant response cards so the `agent @ ... | usage | cost` metadata line replaces the separate `AGENT response` title row, reducing vertical space without changing custom titles like `Recommended Actions`.
- Render assistant and thinking text through the shared markdown formatter so bold and italic markup is preserved, and render thinking traces as plain grey terminal text without the old titled background card.
- Hide empty assistant placeholder rows while tools are running, and restyle tool result entries as compact filled cards with cleaner per-tool summaries instead of raw JSON-heavy argument dumps.
- Render regular assistant response messages directly on the terminal background without the old padded blue card, while keeping filled-card styling for tool results and other special panels.
- Moved tool timestamps into the top-right tool card header beside the status badge and simplified the tool card body metadata.
- Render assistant unordered-list markdown with `•` bullets instead of leading `-` markers in startup recommendations and agent responses.
- Darkened the plan snapshot panel to an almost-black background without changing the surfaces panel tone.
- Removed the `ARMED` / `LOCKED` footer badge from the interactive TUI.
- Added one column of left padding to the interactive footer metadata row.
- Removed the initial session attachment notice from the interactive startup timeline.
- Replaced the startup banner art with the shorter `Pi for RE` block banner.
