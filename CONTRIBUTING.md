# Contributing

Thanks for helping improve Upright.

## Principles

- Preserve the local-only privacy boundary.
- Treat missing or low-confidence landmarks as Unknown, never Poor.
- Keep medical claims out of product copy and documentation.
- Prefer calm, infrequent feedback over gamification or urgency.
- Test behavior on every operating system affected by a change.

## Workflow

1. Open an issue for behavior changes or large refactors.
2. Create a focused branch.
3. Install with `pnpm install`.
4. Make the smallest coherent change.
5. Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm scan:privacy`, and `pnpm build`.
6. Add an Electron end-to-end test when changing the preload bridge, lifecycle, permissions, onboarding, or navigation.

Run `pnpm test:coverage`, `pnpm audit:prod`, and `pnpm audit:licenses` before release branches or broad runtime changes.

Do not commit real webcam captures, body images, user data, signing credentials, or release secrets.
