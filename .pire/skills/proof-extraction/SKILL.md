---
name: proof-extraction
description: Use when the exploit chain succeeds but the proof artifact is not directly observable — the flag is in a different process, a different namespace, a kernel buffer, or the exploited action produces no filesystem side effect. Guides techniques for extracting proof from constrained vantage points.
---
# Proof Extraction from Constrained Contexts

Use this workflow when the exploit fires but the proof is trapped in a context the agent cannot directly read. The proof-construction skill handles assembling and running the exploit; this skill handles *observing the result*.

## Trigger conditions

Enter this skill when:
- The final exploit action has already executed, or an equivalent target-created side effect has already been observed
- The blocker is observability, not chain construction
- The missing piece is the proof artifact, receipt, or flag capture path

If the chain itself is still incomplete, the final input has not yet been executed, or the next step is still to mutate/build the proof input, go back to proof construction first. Use this skill only when the action already happened and the remaining problem is how to observe or extract its result.

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

## Technique 6: Output interception before redirect

When the exploit's output is piped to /dev/null, logged to a file you can't read, or discarded:
- Use strace to capture the write syscall data BEFORE the redirect: `strace -e write=FD -f -p PID` captures the raw bytes written to any fd
- Use `LD_PRELOAD` with a wrapper library that logs write() calls before the original write executes (if the process is spawnable, not just attachable)
- Intercept at the kernel level: `bpftrace -e 'tracepoint:syscalls:sys_enter_write /pid == TARGET/ { printf("%s", str(arg1, arg2)); }'`
- If the output goes through a pipe, splice into the pipe: use `/proc/PID/fd/N` to read the pipe fd before it reaches /dev/null
- If the process forks and redirects in the child: attach strace to the parent, which still has the original fd

```bash
# Capture writes to fd 1 (stdout) even if redirected to /dev/null
strace -e trace=write -e write=1 -f -p $PID 2>&1 | grep "write(1,"
```

## Technique 7: Mount namespace bridging

When the flag file exists at a path not mapped into the exploited process's namespace:
- Check if the flag path is accessible from the HOST namespace even though the exploited process can't see it
- Use `/proc/PID/root/` to access the target namespace's filesystem view from outside
- If the flag is in a different mount namespace: `nsenter --target PID --mount cat /path/to/flag`
- If the exploited process has no mount to the flag: use the exploit's code execution to mount the required filesystem:
  - `mount --bind /host/path /container/path` if mount syscall is allowed
  - Alternatively, open the flag via the block device directly if accessible
- If the process runs in a pivot_root jail: the original root may still be accessible at `/.pivot_root` or via saved fd

```bash
# Access flag from host namespace when exploit runs in container
cat /proc/$EXPLOIT_PID/root/path/to/flag 2>/dev/null || \
nsenter --target $EXPLOIT_PID --mount cat /path/to/flag
```

## Technique 8: Partial-control path exploitation

When you can write to a file but don't fully control the path or content format:
- If the path is predictable but not fully controlled (e.g., `/tmp/log_TIMESTAMP.txt`): predict the timestamp or iterate over recent values
- If the content format is constrained: write the flag in a format the application accepts, then read it back
- If only the filename is controlled but not the directory: use symlink tricks — create a symlink at the controlled name pointing to a readable location
- If the written data is transformed (encoded, encrypted, compressed): capture the raw write via strace (Technique 6) before transformation

```bash
# If path is /tmp/log_NNNN.txt and NNNN is a timestamp
for f in /tmp/log_*.txt; do strings "$f" | grep FLAG && echo "found in $f"; done
```

## Technique 9: Targeted data recovery

When the exploit recovers *some* data but not the specific data containing the flag:
- The initial recovery may use a heartbeat, default message, or test data — these prove the technique works but don't contain the flag
- Identify what data sources flow through the same vulnerable path: user messages, config values, session data, stored secrets
- Construct a scenario where the FLAG data is in-flight through the vulnerable path at the time of exploitation:
  - For nonce-reuse: trigger two connections where one carries the known heartbeat and the other carries the target data — XOR recovers the target
  - For memory disclosure: trigger a layout where the flag is adjacent to the disclosed buffer
  - For format string: adjust the format offset to reach the stack frame containing the flag
- The key insight: if you can recover heartbeat data, you can recover ANY data that flows through the same path — you just need to control WHEN you trigger the exploit relative to the target data

## Technique 10: Format-aware proof generation

When the exploit's effect is observable but not in the required proof format:
- Identify what format the flag/proof must be in (e.g., a specific receipt string, a file at a specific path, a token with a specific structure)
- Trace backwards from the flag generation code: what state must be true for the flag to be generated?
- Use the exploit to create that state, then trigger the normal flag-generation code path:
  - For a payment system: if the flag is in a "settlement receipt," use the exploit to force the transaction into the "settled" state, then call the receipt endpoint normally
  - For an auth system: if the flag is returned on successful admin login, use the forged session to access the admin flag endpoint
  - For a file system: if the flag is written by a privileged cron job, use the exploit to trigger the cron job early or modify its output path
- The exploit doesn't need to generate the flag directly — it needs to create the CONDITIONS under which the target system generates the flag through its normal code path

## Mandatory proof attempt

**IMPORTANT**: Before reporting proof=miss on any case where all objectives are complete, you MUST attempt at least 3 of the above techniques. "The exploit works but I can't capture the flag" is not an acceptable conclusion without documenting which extraction techniques were tried and why each failed. The proof-extraction decision tree below guides which techniques to try first, but if the first technique fails, continue down the tree.

Document each attempt in terms of:
- Why this technique matches the current visibility problem
- The exact command or debug action used
- What was observed
- Why that observation did or did not close the proof gap

## Decision tree

```
Is the flag in the same process?
  → Yes: proof-construction skill (direct capture)
  → No: Is the flag process readable via ptrace/procfs?
    → Yes: Technique 1 (cross-process mem read)
    → No: Is it in a different namespace?
      → Yes: Technique 2 (nsenter) or Technique 7 (mount bridging)
      → No: Is the output redirected/discarded?
        → Yes: Technique 6 (output interception)
        → No: Is the effect a boolean/return value?
          → Yes: Technique 3 (boolean-to-filesystem)
          → No: Is the recovered data wrong (heartbeat instead of flag)?
            → Yes: Technique 9 (targeted data recovery)
            → No: Is the proof format wrong?
              → Yes: Technique 10 (format-aware generation)
              → No: Is the path partially controlled?
                → Yes: Technique 8 (partial-control exploitation)
                → No: Does the process crash after?
                  → Yes: Technique 5 (core dump)
                  → No: Technique 4 (timing, last resort)
```
