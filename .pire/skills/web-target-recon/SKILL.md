---
name: web-target-recon
description: Use when mapping a web target's exposed surface, trust boundaries, and security-relevant workflows before deeper testing.
---
# Web Target Recon

Inventory first. Exploit speculation comes later.

Collect first:
- Base URLs, hosts, ports, and reachable applications
- Authentication boundaries, roles, and visible workflows
- Interesting parameters, file upload points, API routes, and admin surfaces
- Technology fingerprints only when directly observed

Prefer:
- Read-only browsing, passive response analysis, and low-volume probing
- Capturing exact requests, routes, parameters, and response codes
- Identifying trust boundaries and attacker-controlled inputs
- If a local browser target exposes remote debugging, capture `/json/version`, enumerate targets, and use read-only CDP evaluation before broader guesswork

Keep notes on:
- Reachable attack surface and hidden-but-referenced routes
- Candidate sinks, parsers, and privileged actions
- Areas where authorization or input validation needs focused review

Stop and ask for direction if:
- The next step requires credentialed testing, brute force, or intrusive scanning
- The user has not clarified the allowed interaction scope
