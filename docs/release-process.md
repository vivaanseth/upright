# Release Process

Posture releases are tag driven and start as draft prereleases.

## Before tagging

- Confirm `package.json`, `CHANGELOG.md`, and `docs/releases/vX.Y.Z.md` use the same version.
- Run `pnpm format:check`.
- Run `pnpm lint`.
- Run `pnpm typecheck`.
- Run `pnpm test`.
- Run `pnpm test:coverage`.
- Run `pnpm scan:privacy`.
- Run `pnpm audit:prod`.
- Run `pnpm audit:licenses`.
- Run `pnpm build`.
- Run `pnpm test:e2e`.
- For a stable release candidate, complete `docs/qa/compatibility.md` and `docs/qa/performance.md`.

## Tagging

Create an annotated tag in the form `vX.Y.Z`. The release workflow verifies the tag, package version, changelog entry, expected artifact manifest, SBOMs, checksums, and GitHub provenance attestations.

## Publication

The workflow creates a draft prerelease. Publish it only after the expected artifacts are present, checksums verify after public download, and the release notes include unsigned-build warnings and known limitations.

## Signing milestone

Automatic updates and native notification dependency remain disabled until Apple Developer ID notarization and Windows Authenticode signing are configured in a protected release environment.
