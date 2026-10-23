# Sprint 02 — reliable fist-to-click implementation

Date: 2026-10-23. Branch `codex/sprint02-fist-click`, based on Sprint 01.1 commit 76080c5. No push or merge. The existing App.css worktree status is preserved. Sprint 01's smooth open navigation is user-accepted; Sprint 02's complete real-camera acceptance is pending.

## Implementation and files

- `src/control/FistClickEngine.ts`: pure wrapper around the unchanged OpenPointerEngine; stable focus → bounded closing transition → continuous full-fist evidence → one activation → confirmed release. Keeps locked target ID, registration token, spatial hand ID, original palm anchor and original target rectangle. Rejects changed/disabled/missing/replaced/moved targets, excess palm travel, ambiguity, two hands, stale/nonmonotonic frames, viewport/config changes and flat palms. A canceled attempt cannot recover via a held fist or retarget a neighbor.
- `src/control/InteractionTargetRegistry.ts`: explicit application callbacks, live eligibility, owner/token validation and one-shot sequence consumption. No arbitrary DOM click dispatch or OS mouse events.
- `src/control/TargetElements.ts`: registers eligibility only for test-0 through test-4; current visibility, viewport intersection, disabled/inert/aria-hidden state, original DOM owner and token are checked again at dispatch. Other existing controls retain open-pointer feedback and native input but have no gesture action token.
- `src/control/ControlRecognition.ts`: retains OPEN's guarded 3-of-4 consensus. FIST now requires all four non-thumb fingers to satisfy the existing PIP-angle and normalized-reach closure evidence. No DIP hard veto, rigid thumb shape or pinch shortcut.
- `src/control/types.ts`: optional target registration token.
- `src/App.tsx`: tracker → click wrapper → registered action, last-moment freshness/focus/pause checks, live target checks during confirmation, target feedback at RAF cadence, debug publication at 10 Hz. Native and registered actions share application state handlers. Per-button counts and activation pulse update only on actions.
- `src/components/GesturePlayground.tsx`, `playground.css`: existing layout retained; stable focus, restrained fist progress, one short pulse per activation and native per-button counts. No normal-mode camera, skeleton or artificial pointer.
- `src/components/PointerDebug.tsx`: actual pose, confirmation phase, tracked ID, target lock/progress, accepted/rejected counts, last cancellation and observed confirmation/action latency; aggregate local JSON export.
- `tests/fist-click.test.ts`, `fist-pipeline.test.ts`, `fixtures/controlHand.ts`, updated `control-tracking.test.ts`: intent and cancellation safety, registered dispatch, both mirrored hands, raw geometry pipeline, four-finger requirement, thumb freedom, scale/rotation, gain/navigation parity and release reset.
- `docs/sprint02-plan.md`, this report and `README.md`: scope, rationale, checks, limitations and acceptance protocol.

CameraManager, GPU/CPU worker, orientation implementation, spatial tracker, pointer gain/mapping/smoothing and OpenPointerEngine are unchanged. The production worker artifact still has the same content hash `handTracking.worker-BixMcT-V.js` as Sprint 01.1. Existing native card dragging remains native input only; no gesture drag/grab/scroll implementation is connected.

## Parameters and evidence

Stable target focus 150 ms, full-fist confirmation 200 ms, initial/renewed uncertain closure window 350 ms, total closure deadline 550 ms, and observation freshness 200 ms. Only fresh, new full-fist observations accumulate confirmation; UNKNOWN resets the fist interval and never activates. RAF ticks never emit clicks. Opening upright must reconfirm for the existing 150 ms before another selection/click is available. Default gain remains 1.6× and tuning preserves the existing filter behavior during open navigation.

Closure travel is independently bounded at .08 normalized camera units from the last open palm center; it does not grow with magnetic radius, viewport size or pointer gain. Target geometry must remain unchanged during closure. These are conservative engineering starting values and require live validation, not universal human-factors claims.

Finger evidence reuses PIP ≤135° AND MCP-to-tip reach ≤58% of summed finger-bone length, on all four fingers. The local earlier recording review (`.local-evaluation/analysis.md`, 36–38 s) found held-fist PIPs 77–104°, reaches 32–43% and index DIP 127–128°. That supports the multi-feature separation and avoiding a DIP veto. The recording has rounded UI readings and lacks exact landmarks/timestamps; it cannot prove replay accuracy or current click latency. Open-hand acceptance bands and personal movement calibration were not loosened. No validated personal finger-truth calibration exists in the active branch; movement calibration does not train fist recognition.

## Verification and performance findings

Validation: 115/115 automated tests pass; TypeScript/Vite production build and ESLint pass. OpenPointerEngine, PointerController, HandTracker, orientation and worker sources have no diff against 76080c5. The strict FIST requirement is isolated from OPEN recognition.

Automated tests cover no target, unregistered target, insufficient focus, initial fist/UNKNOWN, exactly one activation, held-fist lockout, confirmed reopening, partial closure, bounded UNKNOWN and interrupted fist evidence; cancellation on hand/target identity, tracking/freshness, eligibility/layout, excess movement, two hands and flat palms; original target despite a closer neighbor; registry duplicate rejection; complete raw-landmark pipeline for either mirrored hand; four-finger and non-rigid thumb evidence; exact open-only pointer/focus/proximity parity with Sprint 01.1, including gain updates. Synthetic analytic fixtures are explicitly not webcam accuracy evidence.

Browser smoke: native mouse activation on North west and Enter activation on North east each incremented exactly their own counter; global count became 2. ArrowRight still moved the native card by 8 px; Reset restored counts/card. Debug displayed actual pose/state/lock. Normal mode hides video/canvas/debug point. No camera gesture was claimed from these native-input checks.

A local Node 24 microbenchmark compared the original OpenPointerEngine against its new wrapper on identical analytic OPEN frames, alternating order, with 2,000 warmups excluded and 20,000 measured pairs. Before median/p95: .0016/.0038 ms; wrapper median/p95: .0025/.0056 ms. This measures pure state processing only, excluding DOM eligibility, React/rendering, MediaPipe, video and physical latency. Numeric results are in ignored `.local-evaluation/sprint02-state-benchmark.json`. It suggests the added state logic is small; it does not establish browser FPS or webcam reliability.

Current hardware render FPS, tracking rate, median/p95 inference, stationary jitter and fist confirmation/action latency must be captured in the foreground webcam acceptance run. Existing debug instrumentation remains available. Previous Sprint 01 figures (GPU median/p95 46.4/50.9 ms in a same-frame CPU/GPU comparison) are historical and must not be mislabeled as a matched before/after Sprint 02 measurement. RequestAnimationFrame cadence is not compositor FPS, and software frame-to-action timing excludes camera exposure/physical motion onset and display presentation.

Independent code review found no additional important issues after first-frame target token/layout replacement was fixed with a failing-then-passing regression. A separate regression fixed progress remaining at 100% after reopening. Counts of rejected intent are not false-positive/negative rates; those require human-labeled deliberate and negative attempts.

## Real-webcam acceptance — pending user sign-off

Run the existing application, not a new project:

```powershell
Set-Location -LiteralPath 'C:\Users\kobyl\vision_website\gesture-lab'
npm run dev -- --host localhost --port 5174 --strictPort
```

If already running, open http://localhost:5174 directly. Reload after source changes. Keep one foreground camera tab, consistent lighting/device/viewport and comfortable-center calibration. Leave gain at the accepted 1.6× initially. Debug ON exposes numeric diagnostics; normal mode should still have no camera/skeleton/cursor.

1. Reload for a clean trial, start camera, raise one upright open hand, select a test button, wait for its stable highlight, close a full fist for ~200 ms, then reopen. The originally selected button alone must pulse/increment.
2. **A: 20 deliberate clicks.** Make twenty complete open → select → fist → reopen cycles. Record intended attempts, debug valid clicks, misses and every unintended activation. Target: at least 20 deliberate successes with no unintended activation. Keep native clicks separate.
3. **B: all five targets.** Activate North west, North east, Center, South west, South east repeatedly. Close with natural palm displacement toward a neighbor. Target: zero wrong-target clicks.
4. **C: held fist and release.** Hold a confirmed fist for several seconds: count must stay at one. A brief or incomplete reopening must not rearm; confirmed upright opening must allow the next deliberate click.
5. **D: negatives.** Try partial closure, UNKNOWN, unrelated motion, flat palms, two hands, tracking loss/return and fast palm displacement. None may activate unintentionally. An aborted closure must need reopening, never automatically choose a different button.
6. **E: matched performance.** With comparable hand content and camera conditions, record displayed RAF cadence, processed/camera FPS, inference median/p95, processing/delivery latency, last observed fist-confirmation/action latency and 10-second stationary RMS/focus losses. Export the local numeric summary. Physical perceived responsiveness and recognition truth remain human observations.
7. Verify ordinary mouse/keyboard buttons, card movement, native scrolling, Escape/Resume and Debug OFF privacy. Only five registered test buttons accept fist clicks; the card and other controls do not.

Stop here for acceptance. No dragging/grabbing, horizontal scrolling, two-hand controls or extra gesture shortcuts are authorized by this sprint.
