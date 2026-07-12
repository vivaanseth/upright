# Changelog

All notable changes follow semantic versioning.

## 0.1.2 - 2026-07-12

### Fixed

- Restore every pinned MediaPipe loader and WASM asset byte-for-byte, including the no-SIMD fallback.
- Initialize MediaPipe from its bundled loader in a classic worker and close every transferred frame.
- Permit WebAssembly compilation in the otherwise strict application Content Security Policy.
- Verify a real pose-inference result during Electron end-to-end testing.
- Match Linux release artifact names emitted by native DEB, RPM, and AppImage builders.

### Release note

- `v0.1.1` was never published because release validation found the inference-runtime defect. Use `v0.1.2` instead.

## 0.1.1 - 2026-07-12

### Fixed

- Request camera permission from an explicit onboarding action on macOS.
- Populate the camera picker from both enumerated and active video devices.
- Recover from stale saved camera identifiers by opening the default camera.
- Restrict renderer trust and media permission checks to exact application origins.
- Stop partial camera streams after setup failures and avoid unrelated login-item writes.

## 0.1.0 - 2026-07-12

### Added

- Local MediaPipe pose tracking with a bounded Web Worker pipeline.
- Personal calibration, relative scoring, smoothing, and hysteresis.
- Gentle reminder policy and app-owned nudge window.
- Session summaries, local export, deletion, and retention rules.
- Secure Electron preload bridge, custom application protocol, tray, and single-instance lifecycle.
- Onboarding, dashboard, diagnostics, settings, light/dark themes, and accessibility states.
- Cross-platform packaging configuration and manual draft-release workflow.
