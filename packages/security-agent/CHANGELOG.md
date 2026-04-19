# Changelog

## [Unreleased]

### Added
- Initial `pi-security-agent` package scaffold.
- Added a styled interactive red-team TUI with a live transcript, tool panels, execution dashboard, and prompt composer.
- Added `/model` and `/effort` interactive commands to inspect and change the active model and reasoning effort without leaving the TUI.

### Changed
- Compact the interactive plan panel by removing `[output truncated]` labels from snapshot summaries, collapsing plan step whitespace, and using `Shift+Up`/`Shift+Down` for plan scrolling plus `Shift+Left`/`Shift+Right` for surfaces scrolling.
