# Gesture Lab — Sprint 01

This sprint enables **one upright open hand for invisible pointing and target highlighting only**. Gesture clicking, grabbing, dragging, scrolling and two-hand control are disconnected. Native mouse, touch and keyboard controls remain available. Camera images, landmarks and measurements stay on this computer.

## Run the existing application

Node 24.14.0 and existing dependencies are available locally.

```powershell
Set-Location -LiteralPath 'C:\Users\kobyl\vision_website\gesture-lab'
npm run dev -- --host localhost --port 5174 --strictPort
```

Open [localhost:5174](http://localhost:5174/). If the server is already running, use it directly. After code changes, reload before a camera test. Do not run two camera tabs at once.

1. Keep this tab visible and in the foreground. Start camera; the selected device name appears below the controls.
2. Raise **one upright open hand**, hold briefly, then move toward the five target buttons. Nearby targets glow. No gesture activates a button.
3. Remove the hand to disengage. Escape pauses the pointer; Resume pointer explicitly resumes it.
4. Mouse/keyboard can still activate buttons, move the card and scroll the journal.

## Debug, calibration and measurements

Debug is off initially. Camera, landmarks and the internal interaction point are visible **only** with Debug ON. The debug section below the playground shows raw/confirmed OPEN_UPRIGHT, actual spatial ID, geometry quality, focus/distance, observation age, rendering cadence, processed camera FPS, median/p95 inference/processing/delivery and CSS feedback latency, frame rejection reasons and long tasks.

Capture a comfortable center with one fresh open upright palm. **Pointer movement gain** is independently adjustable from **0.8× to 2.5×**, default **1.6×**, relative to the previous mapping at 1.0×. Increasing gain enlarges displacement about the captured center; the existing smoothing state is retained while tuning. Recentring preserves gain and movement range. Camera movement range remains a separate setting. Calibration affects movement only; finger/orientation thresholds are unchanged.

With the camera stopped, select **Compare CPU/GPU on identical frames**, then Start camera. The worker tests the same ImageBitmap/timestamp on each available delegate, alternating order, excluding five warmups, measuring twenty pairs. Highlighting pauses during comparison. The delegate with the lower measured p95 remains active. Unavailable delegates are reported. AUTO prefers an available GPU worker but is explicitly unbenchmarked; CPU/GPU can also be selected directly. Unsupported workers use an explicitly reported main-thread fallback outside comparison mode.

Select **Stationary palm** for an automatically bounded ten-second jitter/focus capture. Select Moving for a longer trial; Off resets it. Download local measurement summary saves numeric aggregate results, not video or raw landmarks. The collapsed historical A/B labeling tool remains available separately; its baseline classifications do not describe the active pointer classifier.

Follow [the acceptance protocol and delivery notes](docs/sprint01-delivery.md). Passing synthetic tests is not proof of webcam usability.

## Checks

```powershell
npm test
npm run build
npm run lint
```

`npm run preview -- --host localhost --port 4175 --strictPort` serves the built application without hot reload. The browser may require camera permission for that separate origin.
