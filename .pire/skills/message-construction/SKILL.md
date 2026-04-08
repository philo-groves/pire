---
name: message-construction
description: Use when exploitation requires sending a crafted message over IPC, D-Bus, network sockets, or other structured protocols. Guides the agent through reverse-engineering the message format, constructing valid-but-malicious payloads, and delivering them to trigger the vulnerability.
---
# Message Construction

Use this workflow when the vulnerability is triggered by a structured message (IPC, D-Bus, network protocol, file format) and the agent has reverse-engineered the format but needs to construct and deliver a crafted payload.

## When to construct vs when to keep analyzing

Construct a test message when:
- The message format is understood (field offsets, type tags, length fields, checksums)
- The vulnerability trigger condition is identified (specific field value, oversized length, type confusion)
- Static analysis alone cannot confirm whether the trigger is reachable

Keep analyzing if:
- The message format is still partially unknown (unknown fields, unclear encoding)
- The vulnerability path has untested preconditions (authentication, session state)

## Phase 1: Document the message format

Before constructing, write down the exact format:
- Wire format: binary (struct-packed), text (JSON/XML), mixed (header + body)
- Byte order: little-endian, big-endian, network order
- Field layout: offset, size, type, valid ranges, and meaning of each field
- Framing: how the receiver knows where one message ends and the next begins (length prefix, delimiter, fixed size)
- Validation: checksums, MACs, signatures, type checks that must pass for the message to be processed
- Session state: does the message require a prior handshake, authentication, or specific state?

Use decomp_ghidra_decompile on the message parser to extract this information. Use debug_gdb_commands to confirm field offsets by breaking on the parser and inspecting the buffer.

## Phase 2: Construct the payload

### Binary IPC messages
Write a Python script using `struct.pack`:
```python
import struct
# Example: 4-byte type field, 4-byte length, N-byte payload
msg_type = 0x41  # the type that triggers confusion
payload = b"A" * overflow_length
header = struct.pack("<II", msg_type, len(payload))
message = header + payload
with open("/tmp/crafted_msg.bin", "wb") as f:
    f.write(message)
```

### D-Bus method calls
Use `dbus-send` or `gdbus call`:
```bash
# dbus-send with crafted arguments
dbus-send --system --dest=org.target.Service \
  --type=method_call \
  /org/target/Object \
  org.target.Interface.Method \
  string:"injected_arg" uint32:0xdeadbeef

# gdbus for more complex argument types
gdbus call --system \
  --dest org.target.Service \
  --object-path /org/target/Object \
  --method org.target.Interface.Method \
  "('injected', @u 0xdeadbeef)"
```

### Network protocols
Use Python sockets or `socat`:
```python
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(("127.0.0.1", target_port))
s.send(crafted_message)
response = s.recv(4096)
```

For UDP or raw protocols, adjust the socket type accordingly.

### File format inputs
Write the crafted file to disk and feed it to the target:
```bash
python3 -c "import struct; open('/tmp/crafted.bin','wb').write(PAYLOAD)" 
./target /tmp/crafted.bin
```

## Phase 3: Deliver and observe

- Run the target under debug_gdb_commands or strace with the crafted message
- Set breakpoints at the parser entry and the vulnerability trigger point
- Verify that the message passes validation and reaches the vulnerable code path
- Capture the crash, corruption, or controlled behavior

If the message is rejected:
- Check which validation failed (use GDB to break on the validation function)
- Adjust the payload to pass validation while preserving the trigger condition
- Common issues: wrong checksum, missing magic bytes, incorrect length field, failed type check

## Phase 4: Iterate

If the trigger doesn't fire on the first attempt:
- Verify field offsets with debug_gdb_commands (the decompilation may have misidentified offsets)
- Check byte order (common mistake: using host byte order instead of network order)
- Check alignment requirements (some parsers reject unaligned fields)
- Use strace to see if the message even reaches the parser (it may be dropped by a firewall, rate limiter, or authentication check)

## Anti-patterns

Do not:
- Send crafted messages to external or production systems without explicit authorization
- Guess message formats without decompilation evidence — a wrong format wastes time and may crash unrelated code
- Construct messages that trigger the vulnerability but also corrupt the parser state, making further exploitation impossible
