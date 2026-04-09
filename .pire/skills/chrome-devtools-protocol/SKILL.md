---
name: chrome-devtools-protocol
description: Use when a local browser, WebView, or automation target exposes a Chrome DevTools Protocol endpoint and runtime browser state matters.
---
# Chrome DevTools Protocol

Treat CDP as a runtime evidence source, not a shortcut to skip basic target understanding.

Start with:
- `/json/version` to confirm protocol version and browser websocket endpoint
- `/json/list` to inventory page, iframe, worker, and service-worker targets
- A precise target pick based on URL, title, and type before running commands

Prefer first:
- Read-only `Runtime.evaluate` with `throwOnSideEffect=true`
- Inspecting browser-owned state such as `location.href`, `document.readyState`, storage/session indicators, and obvious app globals
- Preserving raw target inventory and evaluation transcripts as artifacts

Use CDP to answer concrete questions:
- Which page or worker actually owns the vulnerable workflow?
- Is the decisive state in DOM, JS heap, storage, or a worker instead of the network trace alone?
- Does the browser expose a privileged broker, extension, or WebView boundary that changes exploit distance?

Do not:
- Fire broad mutating CDP commands just because the socket is available
- Treat renderer-side state as proof of a broader browser or host objective
- Skip request/response evidence when the bug still depends on server behavior
