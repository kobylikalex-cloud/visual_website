# Gesture Lab architecture audit — 2026-10-23

Inspected the existing local app in `gesture-lab`, starting at commit `5d025b7fb472ed7c6374cacbf68214a30c14d9cb` on `diagnostics/finger-extension`. The working tree was clean; build and ESLint passed. No test runner was configured.

## Current architecture

`App.tsx` mounts `CameraManager.tsx`. That component owns camera permissions, stream lifecycle, MediaPipe startup, frame scheduling, classification/filter maps, telemetry state and debug rendering. It uses session IDs to invalidate cancelled startup requests, closes stale detectors, and releases the stream on stop/unmount/error. These lifecycle paths are preserved.

The CPU HandLandmarker runs synchronously on the main thread in VIDEO mode, with up to two hands. A requestAnimationFrame loop skips duplicate video frames and limits inference to once per 50 ms (at most 20 Hz). Model and WASM paths are same-origin local assets (`/models/hand_landmarker.task`, `/mediapipe`). No application video/landmark upload or external inference service is present in the inspected source. This patch adds none.

Recognition uses MediaPipe world landmarks for geometry; normalized image landmarks are used only for debug drawing. Orientation is already a separate pure module. Pose and orientation filters are stored independently by handedness label, falling back to detection index. React state exposes classifications to the debug view; there is no pointer/scroll/click/drag action layer.

## Highest-priority weaknesses

| Priority | Finding | Consequence / next step |
| --- | --- | --- |
| 1 | Original pose classification reads only the PIP angle and accepts three of four fingers; tips are ignored. | A hand with straight PIP joints and curled distal joints becomes OPEN. A mixed hand can become OPEN/FIST. Addressed conservatively in this patch. |
| 1 | Original pose filter returns the old known pose during uncertainty and opposite-pose confirmation. | Future consumers could act on stale intent. Pose output now becomes UNKNOWN immediately while confirming again. |
| 1 | Orientation filter still retains its previous known state during TRANSITION. | Its output remains diagnostic only. A future action-state layer must require current pose, current orientation, quality and freshness together. |
| 1 | Handedness labels are treated as track IDs. Duplicate labels share filters; label flips and detection-index changes can transfer history. | Use one-to-one spatial association with ambiguity rejection and per-track resets before implementing two-hand controls. |
| 1 | No frame-age expiry, camera-stall gate, occlusion estimate or geometric consistency-over-time check. | No-hand detections delete filters, but a frozen stream or long scheduling gap does not explicitly expire them. Add explicit local timestamps and loss/reacquisition policy before controls. Finite coordinates alone do not prove reliable tracking. |
| 2 | Palm orientation uses unsigned wrist-to-middle-MCP depth and the absolute palm normal. | It cannot distinguish palm/back, up/down, or scroll direction. Image tilt is diagnostic but unused for classification. Define camera-relative control semantics and directional axes before actions. |
| 2 | Orientation bands come from a single laptop observation (upright ~16 degrees depth/~91% facing; flat 53–61 degrees/~41–60%). | Camera-relative UPRIGHT_LIKE/FLAT_LIKE are candidates, not calibrated physical upright/horizontal poses. Do not generalize or retune without labeled measurements. |
| 2 | Geometry omits MCP flexion and thumb opposition. Both finger joints can look straight while flexed at the knuckle; occlusion can produce plausible false landmarks. | Full finger/palm-relative features and real-world validation remain necessary. This patch is not a complete anatomical pose classifier. |
| 2 | Camera, inference and React/debug work share one large component and main thread. | CPU inference and per-frame debug state can delay UI. Measure frame time, dropped frames and state latency before moving processing to a worker. |
| 2 | Debug originally starts enabled in production. | Camera and skeleton are now hidden by default. Explicit Debug ON preserves opt-in diagnostics. No visible gesture cursor or virtual hand is added. |

## First isolated improvement

The patch preserves the camera inference and resource lifecycle. It separates:

- `TrackingQuality.ts`: finite, complete landmark validation only; not a confidence or occlusion score.
- `FingerGeometry.ts`: unrounded PIP/DIP angles and scale-normalized MCP-to-tip reach.
- `HandPoseEngine.ts`: per-finger classification and conservative whole-hand agreement.
- `HandPoseStabilizer.ts`: confirmation, invalidation and reset state; re-exported from the original engine for compatibility.
- `HandOrientationDiagnostics.ts`: existing independent palm metrics/classification, unchanged.
- `FingerExtensionDiagnostics.ts`: rounded readings from the same geometry used by recognition, now including DIP angles.

Both finger joints must agree within the existing angle bands (extended >=145 degrees; curled <=125 degrees). All four non-thumb fingers must agree to publish OPEN or FIST. Mixed, contradictory, malformed, dead-band or collapsed-finger geometry yields UNKNOWN. Reach remains telemetry, with no invented cutoff. The former absolute squared-length epsilon is replaced by vector normalization and explicit degeneracy rejection, avoiding scale-dependent validity decisions.

The 145/125 degree values and 150 ms pose confirmation duration are retained, not tuned. Reusing the angle bands for DIP and requiring full agreement is a conservative policy hypothesis, not a measured optimal classifier. It may reject real open hands/fists more often, particularly with noisy or occluded fingers. Real captured sequences must validate this tradeoff before activating controls. Known poses now require a fresh confirmation window after uncertainty, reset, backwards/non-finite timestamps or an opposite-pose candidate. No confidence settings or orientation thresholds change.

No clicking, dragging, scrolling, pointer movement, two-hand acceleration or action authorization is implemented. Existing orientation labels must not be consumed as control authorization.

## Evidence and reproduction

From the existing `gesture-lab` directory, using Node **24.14.0** and the existing installed dependencies:

```text
npm test       # TypeScript-checks tests/modules, then runs Node's built-in test runner
npm run build  # TypeScript project build and Vite production build
npm run lint   # ESLint across app and tests
```

No test dependencies or project scaffolding were added. Tests use analytic 30 mm bone fixtures; no camera frames or personal landmarks are stored.

Before implementation, the initial seven regression tests had **1 pass / 6 failures**, reproducing distal folding, mixed-pose, invalid-tip and stale-state defects. After implementation, the complete suite has **18 passes / 0 failures**. Analytic measurements verify a straight finger at 180/180 degrees and 100% reach, and a folded finger at 90/90 degrees and 33.33% reach. The invariance test checks 128 combinations across four pose fixtures, four rotations, reflection and four scales. Other tests cover exact bands, unrounded decisions versus rounded telemetry, every measured collapsed bone, all 21 landmark positions, sparse data, interrupted confirmation, reset/reacquisition and invalid timestamps.

Build and ESLint pass. An independent read-only review found no blocking findings and reran all 18 tests successfully. Production-preview browser inspection confirms `Debug: OFF`, video opacity 0 and canvas opacity 0 on initial load. Physical camera capture and live-user recognition accuracy were not tested in this session.

## Measurement-led next steps

Before changing thresholds or enabling controls, collect explicitly opt-in labeled sequences locally across both hands, camera angles/distances, lighting, partial finger occlusion, transitional/mixed poses and two-hand crossings. Keep participant/session-separated evaluation sets. Compare baseline and candidate confusion matrices, especially false OPEN/FIST, unknown rate, state transition latency and false persistence after tracking loss. Label orientation and finger pose separately. Use these measurements to decide whether DIP bands, anatomical features, orientation calibration or temporal policy need revision; synthetic invariance tests cannot establish those values.

Then add per-track identity/quality/freshness and a conservative action-free gesture-state layer. Upright-open, horizontal-open, closed-fist and two-horizontal-palms should remain distinct intents; ambiguity, opposing two-hand directions or stale data must yield no intent. Implement actual actions only in a later approved scope.
