---
name: pimote
description: Start the Pimote remote access server so you can monitor and interact with this session from your phone.
---
# Pimote — Remote Access Server

Start the pimote server to enable remote access to this pire session from the Pimote iOS app.

## What to do

The user will provide a PIN (or use the default). Run the serve-session script with the **current working directory** as `--cwd`:

```bash
npx tsx /Users/philogroves/pire/packages/pimote/src/serve-session.ts --pin <PIN> --cwd $(pwd) &
```

**CRITICAL**: Use `$(pwd)` for `--cwd`, NOT a hardcoded path. The server must observe the session directory matching the current pire working directory.

This will:
1. Resume the most recent session for this working directory
2. Start a WebSocket server on port 19836
3. Start a Cloudflare tunnel for external access
4. Print the tunnel URL and QR code

Run this command in the background with `&` so the session remains interactive.

## Arguments

The user's message after `/pimote` is the PIN. If empty, prompt them for one (minimum 4 characters).

## Example

User says: `/pimote 1234`

Run:
```bash
npx tsx /Users/philogroves/pire/packages/pimote/src/serve-session.ts --pin 1234 --cwd $(pwd) &
```

Wait a few seconds, then check health and report the tunnel URL:
```bash
sleep 15 && curl -s http://127.0.0.1:19836/health
```

## Stopping

To stop pimote:
```bash
lsof -ti:19836 | xargs kill
```
