# Security policy

## Supported versions

Security fixes are applied to the latest release line. Until `v1.0.0`, only the newest published prerelease is supported.

## Reporting a vulnerability

Do not open a public issue for a vulnerability involving Electron permissions, IPC, local data exposure, navigation, model loading, or update/release integrity. Use GitHub private vulnerability reporting after the repository is published.

Include the affected version, operating system, reproduction steps, impact, and any suggested mitigation. Do not include real camera frames or private user data.

## Security boundaries

- Renderer processes are sandboxed and context-isolated.
- Node integration is disabled.
- The preload bridge exposes intent-specific functions only.
- IPC validates sender origin and payload schema.
- Camera permission is restricted to video for the packaged application origin.
- Navigation and new windows are denied.
- Pose assets are local and the model checksum is verified at build time.
