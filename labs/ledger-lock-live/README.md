# Ledger Lock Live Lab

Small local target for live PiRE improvement sessions. This runnable lab exercises:
- cross-file static analysis across accounts, links, and journal flows with exact-cardinality constraints
- misleading local optima where a compact closure can satisfy part of the graph but not the full ledger lock
- non-obvious proof flow spread across graph traversal, journal reduction, and whole-ledger consistency checks
- disclosure-to-proof carryover with target-created proof
