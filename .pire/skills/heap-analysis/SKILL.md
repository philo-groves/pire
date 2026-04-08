---
name: heap-analysis
description: Use when reversing a custom allocator, inspecting heap state at runtime, or validating fake object placement for exploitation. Guides the agent through a structured workflow using decompilation plus GDB Python scripting to build allocator-specific heap walkers.
---
# Heap Analysis

Use this workflow when the target uses a custom allocator (slab, arena, zone, pool, region) and exploitation requires understanding its internal state.

## Phase 1: Identify allocator structure via decompilation

Collect first:
- Decompile the allocation entry point (malloc/new wrapper) and free path
- Identify the metadata structure: header fields, free-list pointers, size/class fields, flags
- Map the tier topology: thread-local caches, central arena, large-object bypass, per-size freelists
- Record field offsets (e.g., "next_free at header+0x08, slab_size at header+0x10")
- Identify any integrity checks: canaries, XOR-encoded pointers, safe-linking guards

Use decomp_ghidra_decompile for the allocation and free paths. Cross-reference with disasm_radare2_disassembly for the exact field offsets when decompilation is ambiguous.

## Phase 2: Write a GDB Python walker for each tier

For each allocator tier identified in Phase 1, write a debug_gdb_script that:

1. Sets a breakpoint after the allocator is initialized (or after the operation of interest)
2. Reads the tier's root pointer (e.g., thread-local cache head, central arena list)
3. Walks the linked data structure by following next-pointers at the known offsets
4. Prints a structured summary: address, size/class, in-use/free status, any metadata fields
5. Validates output against a known allocation sequence (e.g., "allocate 3 objects of size 64, free the middle one, dump state")

Template for a slab free-list walker:
```python
import gdb
gdb.execute('break *INIT_COMPLETE_ADDR')
gdb.execute('run')
# Read slab header base
slab_base = int(gdb.parse_and_eval('(unsigned long)SLAB_HEADER_SYMBOL'))
next_free_off = 0x08  # from Phase 1
slot_count = 0
ptr = int(gdb.parse_and_eval(f'*(unsigned long*)({slab_base} + {next_free_off})'))
while ptr != 0 and slot_count < 256:
    print(f'free slot {slot_count}: {hex(ptr)}')
    ptr = int(gdb.parse_and_eval(f'*(unsigned long*){ptr}'))
    slot_count += 1
print(f'total free slots: {slot_count}')
```

Adapt the template per tier. Use debug_gdb_commands first for quick validation, then debug_gdb_script for the full walker.

## Phase 3: Infer heap state after controlled operations

Using the walker from Phase 2:
- Run the target with a crafted input that triggers the allocation/free sequence of interest
- Dump heap state before and after the operation
- Identify which slots are freed, which are still live, and where a re-allocation would land
- Confirm determinism: run twice and verify the same layout

Record evidence:
- Slab/arena layout before the free
- Slot addresses and their contents after the free
- The predicted re-allocation address

## Phase 4: Validate fake object placement

If the exploitation path requires placing a fake object:
- Predict the target slot address from Phase 3
- Verify that the freed slot will be re-used by the next allocation of the right size class
- Use debug_gdb_commands to set a breakpoint on the re-allocation, trigger it, and inspect the returned pointer
- Confirm it matches the predicted address
- If safe-linking or XOR-encoding is present, derive the mask and encode the fake pointer accordingly

## Phase 5: Verify control transfer

- Use debug_gdb_commands to single-step through the vtable/callback dispatch
- Confirm the dispatch reads from the fake object's controlled field
- Record the target address and whether it reaches the intended callback

Stop and record a dead end if:
- The allocator uses randomized slot ordering that defeats deterministic placement
- Safe-linking or pointer authentication blocks fake pointer injection without a separate leak
- The tier topology is too deep to walk reliably (more than 3 tiers of indirection)
