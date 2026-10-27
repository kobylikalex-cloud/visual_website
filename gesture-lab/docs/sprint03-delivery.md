# Sprint 03: horizontal palm page scrolling

Branch: `codex/sprint03-palm-scroll`. Rollback baseline: `6a1573f` (accepted multi-view pointer/fist implementation). No push or merge. Pre-existing App.css status is preserved.

## Behavior

The new PageGestureEngine routes mutually exclusive pointer/click and scroll modes. It composes the existing FistClickEngine; that engine, OpenPointerEngine, finger classifiers, pointer filter/gain/mirroring, camera capture and inference worker are unchanged. HandTracker additionally publishes its existing orientation metrics.

An open flat palm confirms across >=3 observations and >=200 ms, then waits for >=250 ms of stable height to capture the average neutral. An intermediate rotation cannot enter scrolling. The initially measured orientation band is depth >=42° and facing <=75%; confirmed sessions use a wider retention band (depth >27°, facing <90%) to accommodate the 50°→31° change observed while the user raised the arm. Personal flat-pose capture uses a bounded recent stable single-hand OPEN window, with observed spread as slack; upright/unstable/stale/identity-mixed captures are rejected. Calibration lasts for the current page session.

Upward displacement from neutral yields negative page velocity; downward yields positive. Smoothstep maps displacement outside a 3% dead zone to a provisional 600 px/s maximum at 16% displacement. These settings are independent of pointer gain. Neutral produces exact zero with no momentum or automatic center drift. Reset neutral restarts the entry/settling process. UNKNOWN immediately pauses all effects. Brief same-hand UNKNOWN gaps preserve recent entry evidence or an existing neutral only until the last confirmed OPEN observation's existing 200 ms expiry; UNKNOWN never counts as confirmation or renews that deadline. A fresh valid OPEN may resume without replaying paused time. FIST, invalid orientation, identity replacement, hand loss, a second hand, stale tracking, blur, hidden tab, resize and Escape discard intent and neutral.

An isolated orientation crossing also pauses instead of immediately erasing a captured neutral. A sustained upright return uses the existing 150 ms confirmation interval, then the protected pointer reconfirms (approximately 300 ms total plus delivery). Personal calibration cannot override the original clearly upright band (depth <=27°, facing >=70%). Finger and orientation thresholds are unchanged.

RAF integrates at <=50 ms steps and <=200 ms observation age. PageScrollTarget applies instant bounded movement to document.scrollingElement, clamps edges and steps, and retains at most one pixel of native rounding error. Neutral, reversal, stale input and cancellation clear fractional intent; there is no bulk replay. Own document scroll events are distinguished from external scrolls. Wheel/body-touch/body-scroll-key input cancels gesture intent while preserving native defaults. Form-control Space/arrows/taps do not destroy calibration evidence before activation.

## Files

- New control modules: ScrollPoseProfile, PageScrollSession, PageGestureEngine, PageScrollTarget.
- Integration: App.tsx, HandTracker.ts, control/types.ts.
- UI: ScrollDebug.tsx, GesturePlayground.tsx, playground.css. The existing layout is retained; /scroll-test adds seven long practice stations.
- Tests: scroll-session.test.ts, page-gestures.test.ts, page-scroll-target.test.ts. Existing 124 tests remain intact.

## Verification and measurements

- Current suite: 161 passing tests, including raw-landmark mode switching, preserved pointer/click outputs, rotation guards, neutral settling/stop, sign and bounded speed, stale/identity/loss/two-hand cancellation, timestep limits, fresh recovery, page boundaries, fractional rounding, native-input routing, brief-uncertainty entry/resume, orientation outliers, delayed-delivery expiry, guided evaluation lifecycle, paired image/world capture and a debug-only projection candidate. Existing 124 tests are unchanged.
- Final `npm test`, `npm run build` (TypeScript/Vite) and `npm run lint`: exit 0. Worker bundle remains unchanged.
- Independent review found two P2 issues (fractional scroll loss and Space/touch calibration cancellation). Both were reproduced with regression tests and corrected. No further concrete findings.
- Browser checks: mouse North west and Enter North east incremented their own counters once. ArrowRight moved the native card 8 px. Counters were reset. /scroll-test measured 4640 px document height at 621 px viewport; native PageDown changed document scrollTop while inner journal scrollTop stayed zero. Normal mode has no video, skeleton or artificial cursor.
- Worker bundle remains `handTracking.worker-BixMcT-V.js`. No inference/model/delegate changes. Node update+tick CPU comparison (2000 warmups, 10000 alternating-order samples): baseline median/p95 .0018/.0034 ms, wrapper .0031/.0052 ms. This excludes inference, DOM and browser rendering; it cannot establish rendering FPS or physical latency.
- Before implementation, the live HUD showed ~18–20 updates/s and ~40–45 ms inference in sampled moments, not a controlled baseline. The earlier worker watchdog timeout remains unresolved and also occurred before Sprint 03. The page must remain visible and focused for meaningful live measurements.
- Debug reports current mode, orientation, neutral/displacement/velocity, bounded mode-transition history, and capture-to-first actual page-scroll application median/p95. That software timing excludes camera exposure, filter settling and physical display presentation. Existing inference, delivery, RAF cadence and long-task measurements remain available. No 60-FPS claim.

## Live findings and remaining limitations

The first Sprint 03 webcam acceptance run on 2026-10-24 **failed**. The user reported poor angle coverage, frequent interruptions and unsatisfactory scrolling. DOM samples showed document scrollTop 0 → 25 → 248.6 → 0 → 862.7 px, a confirmed neutral with -0.9% displacement / zero velocity, and all five click counters remaining zero. This demonstrates effects and neutral stopping, not acceptable smoothness or measured click false-positive rates. The run ended at 216 mode transitions; these include deliberate hand/posture changes and cannot all be labeled errors. Final sampled performance: processed 15.6 FPS; inference median/p95 43.6/66.7 ms; software capture-to-scroll-application 63.2/106.4 ms. No physical-latency claim.

A subsequent actions-paused local probe contains 1451 label slots and 918 observed hands over 70.8 seconds. It includes upright/flat changes, hand swaps and periods with both labels enabled for one shown hand. Therefore its displayed missing-hand/FN/FP totals and manual-marker latency are **not valid accuracy estimates**. Recomputing the protected control classifier on the 918 observed landmarks produced OPEN 677, UNKNOWN 185, FIST 56. The initial five-second visibly flat interval contained 32 OPEN and 34 UNKNOWN observations; measured index/middle geometry often appeared curled while ring/pinky remained extended. These inconsistent model estimates cannot safely be turned into OPEN just by relaxing geometric thresholds. No negative-pose coverage or reliable labels justify a classifier change.

The corrections above address unnecessary state loss, not the underlying long uncertain/false-fist sequences. An identical orientation/pose replay of this probe (synthetic constant image center and stable ID, zero delivery delay) increased time in SCROLL_ACTIVE from 13.344 to 15.296 seconds; full captured-neutral drops remained 16. This is only a limited state-machine comparison, **not a live smoothness improvement or successful acceptance**. Recorded data lacks image positions, capture timestamps and spatial identities, so full motion/latency replay is impossible. Raw local JSON and analysis scripts remain outside tracked sources; no video was recorded or uploaded.

Independent follow-up review found no actionable defect in the pause corrections and requested delayed-delivery coverage; the added regression now checks 55 ms delivery and RAF expiry before RETAIN recovery. The corrected build has not yet passed a new active webcam acceptance run. Broader angle support remains unresolved and needs properly labeled positive/negative posture sequences before changing recognition. No production-readiness claim, push or merge.

## Webcam acceptance (failed first run; corrected build pending retest)

1. Open http://localhost:5173/scroll-test before starting the camera. Keep this tab visible and focused. Use Debug ON for the first run.
2. Hold one open palm upright and check familiar pointing/fist activation. Reopen before repeating.
3. Rotate the open palm flat and hold it comfortably still for about half a second. The indicator should reach **Scroll neutral** with no page movement.
4. Move above the captured resting height: page travels up. Move below it: page travels down. Hold displaced: travel continues. Move farther: speed rises within the configured maximum.
5. Return to resting height: stop immediately. Reverse direction and continue through several viewport heights.
6. Reopen upright: scroll stops; pointer reconfirms. A fist during scrolling must never click. Remove/reintroduce the hand: a fresh neutral is required.
7. If the comfortable posture is not recognized, hold that flat OPEN pose steadily for half a second and use **Capture flat posture** in debug settings. Dead zone, full-speed displacement and maximum speed can be tuned independently. **Reset scroll neutral** recaptures the comfortable height without changing finger recognition or pointer sensitivity.
8. Download local scroll metrics and existing pointer/performance summary for before/after comparison. These contain numeric metrics, not video or raw landmarks. Mode transitions need manual labeling before being called unexpected.

Production readiness requires the user's webcam acceptance. No further gesture is implemented in Sprint 03. Drag, grabbing and two-hand acceleration remain disabled.

The subsequent [guided four-posture comparison](sprint03-guided-evaluation.md) replaced missed chat cues with on-screen instructions and bounded single-hand capture. It confirmed the flat orientation gate in 185/185 observations but only 49/185 raw OPEN predictions in the protected control. The historical hybrid recovered more OPEN but falsely accepted two-finger examples. No active classifier was changed from that probe; broader recognition remains unresolved. DebugEvaluationPanel and LocalEvaluation now implement guided capture; camera capture and worker code remain unchanged.

The paired follow-up adds image coordinates and intrinsic dimensions only to CameraManager's existing debug comparison block; capture, worker transport and inference remain unchanged. A shadow projection candidate improves raw OPEN from 126/182 to 162/182 in a later prompted flat-open sequence, but does not establish smooth scrolling or flat-negative safety. It has no runtime control effects. See the paired comparison section for remaining negative coverage and replay limitations.

The subsequent true flat-fist countercheck rejects that candidate: 44/199 false OPEN results, versus zero for the protected control. Its repaired positive and false-positive frames share the same world finger-state and projected-extension pattern. The UI and export mark the proposal as rejected; it remains debug-only. No active classifier promotion or successful scrolling acceptance resulted from this comparison.
