# Relative pointer continuity — 2026-10-24

User chose movement like an invisible touchpad instead of directly pointing a hand ray at a button. They previously requested autonomous fixes without constant interruptions. Continue on the existing dedicated `codex/sprint03-palm-scroll` branch, preserving its uncommitted Sprint 03 work; do not push or merge.

## Design

Keep the existing absolute mapping as the library default and a debug comparison option. The application opts into relative movement: first acquisition anchors the current palm to screen center; later acquisitions anchor to the last filtered screen position. Horizontal motion remains mirrored; gain stays 1.6 (0.8–2.5 adjustable) divided by the existing movement range. Clamp accumulated movement to the viewport without hidden edge accumulation. Pausing discards pending filter motion and resets the palm anchor, never retaining target locks or click evidence. Movement while closed, uncertain, absent, scrolling or paused must not replay on reopening. Recenter explicitly starts at screen center and cancels all interaction intent. Keep smoothing and recognition/dwell/freshness rules unchanged in this isolated change.

Alternatives: retain absolute mapping and tune sensitivity (does not address acquisition jumps); calibrate a directional pointing ray (user chose touchpad instead); relative movement with retained geometry only (selected). This is a continuity improvement, not a solved angle-recognition or latency claim. Green point remains debug-only; normal UI uses target feedback.

## Implementation plan

- [x] Add failing regressions in `tests/pointer-touchpad.test.ts`: arbitrary first palm, mirrored gain, edge clamp/reversal, clutch/reacquisition, smoothing/gain, complete click/reopen, cancellation safety, explicit recenter and scroll return.
- [x] Add optional `pointerMode` to GestureConfig; introduce app touchpad preset while preserving old defaults.
- [x] Extend PointerController with relative accumulation, reanchor-on-reset and explicit recenter; OpenPointerEngine must preserve geometry across config changes but clear all intent.
- [x] Pass explicit recenter through FistClickEngine and PageGestureEngine without altering their state transitions or deadlines.
- [x] Opt App into touchpad preset, expose debug mode selection, preserve gain/range settings and update recenter/restore controls.
- [x] Run focused tests, full `npm test`, TypeScript/Vite build, ESLint; review the patch, verify camera-off UI configuration, then stop for webcam acceptance.

## Review focus / acceptance

No retained click intent after stale data, another identity, mode/config changes or recenter. First confirmed frame must establish the anchor before display ticks can move. Lost motion while suspended must not be replayed. Both screen edges must reverse immediately with smoothing disabled; filter settling must never overshoot. Gain-only changes must not move a stationary relative pointer. Absolute-mode tests must remain intact. Preserve camera, worker, recognition and scroll modules' algorithms.

## Execution ledger

Initial: 161 tests previously passing; current working tree contains the entire uncommitted Sprint 03. Scope is pointer movement and minimal integration only. Existing baseline has no relative/clutch behavior. No commit, push or merge planned.

2026-10-24: First eight relative regressions observed red, then green. Two additional uncertainty/config cases pass. Full suite 171 passed before independent review.

2026-10-26: Reviewer reproduced mode-switch stale target intent without an intervening RAF. Regression observed red (unexpected activation), then green after non-gain config changes cancel outer intent. Same fix covers mapping range changes. Reviewer verified 28 focused tests and no remaining actionable finding. Browser confirmed relative app default/gain 1.6/range .70. Final `npm test`: 172 passed; `npm run build`: exit 0; `npm run lint`: exit 0; `git diff --check`: exit 0 (line-ending notices only). Inference worker remains handTracking.worker-BixMcT-V.js. Freshly loaded localhost:5173/scroll-test, camera off, Debug OFF, awaiting the user's webcam acceptance. No push or merge.

Live trial: five registered clicks, user rates movement approximately unchanged; acceptance NOT achieved. Automatic scroll intruded into pointing. Added opt-in debug navigation-only isolation (default automatic on, debug exit restores it), red→green intent-cancellation/scroll restoration regression, and a debug control for the existing smoothing constant. No recognition or filter algorithm/default changed. Controller-only response benchmark: a 160 px step takes 330 ms to reach90% with140 ms smoothing,170 ms with70,90 ms with35 (10 ms synthetic ticks). Camera/inference/confirmation are excluded; stationary jitter is not measured.

Latest checks after additions: `npm test` 173 passed; TypeScript/Vite build and ESLint exit0; reviewer ran41 focused tests with no findings. Browser verified checkbox on→off, smoothing140→70→140, Debug OFF→ON restoring automatic scrolling to on. Left camera off, Debug OFF, gestures paused. UI comparison defaults restored; no additional webcam trial. See pointer-touchpad-delivery.md for numeric live results and unresolved work.
