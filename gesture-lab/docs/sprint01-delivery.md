# Sprint 01 delivery and live acceptance

Date: 2026-10-23. Branch: `codex/sprint01-open-upright`, based on `fix/gesture-stability-first-pass` bcc54be. No branches merged; no push. Final commit is reported in the delivery message and in the debug build badge after server reload/build.

## Architecture audit and reuse

| Branch inspected | Findings | Reuse |
| --- | --- | --- |
| `codex/gesture-playground` e46947c | All gesture actions coupled in one state machine; synchronous CPU inference on UI thread; synthetic accuracy insufficient | Existing React playground, local camera lifecycle, native handlers, geometric features, orientation, target selection |
| `fix/gesture-stability-first-pass` bcc54be | Improved visible-palm tracking and guarded 3/4 finger consensus; reduced React updates; still synchronous inference and multiple active gestures | Base of new branch; spatial IDs, palm center, orientation and recognition bands unchanged |
| `origin/fix/gesture-engine-performance` ba9c4d3 | Single-frame worker and debug throttling useful; GPU preferred without measured CPU/GPU comparison; several experimental gesture changes unrelated to scope | Camera/worker foundation selectively adapted, with module-loader compatibility, cancellation tokens, measured comparison and explicit metrics |

No classifier thresholds were relaxed. Default pointer smoothing remains 140 ms exponential time constant and normalized dead zone .007 from the base branch; 150 ms pose confirmation, 200 ms observation expiry, target enter/exit 55/90 px and 18 px switch advantage are inherited prototype settings, not measured universal optima. Calibration changes comfortable center and movement gain. Filter settling contributes additional motion lag beyond frame delivery.

The active App imports OpenPointerEngine and HandTracker, never the old PlaygroundController/InteractionEngine/ScrollController. It has no gesture effect callbacks. Those older modules/tests remain historical regression references, outside the live path. Every pointer snapshot has null click/drag and zero scroll output. Unknown freezes movement; a bounded existing visual focus can survive brief uncertainty. Loss, ambiguity, identity replacement and stale delivery clear it. Native controls are preserved.

## Changed files

- `src/control/OpenPointerEngine.ts`: upright-only confirmation, spatial identity, independent freshness watchdog, smooth pointer and magnetic targets.
- `src/tracking/TrackingPerformance.ts`, `protocol.ts`: bounded sample distributions, single in-flight token gate and typed local worker transport.
- `src/workers/handTracking.worker.ts`: local MediaPipe inference, module WASM assets, same-frame delegate comparison and bitmap disposal.
- `src/components/CameraManager.tsx`: existing getUserMedia/session lifecycle plus worker, bounded frame admission, presented-frame counting, stale rejection, explicit fallback and performance/debug reporting. Historical A/B remains available in a disclosure.
- `src/App.tsx`: pointer-only wiring, RAF target feedback, pause/lifecycle handling, calibration and local acceptance measurements. No gesture action adapter.
- `src/evaluation/PointerMeasurement.ts`: stationary capture, focus/confirmation loss counters including watchdog/cancellation, and capture-to-first CSS timing.
- `src/components/PointerDebug.tsx`: debug observation and local numeric-summary download.
- `src/components/GesturePlayground.tsx`, `playground.css`: five native buttons in different regions and sprint-specific instructions; normal mode hides camera, landmarks and point.
- `tests/open-pointer.test.ts`, `performance.test.ts`, `pointer-measurement.test.ts`: sprint regressions alongside the preserved full suite.
- `README.md`, this report and `docs/sprint01-plan.md`: launch instructions, protocol, audit and limitations.

The pre-existing App.css worktree status was preserved; it had no content diff. Orientation, finger classification, original camera device selection and native mouse/keyboard behavior were not replaced.

## Measurement definitions and limitations

- Render FPS is main-thread requestAnimationFrame cadence, not compositor/GPU presentation FPS. A background tab is throttled and is unsuitable for performance acceptance.
- Processed FPS counts completed inferences; stale completed results remain in latency statistics but never reach pointer control. Camera FPS uses requestVideoFrameCallback presentedFrames where supported. Unprocessed includes deliberate rate limiting and busy dropping, not merely camera/device failure. Busy/stale/transfer counts are separate.
- Inference median/p95 are worker execution time. Processing covers result interpretation/debug/control publication. Delivery covers bitmap capture start to publication; feedback covers capture start to first CSS update. Camera exposure, physical motion onset, display presentation and GPU utilization are not independently observable. No physical end-to-end latency or native NPU claim.
- Samples are bounded (300 for performance/feedback, 1800 pointer samples); counts/FPS are session cumulative. Stationary RMS is radial spread about the mean in screen pixels; it only represents jitter when the user truly holds the palm still. Confirmation losses include deliberate disengagement/pause during an active capture.
- Same-frame comparison is an alternating sequential microbenchmark with two loaded graphs. It excludes warmup, reports failures and chooses p95. Different lighting, hand count, thermal state or device can change results; compare single-delegate steady-state runs as well.
- Handedness score is not a reliable pose/tracking confidence; only actual spatial ID and geometry-validity reasons are shown. MediaPipe detection/presence thresholds are configuration, not per-frame confidence estimates.
- There are no external inference, telemetry or video upload endpoints. Assets are bundled locally. Optional historical labeling holds local landmark samples only in browser memory and exports only on explicit download.

## Repeatable webcam protocol

Keep the same camera, seating distance, lighting, browser viewport and movement-range calibration. Keep one foreground tab; close other camera sessions. Reload after source changes. Debug ON shows the selected delegate and numeric build badge.

1. Stop camera, select Compare CPU/GPU, start; let the five warmups and twenty measured pairs finish. Verify both results or explicit unavailability. Save summary. Then test the selected delegate at steady state.
2. Raise one clearly open upright hand. Verify raw OPEN_UPRIGHT, confirmed true, one stable spatial ID and a nearby highlighted target. Record software feedback latency. Visual onset still needs human judgement.
3. Select Stationary palm, keep the palm still over Center for ten seconds. Record RMS px, confirmation losses and focus exits. Repeat three times; report every run rather than selecting the best.
4. Select Moving. Traverse North west → North east → Center → South west → South east five times slowly, horizontally and vertically, then repeat faster. Record target changes, interruptions and subjective lag. Holding a target should remain visually steady. Changing focus deliberately is expected.
5. Briefly occlude the hand, remove it fully, then return. Check immediate freeze on uncertain pose, bounded focus hold, stale stop within 200 ms of the last capture, and fresh confirmation on return. A hand no longer detected clears focus immediately.
6. Hold a fist, a horizontal open palm, mixed/unknown fingers, then show two hands. None may click, drag or scroll. Counter, card position and page scroll must remain unchanged except through native input. Pointer feedback must stop for these excluded cases.
7. Debug OFF: verify no camera, skeleton, hand avatar or gesture point. Confirm button hover feedback still responds. Check mouse activation, card arrow-key movement, normal scrolling and Escape/Resume.
8. Download the local aggregate summary for each trial. Human marks pass/fail and notes posture/lighting. Physical camera-to-photon latency requires an independent synchronized recording; current software timing is explicitly a partial estimate.

## Current acceptance status

Validation: `npm test` passes 96/96; `npm run build` (TypeScript + Vite) and `npm run lint` pass. Browser smoke verified a native target increments the counter, ArrowRight moves the card by 8 px, Reset restores both, and normal mode hides video/canvas/debug point. Screenshot: ignored `.local-evaluation/sprint01-playground.png`. These checks are distinct from the open live acceptance scenarios below.

Browser measurements from this machine (Edge, USB Camera `3277:00fa`, 640×480 requested):

| Run / condition | Observed result |
| --- | --- |
| Same-frame comparison, 20 measured frames after five warmups | CPU median 164.3 ms / p95 220.7 ms; GPU median 46.4 ms / p95 50.9 ms; GPU selected |
| Subsequent no-hand steady-state snapshot | Camera 10.0 FPS, processed 9.5 FPS; RAF cadence 109.4 FPS, interval p95 27.2 ms; inference median/p95 22.2/28.6 ms; publication delivery 25.6/38.6 ms; result processing .4/.6 ms |
| Same session counts at that snapshot | 1175 completed / 1225 camera frames, 50 unprocessed; 51 busy, 12 stale, zero transfer rejections; three long tasks totaling 221 ms. Stale samples include the deliberately slower paired benchmark. Counters are not disjoint; stale is already completed. |
| Earlier exploratory live hand trial, before final frame-admission/focus corrections | OPEN_UPRIGHT confirmed, spatial ID 22, target test-1 highlighted at distance 26.2 px; processed 15.9 FPS from camera 29.6 FPS; inference 47.3/65.7 ms, delivery 51.9/80.5 ms. This establishes connection, not final acceptance. |

The two steady states have different hand content and camera frame rates, so they are not an accuracy or before/after speed comparison. The first trial's busy counts were invalid because currentTime can advance without a new camera frame; the final requestVideoFrameCallback gate fixes that source. Numeric evidence remains in ignored `.local-evaluation/sprint01-first-live.txt` and `sprint01-benchmark.txt`; no video was exported. Final stationary RMS and software CSS feedback latency were unavailable because a labeled stationary capture was not performed. Actual physical end-to-end latency remains unmeasured.

An independent whole-change review found and prompted regression fixes for focus recovery after one uncertain frame, confirmed-open expiry using the wrong interval, canceled benchmark state leaking into fallback, and counters missing watchdog/cancellation loss. No recognition/orientation thresholds were changed to address those failures. The first two failures were reproduced as failing tests before correction; measurement watchdog and ten-second capture are covered separately. The module worker and dual-delegate loader failures were reproduced and corrected in the real browser.

Live recognition and a target response have been observed, but the full repeated protocol is not signed off. Stationary jitter, stable focus over all five targets, faster movement, occlusion, removal/re-entry and physical perceived latency still require live user verification. Do not begin the next gesture sprint until that review passes.

Google's [Hand Landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js) documents synchronous detectForVideo and recommends worker execution. Runtime compatibility and measured results here are verified against the installed local package, not inferred from that recommendation.
