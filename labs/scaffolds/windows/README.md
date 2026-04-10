# Windows Lab Track

Use this track for Windows-first research targets such as:
- kernel pool and object-lifetime bugs
- IOCTL and driver attack surfaces
- broker, service, or AppContainer boundary pivots
- Hyper-V or virtualization-adjacent labs

Scaffold example:

```bash
./labs/scaffolds/create-os-live-lab.sh --os windows --name token-steal
```

The generated lab uses `target_os=windows` and `target_family=windows-kernel`.

Recommended data to fill in before promotion:
- VM or snapshot assumptions
- symbol strategy and debugger entrypoint
- guest-to-host proof boundary
- target-owned proof artifact path
