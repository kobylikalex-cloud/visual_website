# Gesture Lab — Gesture Playground

A local React/TypeScript/MediaPipe prototype for invisible pointing, deliberate full-hand clicks and dragging, and position-controlled scrolling. It uses the existing camera pipeline and bundled local model/WASM assets.

## Launch on this laptop

Use Node 24 (tested with 24.14.0). Dependencies are already installed in this checkout.

```powershell
Set-Location -LiteralPath 'C:\Users\kobyl\vision_website\gesture-lab'
npm run dev -- --host localhost --port 5174 --strictPort
```

Open [http://localhost:5174/](http://localhost:5174/). If that server is already running, open the URL directly instead of starting a second copy. After source edits/hot reloads, stop and restart the camera or reload the page before a live test.

1. Click **Start camera** and allow this site's camera access. Use the laptop's built-in camera in the browser device menu. The chosen device name is displayed; this machine exposes it as `USB Camera (3277:00fa)`. No external hardware, account or API key is required.
2. Hold **one upright open palm** steady, then move it gently. Camera X is mirrored; nearby demo controls glow and gain stable focus. No cursor is drawn.
3. Once a control is focused, close your **whole hand into a fist** and hold briefly. A button activates once. Over the floating card, a fist grabs; keep it closed to move, open to release. Pinching is not the activation gesture.
4. Hold **one flat open palm** steady to establish neutral. Move above that position to scroll the journal up, below to scroll down. Return to neutral to stop.
5. For **two-hand 3× scrolling**, establish two separate flat open palms, then move both in the same direction. Disagreement or a neutral/invalid hand stops the pair. After a hand disappears, hold the remaining hand steady to establish a fresh neutral.
6. **Escape** or **Pause gestures** stops actions. Resume explicitly. Changing browser focus, losing tracking, camera stop and stale frames also cancel intent.

Mouse/touch buttons and pointer/arrow-key dragging work without a camera. The journal supports ordinary scrolling and keyboard navigation. All gesture effects are reversible and confined to the demonstration controls and journal pane.

## Debug and calibration

**Debug** is manually enabled; feed, skeleton, A/B comparison and movement calibration are hidden normally. **Center pointer reach** uses one fresh upright open palm. Scroll speed and neutral dead zone can be adjusted locally; changing settings clears intent.

Existing A/B classifiers and optional labeled evaluation remain available. Starting a labeled recording cancels actions immediately and keeps them paused throughout capture. No video is recorded. Landmark samples remain in memory until an explicit local JSON download. Private evidence lives in ignored `.local-evaluation/`.

## Checks

```powershell
npm test
npm run build
npm run lint
```

For a production preview without development hot reload:

```powershell
npm run build
npm run preview -- --host localhost --port 4175 --strictPort
```

See [Phase 05 delivery notes](docs/phase05-delivery.md) for architecture, defaults, changed files, validation and limitations. Earlier [architecture audit](docs/architecture-audit.md) and [recognition evaluation](docs/live-recognition-evaluation.md) document the baseline history.
