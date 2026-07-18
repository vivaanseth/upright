# Camera troubleshooting

Upright requests video access only after you continue from the Privacy screen. It never requests microphone access.

## macOS

Open **System Settings → Privacy & Security → Camera**, enable Upright, then quit and reopen the app. If Upright is not listed, return to onboarding and choose **Try camera again** to trigger the system prompt.

## Windows

Open **Settings → Privacy & security → Camera**. Enable camera access and **Let desktop apps access your camera**, then return to Upright and retry.

## Linux

Close other applications that may own the camera, reconnect USB cameras, and verify your user can access the video device. Sandboxed package systems may require a separate camera permission. Linux desktop environments do not expose one universal privacy-settings location.

## Still not working

- Quit video-conferencing and browser apps that may be using the camera.
- Disconnect and reconnect an external camera.
- Remove a stale saved camera choice by retrying; Upright will fall back to the current default camera only during startup.
- Include your OS, package format, camera model, and the exact message shown when opening a bug report. Never attach camera frames or private session data.
