---
name: info-leak
description: Use when exploitation requires an address, key, or secret value that is not statically known. Guides systematic discovery of info leak primitives and chaining them into the exploitation path.
---
# Info Leak Discovery and Chaining

Use this workflow when exploitation is blocked by a missing runtime value: an ASLR base address, a heap cookie, a safe-linking XOR key, a stack canary, or any secret that must be read before it can be bypassed.

## Phase 1: Identify what you need

Before searching for leaks, precisely define the target:
- What value is needed? (e.g., "per-slab XOR key at slab_header+0x18", "libc base address", "stack canary")
- What size? (1 byte, 4 bytes, 8 bytes, partial pointer)
- What constraints? (must be recovered before the free/allocation/write that uses it)
- Can a partial value work? (e.g., only the low 12 bits of an address are needed if the page offset is fixed)

## Phase 2: Survey leak surfaces

Check each surface in order of reliability:

### 2a. Uninitialized memory reads
- Use decomp_ghidra_decompile to find stack or heap buffers that are allocated but not fully initialized before being sent/logged/compared
- Use debug_gdb_commands to set a breakpoint after allocation, inspect the buffer contents, and check for residual data from prior use
- Common patterns: stack buffer declared but only partially filled before memcpy/write, heap object with padding bytes between fields

### 2b. Out-of-bounds reads
- If an OOB-read primitive already exists (from the vulnerability analysis), check whether it can reach the target value
- Map the memory layout around the read: use debug_gdb_commands to dump memory before and after the buffer
- Calculate the offset from the OOB read base to the target value
- If the target is in a different allocation, check whether the allocator places them adjacently (use heap-analysis skill)

### 2c. Format string / structured output leaks
- Search for printf-family calls where attacker input reaches the format string
- Search for logging, error messages, or debug output that includes pointer values
- Use debug_gdb_commands to set breakpoints on output functions and inspect arguments

### 2d. Heap metadata disclosure
- After a free, the allocator may write metadata (free-list pointers, size fields) into the freed object's user data area
- If the application reads from a freed object (UAF read), the metadata becomes visible
- Use the heap-analysis skill to determine what the allocator writes on free
- Use debug_gdb_commands to inspect the freed object's contents

### 2e. Timing and error oracle leaks
- If the application behaves differently based on the secret value (different error codes, different timing, different control flow), a side-channel may exist
- Use debug_gdb_commands with conditional breakpoints to measure whether the secret affects observable behavior
- Byte-at-a-time recovery is viable if the oracle is reliable and the secret is small

### 2f. Partial pointer leaks
- ASLR on Linux randomizes the upper bytes but the lower 12 bits (page offset) are fixed
- A 1-2 byte leak of a known pointer may be enough to compute the full base
- Identify pointers in the leak surface that point to known offsets within a library or binary

## Phase 3: Validate the leak

Before chaining the leak into exploitation:
- Confirm the leak is deterministic: read it multiple times and verify consistency
- Confirm the leak survives across the operation boundary: the leaked value must still be valid when the exploit uses it
- Use debug_gdb_commands to set breakpoints at both the leak point and the use point, verify the value matches
- Record the leak primitive: what input triggers it, what output carries the value, what offset within the output

## Phase 4: Chain the leak

Integrate the leak into the exploitation path:
- If the leak must happen before the corruption: construct an input sequence that triggers leak → parse output → construct exploit payload with leaked value → trigger corruption
- If the leak and corruption use the same primitive: determine whether the primitive can be used twice (re-triggerable) or whether a single operation must combine leak and corruption
- If the leaked value is encoded (XOR, rotation, masking): decode it using the known algorithm from decompilation
- Record the complete chain: leak input → leaked value → decode → exploit payload → corruption trigger

## Stop conditions

Record a dead end if:
- No leak surface reaches the target value and no adjacent memory contains it
- The leak requires a separate vulnerability that has not been found
- The target value changes between leak and use (e.g., re-randomized per operation)
- The only viable leak is a timing side-channel with < 90% reliability per byte
