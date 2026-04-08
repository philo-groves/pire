---
name: vtable-recovery
description: Use when exploitation requires understanding a stripped binary's virtual dispatch tables, class hierarchy, or callback table layout. Combines static analysis (RTTI scanning, constructor-chasing, section pattern matching) with dynamic tracing (indirect call logging, heap object profiling) to reconstruct vtable layouts without symbols.
---
# Vtable Recovery

Use this workflow when a stripped binary uses virtual dispatch (C++ vtables, callback tables, function pointer arrays) and exploitation requires knowing which function is at which vtable slot.

## Phase 1: RTTI scan

Even stripped binaries often retain RTTI (Run-Time Type Information) structures. Check for them first — this is the fastest path to class names and hierarchy.

- Use `readelf -S` to find `.data.rel.ro` and `.rodata` sections
- Use `strings` filtered for `_ZTI` (typeinfo) and `_ZTV` (vtable) prefixes — these are the mangled names
- If RTTI is present, each typeinfo structure contains:
  - A pointer to the vtable for `std::type_info`
  - A pointer to the mangled class name string
  - For derived classes: pointers to base class typeinfo
- Use `objdump -s -j .data.rel.ro` to dump the section and locate vtable pointer arrays adjacent to RTTI structures
- Demangle names with `c++filt` or `objdump -C`

If RTTI is fully stripped (no `_ZTI`/`_ZTV` strings), proceed to Phase 2.

## Phase 2: Constructor chasing

Constructors reveal vtable addresses directly — they write the vtable pointer to offset 0 of the new object.

- Use decomp_ghidra_decompile or disasm_radare2_disassembly to find functions that:
  1. Receive a pointer from an allocation call (malloc, operator new, custom allocator)
  2. Write a constant address to offset 0 of that pointer: `*(void**)obj = 0xADDRESS`
  3. The constant address IS the vtable pointer
- Cross-reference: the address written should point into `.data.rel.ro` or `.rodata`
- For class hierarchies: derived constructors write the base vtable first, then overwrite with the derived vtable. Use debug_gdb_commands with a watchpoint on the vtable slot to observe this sequence

Template GDB script for constructor identification:
```
break *ALLOCATION_CALL_SITE
commands
  silent
  finish
  # rax holds the new object pointer
  watch *(void**)$rax
  continue
end
run
```

## Phase 3: Indirect call site tracing

For runtime vtable recovery, trace which functions are actually called through virtual dispatch.

- Find indirect call sites: search disassembly for `call [reg+OFFSET]` or `call [mem]` patterns
- Use debug_gdb_commands to set breakpoints on these sites and log the target address:

```
break *INDIRECT_CALL_SITE
commands
  silent
  set $target = *(void**)($VTABLE_REG + OFFSET)
  printf "dispatch: vtable=%p slot=%d target=%p\n", $VTABLE_REG, OFFSET/8, $target
  continue
end
run ARGS
```

- Run with multiple inputs to cover different code paths and polymorphic dispatch
- Group the logged targets by vtable base address — each unique base is a different class
- Map slot offsets to function addresses to reconstruct the full vtable layout

For comprehensive tracing, use debug_gdb_script to write a Python script that:
1. Scans the .text section for indirect call patterns
2. Sets breakpoints on each one
3. Logs vtable address, slot offset, and target function
4. Runs the target with a corpus of inputs
5. Outputs a structured vtable map

## Phase 4: .data.rel.ro pattern matching

Vtables have a distinctive memory layout. Scan for them directly.

- Dump `.data.rel.ro` as 8-byte (64-bit) or 4-byte (32-bit) pointer arrays
- Look for contiguous sequences where every entry points into `.text` (executable code)
- A typical C++ vtable layout is:
  - Word -2: offset-to-top (usually 0 for primary base)
  - Word -1: pointer to RTTI typeinfo (or 0 if stripped)
  - Word 0: first virtual function (this is what the object's vtable pointer points to)
  - Word 1..N: remaining virtual functions
- Use debug_gdb_script to automate the scan:

```python
import gdb
text_start = int(gdb.parse_and_eval("&_start"))  # approximate
text_end = text_start + 0x100000  # adjust based on readelf
# Read .data.rel.ro and check for pointer sequences into .text
```

## Phase 5: Heap object profiling

For runtime class discovery when static analysis is insufficient.

- Use debug_gdb_commands to break on allocation returns and record the vtable pointer:

```
break *ALLOC_RETURN_SITE
commands
  silent
  # After allocation, the constructor will write the vtable
  # Set a temporary breakpoint after the constructor returns
  tbreak *CONSTRUCTOR_RETURN
  continue
end
```

- After construction completes, dump bytes 0-7 of the object (the vtable pointer)
- Group allocations by vtable pointer value → each group is one class
- Cross-reference allocation sizes with vtable groups to determine object layouts

## Phase 6: Assemble the vtable map

Combine results from all phases into a structured vtable map:

```
Class "PluginHandler" (RTTI: _ZTI13PluginHandler)
  vtable at 0x4a5200 (.data.rel.ro)
  slot 0 (+0x00): 0x401a30  PluginHandler::process()
  slot 1 (+0x08): 0x401b10  PluginHandler::validate()
  slot 2 (+0x10): 0x401c40  PluginHandler::dispatch()
  slot 3 (+0x18): 0x401d00  PluginHandler::cleanup()
  object size: 48 bytes (from heap profiling)
  constructor: 0x401900
```

Record the map as a finding artifact. When the exploitation path requires targeting a specific vtable slot, use this map to compute the function pointer address.

## Stop conditions

Record a dead end if:
- RTTI is fully stripped AND no constructors are identifiable AND indirect call tracing produces no consistent patterns
- The binary uses non-standard dispatch (e.g., computed goto tables, JIT-compiled dispatch) that doesn't follow the vtable layout
- The vtable is encrypted or obfuscated at rest and only decoded at dispatch time
