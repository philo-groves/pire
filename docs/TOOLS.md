# PiRE v2 Tool Specifications

## Design Principles

1. **Return structured data** — tools return parsed, typed results, not raw
   text that the model has to interpret.
2. **One tool call per operation** — if the agent needs to make an HTTP
   request, it's one `http` call, not "write a curl command as bash input,
   parse the text output."
3. **Minimize context cost** — tool results should be concise. Truncate large
   responses with a note. Don't dump 500 lines of HTML when the model needs
   the status code and 3 relevant lines.
4. **Inherited tools are fine** — pi-mono's built-in tools (bash, read, write,
   edit, grep, find, ls) remain available. We add to them, not replace them.

## Core Tools (from pi-mono)

These are available by default. No changes needed.

| Tool | Purpose | Notes |
|---|---|---|
| `bash` | Shell command execution | The escape hatch for anything tools don't cover |
| `read` | Read file contents | Text-oriented; use for source, configs, logs |
| `write` | Create/overwrite files | For scripts, payloads, notes |
| `edit` | Targeted string replacement | For modifying existing files |
| `grep` | Content search | Regex across files |
| `find` | File pattern matching | Glob-based file discovery |
| `ls` | Directory listing | Via bash |

## New Tools

### `http` — Structured HTTP Requests

**Why**: Many real web targets and benchmark tasks require HTTP interaction. Through bash, this
means crafting curl commands, dealing with quoting, and parsing raw output.
A structured tool eliminates this overhead.

**Parameters**:
```
method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS"
url: string                          # full URL including scheme
headers?: Record<string, string>     # request headers
body?: string                        # request body (for POST/PUT/PATCH)
content_type?: string                # shortcut for Content-Type header
follow_redirects?: boolean           # default true
timeout_ms?: number                  # default 30000
max_response_bytes?: number          # default 100KB, truncate with note
```

**Returns**:
```
{
  status: number,
  status_text: string,
  headers: Record<string, string>,
  body: string,           # truncated if > max_response_bytes
  truncated: boolean,
  redirect_chain?: string[],
  timing_ms: number
}
```

**Presentation to model** (formatted for readability):
```
HTTP 200 OK (142ms)
Headers:
  content-type: text/html; charset=utf-8
  set-cookie: session=abc123; Path=/; HttpOnly
Body (2,341 bytes):
  <!DOCTYPE html>
  <html>
  <head><title>Login</title></head>
  <body>
    <form action="/login" method="POST">
      <input name="username" />
      <input name="password" type="password" />
      <button type="submit">Login</button>
    </form>
  </body>
  </html>
```

**Implementation notes**:
- Use Node.js `fetch` or `undici` internally
- Strip binary content (images, fonts) — return "[binary content, N bytes]"
- For HTML bodies > 5KB, return first 2KB + last 1KB with "[truncated]"
- Always include response headers (cookies, redirects, CSP are security-relevant)

### `python` — Python Script Execution

**Why**: Complex exploitation often requires multi-step scripting: blind SQLi
extraction loops, encoding/decoding chains, cryptographic operations, payload
generation. Writing these as bash one-liners is fragile. Writing them as files
then executing is 3+ tool calls. A `python` tool is one call.

**Parameters**:
```
code: string              # Python code to execute
timeout_ms?: number       # default 60000
```

**Returns**:
```
{
  stdout: string,         # truncated at 50KB
  stderr: string,         # truncated at 10KB
  exit_code: number,
  truncated: boolean
}
```

**Environment**:
- Python 3.11+
- Pre-installed libraries: `requests`, `beautifulsoup4`, `pwntools`,
  `pycryptodome`, `jwt`, `lxml`
- Working directory: agent workspace
- Network access: same as agent (can reach target)
- Filesystem access: agent workspace only

**Implementation notes**:
- Spawn `python3 -c` with the code as argument, or write to temp file for
  multiline
- Capture stdout and stderr separately
- Kill on timeout
- The pre-installed libraries cover 90%+ of web pentesting needs

### `notebook_write` — Write Research Notebook Entry

See [AGENT.md](AGENT.md) for full notebook design.

**Parameters**:
```
key: string               # entry name
value: string             # entry content
```

**Returns**: Confirmation message with current notebook size.

### `notebook_read` — Read Research Notebook

**Parameters**:
```
key?: string              # specific entry, or omit for all
```

**Returns**: Entry value(s) formatted as text.

### `notebook_append` — Append to Research Notebook Entry

**Parameters**:
```
key: string               # entry name
value: string             # content to append
```

**Returns**: Confirmation with updated entry.

### `notebook_delete` — Delete Research Notebook Entry

**Parameters**:
```
key: string               # entry to remove
```

**Returns**: Confirmation.

## Tool Design Decisions

### Why not a dedicated SQL injection tool?

Considered and rejected. A `sqli` tool would encode assumptions about injection
technique, database type, and payload format. The model is better at crafting
SQL payloads through `http` (for inline injection) or `python` (for scripted
extraction). Specialized tools help when the task is mechanical; SQLi requires
creativity.

### Why not a dedicated browser/XSS tool?

Considered and deferred. Some web tasks use browser-mediated flows or callback
verification. That is still adequately handled by `http` for the request path
and `python` for payload generation or listener setup.

If XSS pass rate is low after initial benchmarking, we can add a `browser`
tool that wraps Playwright for direct DOM interaction. But start without it.

### Why not a dedicated binary analysis tool?

Deferred to when we tackle broader binary RE coverage. For current source-led
and web-focused tasks, `bash` (with objdump, readelf, strings available in PATH) is
sufficient. If we add binary RE eval, we should add structured tools for:
- `disassemble(binary, function?, address?, count?)` — focused disassembly
- `binary_info(binary)` — headers, sections, symbols, protections
- `debug(binary, commands)` — GDB scripting

### Why keep bash?

`bash` is the escape hatch. When no specialized tool fits, the agent can
always fall back to shell commands. This prevents tool poverty from blocking
the agent on novel targets. However, for common operations (HTTP, Python,
notebook), the specialized tools are preferred because they're cheaper in
context and more structured.

## Tool Result Truncation Strategy

Context is scarce. Every tool result competes with reasoning space. Truncation
rules:

| Content type | Max size | Strategy |
|---|---|---|
| HTTP body (HTML) | 5KB | First 2KB + last 1KB + "[truncated]" |
| HTTP body (JSON) | 10KB | Pretty-print, truncate arrays > 10 items |
| HTTP body (binary) | 0 | "[binary content, N bytes]" |
| Python stdout | 50KB | Last 50KB (tail, since output accumulates) |
| Python stderr | 10KB | Last 10KB |
| Bash output | 50KB | Inherited from pi-mono |
| File read | 2000 lines | Inherited from pi-mono |

The model can always request more with `read` or `bash` if truncation removed
critical content. Truncation notes should say what was removed so the model
knows to ask.

## Tool Registration

All tools are registered via pi-mono's extension API in `extension.ts`:

```typescript
export function activate(context: ExtensionContext) {
  context.registerTool("http", httpTool);
  context.registerTool("python", pythonTool);
  context.registerTool("notebook_write", notebookWriteTool);
  context.registerTool("notebook_read", notebookReadTool);
  context.registerTool("notebook_append", notebookAppendTool);
  context.registerTool("notebook_delete", notebookDeleteTool);

  // Inject notebook state before each LLM call
  context.on("before_agent_start", injectNotebookContext);
}
```

Tool definitions follow pi-mono's Zod-based schema format for parameter
validation and automatic description generation.
