---
name: proof-extraction
description: Use when the exploit chain succeeds but the proof artifact is not directly observable — the flag is in a different process, a different namespace, a kernel buffer, or the exploited action produces no filesystem side effect. Guides techniques for extracting proof from constrained vantage points.
---
# Proof Extraction from Constrained Contexts

Use this workflow when the exploit fires but the proof is trapped in a context the agent cannot directly read. The proof-construction skill handles assembling and running the exploit; this skill handles *observing the result*.

## Technique 1: Cross-process memory read via procfs

When the flag is in another process's memory (e.g., privileged ioctl result mapped to a helper):
- Identify the target PID and the virtual address range containing the result
- Read via `/proc/PID/mem` if the agent has sufficient privileges (same UID or CAP_SYS_PTRACE)
- Use debug_gdb_commands to attach to the target process: `gdb -p PID --batch -ex "x/s TARGET_ADDR"`
- If ptrace is restricted (`/proc/sys/kernel/yama/ptrace_scope >= 1`), check if the parent-child relationship allows attach
- Alternative: if the target writes the result to a pipe/socket/shared-memory, intercept it with strace on the target

```bash
# Read 64 bytes from target process memory
dd if=/proc/$PID/mem bs=1 skip=$((TARGET_ADDR)) count=64 2>/dev/null | xxd
```

## Technique 2: Namespace-aware artifact collection

When the exploit crosses a namespace boundary (e.g., sandbox escape into a new user namespace):
- The flag artifact may exist inside the new namespace's filesystem view
- Use `nsenter --target PID --mount --pid` to enter the namespace and read the artifact
- If nsenter is not available, read via `/proc/PID/root/path/to/artifact`
- For PID namespaces: the flag process's PID may differ inside vs outside the namespace

For hangs during namespace teardown:
- Set a timeout on the trigger script and capture output before the hang
- Use `timeout --signal=KILL N command` to force-kill after capturing the flag
- Alternative: fork the proof capture into a background process before the hang-inducing operation

```bash
# Capture flag before namespace teardown hang
timeout 5 bash -c './exploit_trigger & sleep 2 && cat /proc/$!/root/tmp/flag.txt' 2>/dev/null
```

## Technique 3: Boolean-to-filesystem side channel

When the exploit's effect is a boolean (capability check returns true, auth succeeds, permission granted) with no direct artifact:
- Chain the boolean into a filesystem-visible action:
  - If the boolean gates a file operation: observe which file was opened/written via strace
  - If the boolean gates a network response: capture the response with strace or tcpdump
  - If the boolean is a return value: use debug_gdb_commands to set a conditional breakpoint on the return and log the value
- Construct a secondary payload that uses the granted permission to create a visible artifact:
  - Write a file to a known path using the elevated privilege
  - Create a network connection to a local listener
  - Modify a configuration value observable from outside

```bash
# Observe privileged capability check result via strace
strace -e trace=open,write -f -p $PID 2>&1 | grep -A1 "privileged_path"
```

## Technique 4: Timing-based exfiltration

When no direct read path exists:
- If the exploited operation takes measurably different time based on the secret value, use timing:
  - Run the exploit N times, measure elapsed time for each
  - Correlate timing differences with expected flag byte values
- This is a last resort — only use when techniques 1-3 are not viable
- Requires high-precision timing (use `perf stat` or GDB cycle counting, not wall-clock time)

## Technique 5: Core dump capture

When the process crashes after the exploit:
- Enable core dumps: `ulimit -c unlimited`
- The core dump contains the process memory at crash time, including the flag
- Use GDB to read the flag from the core: `gdb target core -batch -ex "x/s FLAG_ADDR"`
- If the flag is on the heap, search the core for the flag format: `strings core | grep FLAG`

## Decision tree

```
Is the flag in the same process? 
  → Yes: proof-construction skill (direct capture)
  → No: Is the flag process readable via ptrace/procfs?
    → Yes: Technique 1 (cross-process mem read)
    → No: Is it in a different namespace?
      → Yes: Technique 2 (nsenter/procfs root)
      → No: Is the effect a boolean/return value?
        → Yes: Technique 3 (side channel to filesystem)
        → No: Does the process crash after?
          → Yes: Technique 5 (core dump)
          → No: Technique 4 (timing, last resort)
```
