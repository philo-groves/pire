---
name: pimote
description: Start the Pimote remote access server so you can monitor and interact with this session from your phone.
---
# Pimote — Remote Access Server

Start the pimote server to enable remote access to this pire session from the Pimote iOS app.

## What to do

The user will provide a PIN (or use the default). Run the serve-session script:

```bash
npx tsx packages/pimote/src/serve-session.ts --pin <PIN> --cwd $(pwd)
```

This will:
1. Resume the most recent session for this working directory
2. Start a WebSocket server on port 19836
3. Start a Cloudflare tunnel for external access
4. Print the tunnel URL and QR code

**Important**: Run this command in the background so the session remains interactive. Use the bash tool with `&` or tell the user to run it in a separate terminal.

## Arguments

The user's message after `/pimote` is the PIN. If empty, prompt them for one (minimum 4 characters).

## Example

User says: `/pimote 1234`

Run:
```bash
npx tsx packages/pimote/src/serve-session.ts --pin 1234 --cwd /Users/philogroves/pire &
```

Then wait a few seconds and check:
```bash
curl -s http://127.0.0.1:19836/health
```

Report the tunnel URL and connection details to the user.

## Stopping

To stop pimote, kill the process:
```bash
lsof -ti:19836 | xargs kill
```
