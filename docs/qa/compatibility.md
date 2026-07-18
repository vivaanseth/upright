# Compatibility QA

This file records the compatibility evidence required before Upright can be described as stable or fully compatible. CI can prove builds and fake-camera flows; real camera behavior still needs dated hardware evidence.

## Current status

| Area                | Status  | Evidence                                                                                                                                                                |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS Apple Silicon | Partial | Historical real-camera validation completed on 2026-07-12 under the Posture name; the Upright package still requires a clean rerun. <!-- brand-audit: allow-history --> |
| macOS Intel         | Partial | On 2026-07-18, the Upright 0.6.0 x64 package passed ASAR/fuse validation and a packaged smoke launch on macOS 14.7.7. Real-camera and installer checks remain pending.  |
| Windows 10 x64      | Pending | Requires clean-machine camera onboarding, pause, quit, and uninstall test.                                                                                              |
| Windows 11 x64      | Pending | Requires clean-machine camera onboarding, pause, quit, and uninstall test.                                                                                              |
| Ubuntu LTS x64      | Pending | Requires AppImage/DEB smoke on a clean install.                                                                                                                         |
| Fedora x64          | Pending | Requires AppImage/RPM smoke on a clean install.                                                                                                                         |
| GNOME Wayland/X11   | Pending | Requires tray, nudge, camera, and display-scaling checks.                                                                                                               |
| KDE Wayland/X11     | Pending | Requires tray, nudge, camera, and display-scaling checks.                                                                                                               |

## Required manual rows

Record the date, OS version, package artifact, machine architecture, camera type, and result for each row.

| Scenario                        | Required result                                                           | Date    | Evidence |
| ------------------------------- | ------------------------------------------------------------------------- | ------- | -------- |
| Permission not determined       | Camera prompt appears only after Privacy Continue.                        | Pending | Pending  |
| Permission granted              | Camera dropdown populates within five seconds.                            | Pending | Pending  |
| Permission denied/restricted    | Actionable recovery message appears; no stream is kept active.            | Pending | Pending  |
| Integrated camera               | Onboarding reaches calibration preview.                                   | Pending | Pending  |
| USB camera                      | Selection requires its own calibration.                                   | Pending | Pending  |
| One-camera system               | Default camera can continue even when labels are delayed.                 | Pending | Pending  |
| Multi-camera system             | Switching cameras updates selection and calibration status.               | Pending | Pending  |
| Camera busy                     | User sees busy-camera guidance.                                           | Pending | Pending  |
| Camera disconnected/reconnected | Tracking enters recovery and resumes or asks for another camera.          | Pending | Pending  |
| Sleep/wake                      | Session time does not inflate and tracking resumes only when appropriate. | Pending | Pending  |
| Lock/unlock                     | Camera and session state remain consistent.                               | Pending | Pending  |
| Multiple monitors               | Nudge stays inside active display work area.                              | Pending | Pending  |
| 200% zoom                       | Onboarding, dashboard, diagnostics, settings, and nudge remain usable.    | Pending | Pending  |
| Keyboard-only navigation        | All controls are reachable and visibly focused.                           | Pending | Pending  |
| Battery mode                    | Sampling adapts downward when the setting is enabled.                     | Pending | Pending  |

## Release rule

Do not call `v1.0.0` stable until every mandatory row passes or is explicitly documented as a known limitation in the release notes.

## Automated evidence

The dated [Upright 0.6.0 automated receipt](runs/v0.6.0/automated.md) records the exact local checks. Fake-camera automation and a package smoke launch do not satisfy any physical-camera, installer-upgrade, desktop-environment, or accessibility row above.
