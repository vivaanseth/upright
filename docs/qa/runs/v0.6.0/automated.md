# Upright 0.6.0 automated QA receipt

Date: 2026-07-18  
Host: macOS 14.7.7 (23H723), x86_64  
Scope: local source automation and an unpacked x64 macOS package

## Passed checks

- Prettier, ESLint, and strict TypeScript checks.
- 10 Vitest files and 72 tests with 96.02% statements, 87.83% branches, 97.89% functions, and 96.87% lines.
- Five Electron E2E flows, including one real bundled MediaPipe worker flow using Chromium's synthetic camera input.
- Asset integrity, brand audit, privacy boundary scan, and 477-entry license audit.
- CycloneDX 1.6 runtime SBOM validation: 9 components and 10 dependency relationships, including Electron and the checksummed MediaPipe model.
- Production package manifest: 24 ASAR entries, three MediaPipe WASM variants, one bundled model, no production source maps or unexpected external preload imports.
- Electron fuse verification and packaged `--smoke-test` launch for `Upright.app` version 0.6.0 (`darwin/x64`).
- GitHub Actions workflow YAML parsing for CI, CodeQL, release, and protected promotion workflows.

## Package observation

The unpacked x64 `Upright.app` occupied approximately 268 MiB and contained 41 regular files. This is not the universal release artifact and is not used as a compressed-artifact size result.

## Not established by this receipt

- Physical camera behavior or macOS camera-permission migration under the Upright name.
- Apple Silicon, Windows, Linux, installer, upgrade, uninstall, tray, or desktop-environment compatibility.
- Cold/warm launch, private memory, sustained CPU, inference latency, or memory-growth targets.
- Controlled posture accuracy or false-reminder targets.
- A completed deep Codex Security scan.

The corresponding machine-readable receipt is [automated.json](automated.json).
