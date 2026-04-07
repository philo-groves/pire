# Windows Setup

Pi can be launched natively on Windows, but it still requires a `bash` shell for shell-backed tool execution. Checked shell locations (in order):

1. Custom path from `~/.pi/agent/settings.json`
2. Git Bash (`C:\Program Files\Git\bin\bash.exe`)
3. `bash.exe` on PATH (Cygwin, MSYS2, WSL)

For most users, [Git for Windows](https://git-scm.com/download/win) is sufficient.

## Native Windows Launcher

This repo now includes native Windows launchers at the repo root:

- `pire.cmd`
- `pire.ps1`

They start the built CLI with Node.js and preserve the caller's working directory. They do not `cd` into the repo.

Build first from the repo root:

```powershell
npm install
npm run build
```

Run directly from the clone:

```powershell
.\pire.cmd
```

Or add a tiny wrapper on your `PATH` that forwards to your clone:

```bat
@echo off
call C:\src\pire\pire.cmd %*
```

That lets you run `pire` from any directory while keeping the working directory of the calling shell.

## Custom Shell Path

If Git Bash is not installed in the default location, point pi at another bash executable:

```json
{
  "shellPath": "C:\\cygwin64\\bin\\bash.exe"
}
```
