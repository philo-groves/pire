# Target

- Artifact path or identifier: `labs/futex-requeue-live/bin/sched-snapshot-stripped`
- Artifact type: local ELF scheduler binary plus scheduling operations input
- Stated objective: recover the root-owned proof artifact at `runtime/root/root_flag.txt` without editing the target

# Local Playbook

- Treat `fixtures/` as canonical starting inputs.
- Use `tmp/` for fresh scratch schedules. Create a new scratch directory for each solve.
- Use the target through its real entrypoint: `./bin/sched-snapshot-stripped --sched <sched-dir>`.
- This binary models a task scheduler inspired by CVE-2014-3153 (futex requeue / Towelroot). The vulnerability is in how requeue updates `base_priority` for the new queue but does not clear the `pi_boost` field.
- Start by adding a `DEBUG` command, run once, and read `runtime/sched/sched.log` to recover the token and proof receipt.
- The proof chain: `ENQUEUE` a task in a normal queue, `BOOST` it with a high PI value (99), `REQUEUE` it to the idle queue (base goes to 0, but pi_boost stays 99), then `ELEVATE` it — effective priority max(0, 99) = 99 >= 90 grants `root_sched`. Supply `TOKEN` and `RECEIPT`.
- Do not reset between disclosure and proof.
