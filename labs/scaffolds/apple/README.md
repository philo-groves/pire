# Apple Lab Track

Use this track for macOS and iOS research targets such as:
- XNU kernel and pmap or IPC bugs
- sandbox and entitlement boundary escapes
- launchd, XPC, IOKit, or userspace-to-kernel transitions
- iOS-specific policy or daemon chains

Scaffold example:

```bash
./labs/scaffolds/create-os-live-lab.sh --os apple --name pmap-uaf
```

The generated lab uses `target_os=apple` and `target_family=macos-ios-kernel`.

Recommended data to fill in before promotion:
- whether the target is macOS, iOS, or shared XNU surface
- host tooling assumptions such as LLDB, `xcrun`, or device bridge requirements
- entitlement or sandbox boundary for proof
- target-owned proof artifact path
