# Gesture Lab — Sprint 03

**Protected local webcam baseline:** the user accepted compact touchpad movement, fist clicking and direct flat-hand scrolling in both directions on2026-10-26. An attempted shared-engine card extension was reverted after a regression report; the user confirmed the restored controls again on2026-10-27. Keep this accepted behavior unchanged. This is local acceptance, not an all-user/device accuracy claim. See [the accepted control checkpoint](docs/accepted-control-checkpoint.md).

This sprint adds **continuous vertical page scrolling with one flat open palm** around the established pointer and complete-fist click. Hold the flat hand comfortably still to capture a neutral height. Above neutral scrolls up; below scrolls down; returning to neutral stops immediately. Reopen upright to point again. Only the five test buttons have registered gesture clicks. Gesture grabbing, dragging and two-hand control remain disconnected. Native mouse, touch and keyboard controls remain available. Camera images, landmarks and measurements stay on this computer.

## Run the existing application

Node 24.14.0 and existing dependencies are available locally.

```powershell
Set-Location -LiteralPath 'C:\Users\kobyl\vision_website\gesture-lab'
npm run dev -- --host localhost --port 5173 --strictPort
```

Open [localhost:5173](http://localhost:5173/). If the server is already running, use it directly. After code changes, reload before a camera test. Do not run two camera tabs at once.

1. Keep this tab visible and in the foreground. Start camera; the selected device name appears below the controls.
2. Raise **one upright open hand** and move toward the five target buttons. Sideways yaw can still aim; the horizontal posture is now reserved for scrolling. Let one target settle, close all four non-thumb fingers into a fist and hold for approximately 200 ms. The locked button pulses and its count increments once. Hold closed: nothing repeats. Reopen, then select again.
3. Remove the hand to disengage. Escape pauses the pointer; Resume pointer explicitly resumes it.
4. Mouse/keyboard can still activate buttons, move the card and scroll the journal.
5. Open [the long scrolling test](http://localhost:5173/scroll-test) before starting camera. Rotate flat and hold comfortably still for about half a second. Move above/below this resting height to scroll continuously. Return to resting height to stop; upright restores pointing. FIST, UNKNOWN, another hand, hand loss or stale tracking stop scrolling safely.

## Debug, calibration and measurements

Debug is off initially. Camera, landmarks and the internal interaction point are visible **only** with Debug ON. The debug section below the playground shows raw/confirmed OPEN, actual spatial ID, geometry quality, focus/distance, observation age, rendering cadence, processed camera FPS, median/p95 inference/processing/delivery and CSS feedback latency, frame rejection reasons and long tasks.

Capture a comfortable center with one fresh open palm. **Pointer movement gain** is independently adjustable from **0.8× to 2.5×**, default **1.6×**. Increasing gain enlarges screen displacement for the same hand movement; the existing smoothing state is retained while tuning. Recentring preserves gain and movement range. Camera movement range remains a separate setting. Calibration affects movement only; finger/orientation thresholds are unchanged.

The app now defaults to **Touchpad · relative movement**. The first confirmed open palm starts at screen center regardless of where it enters the camera. Move the hand to move the invisible selection; lower/reposition/raise it to continue from the last filtered screen position. Closing and reopening, brief uncertainty and returning from scrolling reset the hand anchor without replaying movement while suspended. Only position survives; target locks and click evidence still clear according to the existing safety rules. **Capture comfortable center** explicitly returns relative selection to screen center. The debug **Pointer movement mode** selector retains the original absolute camera mapping for comparison; changing modes or mapping cancels prepared click intent and requires fresh OPEN confirmation. Gain, mirroring, clamping, smoothing and click confirmation settings are retained. Webcam acceptance of this change is still pending; it does not resolve the known angle/scroll-recognition failures.

The first relative-mode live trial registered five clicks, but the user rated movement approximately unchanged and still insufficiently fluid. See [the touchpad report](docs/pointer-touchpad-delivery.md). Debug now provides **Automatic page scrolling** to isolate pointing from orientation-triggered scrolling (default on, restored when debug closes), and **Pointer smoothing** to compare response against stability (35–200 ms; unchanged default 140). Changing either control clears prepared actions. First-feedback timing excludes filter settling and must not be presented as complete motion latency.

The separate **Page scrolling · calibration** panel captures a comfortable flat posture from recent stable observations. It tunes orientation independently from finger recognition and pointer gain. Neutral height is captured afresh on each scroll session; Reset scroll neutral restarts settling. Dead zone (default 3%), full-speed displacement (16%) and maximum speed (600 px/s) are provisional, independently adjustable defaults. Calibration lasts for this page session. Debug visualizes the neutral band, displacement, velocity, exclusive mode and recent transitions. Download local scroll metrics saves numeric diagnostics and software capture-to-scroll application timing; it records no video or raw landmarks.

With the camera stopped, select **Compare CPU/GPU on identical frames**, then Start camera. The worker tests the same ImageBitmap/timestamp on each available delegate, alternating order, excluding five warmups, measuring twenty pairs. Highlighting pauses during comparison. The delegate with the lower measured p95 remains active. Unavailable delegates are reported. AUTO prefers an available GPU worker but is explicitly unbenchmarked; CPU/GPU can also be selected directly. Unsupported workers use an explicitly reported main-thread fallback outside comparison mode.

Select **Stationary palm** for an automatically bounded ten-second jitter/focus capture. Select Moving for a longer trial; Off resets it. Download local measurement summary saves numeric aggregate results, not video or raw landmarks. The collapsed historical A/B labeling tool remains available separately; its baseline classifications do not describe the active pointer classifier.

Inside that debug tool, **Messen: Flach offen / Aufrecht offen / Geschlossene Faust / Zwei Finger** shows German instructions directly over the page: three seconds to prepare and twelve seconds of local single-hand measurement. Gestures pause during evaluation. Download each section before starting another; a new section clears the previous in-memory samples. Missing/multiple hands yield one UNKNOWN observation, independent of Left/Right labels. Tab hiding, camera stop, abort or leaving debug ends capture. Reload after code changes before testing: hot reload can retain old class instances in React state. The [guided comparison report](docs/sprint03-guided-evaluation.md) records the remaining finger-recognition limitation; broad angle robustness has not been achieved.

Additional guided buttons test a flat fist, flat two-finger hand and a single bent finger, with a prominent missing-hand warning. Debug compares aspect-correct image geometry with the same result's inferred 3D geometry. The **Scroll-Kandidat (nur Vergleich)** column is a rejected shadow proposal: the flat-fist countercheck exposed false OPEN results, so it cannot trigger scrolling or clicks. Schema 3 local exports include paired landmarks, image dimensions and relative capture/delivery timestamps. See the guided report for the rejection evidence and remaining recognition work.

Debug also shows actual OPEN/FIST/UNKNOWN, click state, spatial identity, locked target, fist progress, successful gesture clicks, rejected attempts, last cancellation and observed fist-to-action latency. Per-button counters include native and gesture activations; the debug valid-click count includes only registered gesture activations.

Follow [the Sprint 03 acceptance protocol and delivery notes](docs/sprint03-delivery.md). Production readiness requires user webcam acceptance. Passing synthetic tests is not proof of webcam usability. The existing [Sprint 01 report](docs/sprint01-delivery.md) and [Sprint 02 notes](docs/sprint02-delivery.md) are historical evidence, not a current controlled before/after comparison.

## Checks

```powershell
npm test
npm run build
npm run lint
```

`npm run preview -- --host localhost --port 4175 --strictPort` serves the built application without hot reload. The browser may require camera permission for that separate origin.
