# Changelog

All notable changes follow semantic versioning.

## 0.5.1 - 2026-07-12

### Fixed

- Make the release license-audit script resolve pnpm correctly on Windows runners.

### Release note

- Supersedes the failed `v0.5.0` tag workflow attempt. The `v0.5.0` app changes remain the beta baseline; `v0.5.1` is the first publishable beta release candidate for that line.

## 0.5.0 - 2026-07-12

### Added

- Separate camera/tracking lifecycle state from posture classification state.
- Calibration V2 with exact camera matching, metric reliability, rejection reasons, and compatibility status.
- SessionSummary V2 and Export V2 with crash recovery, time-weighted scoring, atomic writes, and export privacy validation.
- Adaptive pose sampling, worker watchdog recovery, Linux frame-capture fallback, and development diagnostics.
- Camera and calibration management, destructive data controls, storage recovery notices, and pending/error feedback in Settings.
- Package manifest, privacy-boundary, license, audit, and coverage checks for release readiness.
- Release QA documentation for compatibility evidence, performance methodology, and manual packaging gates.

### Changed

- Start sessions only after the renderer reports an active calibrated tracking runtime.
- Treat unreliable metric coverage as Unknown rather than Poor.
- Keep calibrations scoped to their exact camera identifier.
- Harden trusted external URL handling and default release/repository links.

### Release note

- This is a feature-complete beta line. The Codex Security deep scan, hardware compatibility matrix, and stable-signing milestones remain outside this release gate.

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
