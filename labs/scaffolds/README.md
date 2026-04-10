# Per-OS Lab Scaffolds

This directory is the staging area for new live labs that need to be organized by
target operating system.

Current target tracks:
- `windows`: Windows kernel, drivers, Hyper-V, broker, or service-boundary labs
- `apple`: macOS and iOS kernel, userspace, sandbox, or entitlement-boundary labs
- `android`: Android kernel, Binder, system service, SELinux, or boot-chain labs

Use the generator to create a new flat live-lab directory that still fits the
existing audited harness shape:

```bash
./labs/scaffolds/create-os-live-lab.sh --os windows --name kcfg-race
./labs/scaffolds/create-os-live-lab.sh --os apple --name pmap-uaf
./labs/scaffolds/create-os-live-lab.sh --os android --name binder-refcount
```

The generated directory name stays flat under `labs/`:
- `labs/windows-kcfg-race-live`
- `labs/apple-pmap-uaf-live`
- `labs/android-binder-refcount-live`

That is intentional. The current tooling discovers `labs/*-live` directly, so new
scaffolds should preserve that shape until the harness is explicitly upgraded for a
different inventory model.

Each generated lab includes:
- `lab.json` with `target_os`, `target_family`, and proof/log placeholders
- `.pire/TARGET.md` with OS-specific research hints
- a placeholder `src/*_snapshot.c` to preserve the usual audited-lab structure
- runnable `build`, `reset`, and `run-target` scripts that stay proof-free by default

Promote a scaffold into the audited inventory only after:
1. the target is real and runnable
2. the proof artifact is target-created and fixed
3. the benign path is quiet
4. the README and `.pire/TARGET.md` describe objectives without leaking the solve
