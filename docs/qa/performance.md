# Performance QA

Upright should remain quiet enough to leave running all day. These targets are evaluated with fake-camera automation first and then with real cameras on the compatibility matrix.

## Targets

| Metric                          | Target                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| Cold launch                     | Under 4 seconds                                                                      |
| Warm launch                     | Under 2 seconds                                                                      |
| Median inference                | Under 150 ms                                                                         |
| Five-minute CPU median          | Under 15% of one logical core on a representative laptop                             |
| Tracking private memory         | Under 300 MB                                                                         |
| Paused private memory           | Under 180 MB                                                                         |
| Thirty-minute memory growth     | Under 20 MB                                                                          |
| Windows/Linux primary artifacts | Under 150 MB where packaging permits                                                 |
| macOS universal artifact        | Target under 215 MB; document the dual-architecture Electron exception when exceeded |

## Method

1. Use a clean user-data directory.
2. Launch the packaged app, not the dev server.
3. Complete onboarding with fake camera or a real camera.
4. Record launch timing from process start to first ready window.
5. Record Electron process metrics for main, renderer, utility, and GPU processes.
6. Prefer private memory or working-set-private over summed RSS so shared Chromium pages are not double-counted.
7. Record median and p95 inference latency from development diagnostics.
8. Repeat paused, preview, and tracking measurements.

## Current evidence

The 2026-07-18 Upright 0.6.0 x64 application bundle occupied approximately 268 MiB unpacked on macOS 14.7.7. This is a package observation, not a runtime performance result. Cold/warm launch, private memory, five-minute CPU, inference latency, drop rate, and thirty-minute growth remain unmeasured with the method above and therefore remain release-candidate blockers.
