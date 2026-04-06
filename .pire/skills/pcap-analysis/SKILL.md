---
name: pcap-analysis
description: Use when analyzing packet captures, reconstructing flows, or extracting protocol-level evidence from network traces.
---
# PCAP Analysis

Start with high-level flow inventory before diving into payload details.

Collect first:
- Capture path, size, timestamps, and hashes
- Endpoint pairs, protocols, ports, and flow counts
- Failed handshakes, resets, retransmissions, and other anomalies
- Streams, transactions, or sessions worth extracting

Prefer:
- Exact display filters and stream identifiers
- Summaries before payload carving
- Recording what is missing due to truncation, encryption, or capture gaps

Keep notes on:
- Suspicious flows and why they matter
- Credentials, secrets, or file transfers only when directly evidenced
- Which observations are confirmed versus inferred from partial traffic

Stop and ask for direction if:
- Decryption or live capture is required
- The next step would move from offline analysis to active network interaction
