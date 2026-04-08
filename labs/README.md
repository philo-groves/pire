# Live Labs

This directory holds runnable local targets for PiRE live improvement sessions.

Goals:
- give PiRE a real target to investigate instead of only fixture metadata
- keep runs repeatable with explicit build, reset, and proof-artifact paths
- make it easy to rerun the same target after prompt or workflow changes

Current labs:
- `plugin-host-live`: small plugin-host-style local lab focused on objective tracking, disclosure, callback pivoting, and proof capture

Recommended workflow:
1. `cd` into the lab directory
2. run `make build`
3. run `make reset`
4. launch PiRE from that directory with `./scripts/run-pire.sh`
5. keep the proof boundary stable between iterations
