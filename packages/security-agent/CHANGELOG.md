# Changelog

## [Unreleased]

### Added
- Initial `pi-security-agent` package scaffold.
- Added a styled interactive red-team TUI with a live transcript, tool panels, execution dashboard, and prompt composer.
- Added `/model` and `/effort` interactive commands to inspect and change the active model and reasoning effort without leaving the TUI.
- Added `/login` and `/logout` interactive commands backed by the shared OAuth provider flows used by `coding-agent`, including provider selection and in-TUI login prompts.
- Added a local `/new` command to start a fresh conversation without leaving the TUI.
- Added a block-letter startup banner for `Pi for Reverse Engineers` in the interactive TUI.

### Changed
- Compact the interactive plan panel by removing `[output truncated]` labels from snapshot summaries, collapsing plan step whitespace, and using `Shift+Up`/`Shift+Down` for plan scrolling plus `Shift+Left`/`Shift+Right` for surfaces scrolling.
- Switched the interactive composer and auth prompt inputs to the terminal hardware cursor instead of a static rendered block cursor.
