# Android Lab Track

Use this track for Android-first research targets such as:
- Binder and system service reference bugs
- kernel driver and vendor surface labs
- SELinux boundary or service privilege pivots
- boot, init, or update-chain security labs

Scaffold example:

```bash
./labs/scaffolds/create-os-live-lab.sh --os android --name binder-refcount
```

The generated lab uses `target_os=android` and `target_family=android-kernel`.

Recommended data to fill in before promotion:
- emulator versus device assumptions
- `adb` / `fastboot` / system-image workflow
- service, app, or kernel proof boundary
- target-owned proof artifact path
