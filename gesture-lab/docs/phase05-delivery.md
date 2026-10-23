# Phase 05 — Interactive Gesture Playground

Implemented in the existing app, starting from clean `70de000` on a dedicated `codex/gesture-playground` branch. No project recreation, remote service, merge or push.

## Functional gestures

| Gesture | Result | Authorization and cancellation |
| --- | --- | --- |
| One upright open palm | Mirrored, smoothed invisible pointer; nearby buttons/card respond through proximity and locked magnetic focus | Requires continuously valid open/upright recognition for 150 ms. Focus requires another 150 ms on the same eligible target. The point is never rendered. |
| Full closed fist | One local button activation, or grabbing and moving the dedicated card | Requires a previously confirmed open hand and locked target, then a fresh 200 ms full-fist confirmation. Holding closed never repeats a click. Opening releases a drag, with no click. A new grasp needs reopening/rearming. |
| One horizontal open palm | Continuous signed journal scrolling relative to its own entry neutral | Flat recognition must persist for 180 ms. Neutral is captured when confirmation completes. Above neutral scrolls up; below scrolls down; dead zone stops motion. |
| Two horizontal open palms | Approximately 3× the average of the two single-hand velocities | Requires two distinct spatial identities, independently confirmed. Both must indicate the same nonzero direction. Disagreement, ambiguity, an invalid hand or a neutral hand yields zero velocity. A changed identity/count clears and reconfirms both neutral state and intent. |

Natural closure often traverses mixed-finger UNKNOWN readings. An already locked open-hand target may wait in a **dormant 350 ms closing bridge**, with no pointer, click, drag or scroll output. The deadline cannot extend. Only a valid same-identity upright full fist can advance it; the fist then starts its entire 200 ms confirmation from zero. Invalid tracking, stale frames, changed identity/count, orientation uncertainty, target loss, movement away or resize cancels the bridge. UNKNOWN after fist confirmation has begun cancels that grasp. This permits deliberate closure without treating UNKNOWN as authorization.

## Independent modules

- `ControlRecognition.ts`: control-specific PIP/reach recognition, requiring all four non-thumb fingers to agree. It retains the historical hybrid evidence bands and removes the uncalibrated DIP veto. Complete finite/degenerate validation remains. Existing conservative and historical hybrid A/B classifiers are untouched.
- `HandTracker.ts`: one-to-one spatial assignment from image palm centers; handedness labels are never track IDs. Rejects malformed/edge-on geometry, unsupported counts, close/ambiguous/crossing trajectories, excessive jumps and expired/nonmonotonic frames. Reacquisition gets fresh IDs.
- `InteractionEngine.ts`: temporal intent, open-hand arming, dormant closure, focus/grasp state, rearming and immediate invalid-output clearing.
- `PointerController.ts`: mirrored normalized active-area projection, elapsed-time exponential smoothing and movement dead zone.
- `TargetSelector.ts`: proximity, capture/exit hysteresis, switch margin and focus dwell.
- `ScrollController.ts`: per-identity flat confirmation/neutral, smooth bounded speed and same-direction two-hand arbitration.
- `GestureConfig.ts` / `MovementCalibration.ts`: explicit UX settings, local pointer recentering, scroll adjustments and bounded card position. Calibration changes movement, not pose thresholds.
- `PlaygroundController.ts`: camera-frame-to-effect boundary plus animation-time watchdog. It dispatches each click/drag delta once and integrates scroll velocity into pixels per animation interval. Late inference cannot authorize actions.

`App.tsx` binds this control layer to explicitly registered `pulse`, `palette`, `reset` and `orbit-card` targets. Button effects update local React state; drag updates one bounded card position; scrolling calls only the journal element. There is no general DOM `.click()`, OS cursor control, browser-history action or window scrolling.

Camera startup, cancellation/session IDs, local HandLandmarker loading and resource release are preserved. `CameraManager.tsx` adds a fresh-frame callback and inactivity notification. Video/canvas stay mounted for inference but have no layout or visibility until debug is enabled. Debug A/B labeling is preserved and synchronously cancels actions when recording starts. Camera controls and debug/calibration controls are never gesture targets.

## Default settings and their status

Recognition uses the existing provisional hybrid evidence: extended if `(PIP >=145 and reach >=65) or (PIP >=100 and reach >=70)`; curled if `PIP <=135 and reach <=58`. All four fingers must agree. This addresses observed open reaches of 91–97% and curled reaches of 32–43% despite DIP boundary crossings; it is a functional prototype choice, not a new accuracy claim. Mixed/contradictory feature evidence stays UNKNOWN. The palm-orientation module and its original camera-relative bands are unchanged.

The existing 50 ms inference interval grounds the 150/180 ms confirmation periods and 200 ms freshness watchdog (four nominal frame intervals). The 350 ms dormant closure budget is the existing 150+200 ms intent/grasp budget, with a separate fresh fist confirmation. Its purpose is transition usability, not classifier threshold tuning.

Movement defaults are openly configurable UX parameters: 80 ms smoothing, a 0.4% normalized pointer dead zone, 15–85% image active area, target capture/exit radii 55/90 CSS px, 18 px switch margin, 3.5% neutral Y dead zone, a smooth speed ramp saturating at 20% normalized displacement, 650 px/s single-hand maximum and 3× pair multiplier. Spatial identity defaults (18% max inter-frame match distance, 3.5% ambiguity margin, 12% crossing separation) err toward stopping rather than guessing. These are initial interaction/tracking defaults, not empirically optimal or universal anatomical thresholds.

## Action boundary and cancellation

Missing/invalid detections stop effects on that result. An independent animation watchdog covers a frozen/no-new-frame camera; intent expires at 200 ms rather than persisting indefinitely. Late inference, excessive frame gaps, identity/count changes, uncertainty, duplicate/nonmonotonic timestamps and layout changes clear authorization. Starting with a closed hand cannot activate anything. Dragging never enters the click path.

Escape pauses actions until explicit resume. Tab hiding, window blur, resizing, camera stop/error/unmount, recalibration and manual demo input cancel pending intent. Frame processing also checks page visibility/focus. Recording evaluation samples cancels synchronously, so active scrolling cannot continue while waiting for the next inference callback.

## Validation

Automated coverage includes gesture transitions, deliberate and gradual closures, target hysteresis and focus locking, one-shot clicks, drag/release separation, independent neutral positions, signed velocity/dead zone, two-hand disagreement and joining/disappearing hands, crossing/ambiguous association, source/frame expiry, no-new-frame watchdog, invalid data, dormant-close barriers and late inference. Integration tests feed complete image/world landmark sequences through recognition, tracking, interaction and the effect adapter; they verify actual callback counts, incremental drag output and scroll cancellation, including synchronous evaluation-start cancellation.

Browser checks cover native demo activation and palette changes, keyboard card movement, genuine long scroll content, compact desktop layout, debug-only visibility, calibration/evaluation controls, and physical camera initialization. With gesture effects paused, Edge reported **1280×720**, video ready state **4**, advancing video time and source **USB Camera (3277:00fa)** while the feed was hidden. Turning debug on retained the live stream and exposed the existing diagnostics; camera stop returned to the idle controls. No physical hand gesture accuracy or usability benchmark is claimed from this hardware startup check.

An independent read-only review identified gradual-closure authorization loss and delayed evaluation-start cancellation. Both were fixed with regressions. Earlier recognition/evaluation tests remain in the suite. Run `npm test`, `npm run build`, and `npm run lint` from the app directory; final results are reported with delivery.

Verified final functional suite: **75/75 tests pass**; **TypeScript/Vite build passes**; **ESLint passes**. No test dependency was added. The camera, orientation and A/B baselines remain local and intact.

## Remaining limits

- Real-world reliability still depends on camera angle, full-hand visibility, lighting, occlusion and naturally bent fingers. Orientation remains camera-relative, with existing single-webcam calibration, not gravity sensing. Use debug to inspect raw orientation and calibrate comfortable pointer reach.
- The device API cannot prove whether a camera is physically internal. This machine exposes one `USB Camera`; choose the laptop camera in the browser permission/device menu. No alternate hardware is required or automatically selected.
- A full hand crossing entirely between sampled frames cannot be perfectly reconstructed. The spatial tracker rejects observable ambiguity/close trajectories and reacquires conservatively; it does not claim persistent biometric identity.
- Processing remains synchronous CPU MediaPipe on the main thread at at most 20 Hz. Long inference stalls suspend actions. During development hot reload, reload/restart the camera before testing; production preview avoids hot reload.
- On small/mobile viewports the responsive page may require ordinary page scrolling to bring a demo into view. Gesture scrolling intentionally affects only the dedicated journal pane. Off-screen demo targets are excluded.
- No recorded-data population accuracy, false-positive rate or physical-motion latency is established by deterministic tests. The local A/B labeling workflow remains available for those measurements; actions stay paused while it records.

## Changed files

UI/integration: `src/App.tsx`, `src/index.css`, `src/components/GesturePlayground.tsx`, `src/components/playground.css`, `src/components/CameraManager.tsx`, `src/components/DebugEvaluationPanel.tsx`, `index.html`. The unused template `App.css` is preserved.

Control layer: `src/control/types.ts`, `GestureConfig.ts`, `ControlRecognition.ts`, `HandTracker.ts`, `InteractionEngine.ts`, `PointerController.ts`, `TargetSelector.ts`, `ScrollController.ts`, `MovementCalibration.ts`, `PlaygroundController.ts`.

Tests/docs: `tests/control-tracking.test.ts`, `tests/control-interaction.test.ts`, `tests/playground-controller.test.ts`, `README.md`, this delivery note and `docs/superpowers/plans/2026-10-23-gesture-playground.md`.

Launch commands and live gesture instructions are in the project README. No new package dependency or project scaffold was added.
