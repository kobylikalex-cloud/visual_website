# Relative touchpad pointer — implementation / acceptance pending

User selected touchpad movement on 2026-10-24; verification resumed on 2026-10-26. Branch `codex/sprint03-palm-scroll`, baseline `6a1573f`, modified worktree. No push or merge. Existing uncommitted Sprint 03 work remains present.

## Change and limits

The former absolute camera mapping projects every newly confirmed hand directly onto a screen position. Fist closure cancels the inner pointer, so reopening restarts that mapping/filter. Those behaviors explain deterministic acquisition/release position jumps; they do not establish every cause of the user's webcam complaints.

The app opts into a relative mode while the library defaults retain absolute behavior. First acquisition starts at center; later acquisitions start at the last filtered normalized screen position. Mirrored palm displacement is multiplied by gain / movement range and accumulated within [0,1]. Lifting/canceling drops pending filter movement and the palm anchor but retains position only. Confirmation establishes a fresh anchor before RAF movement. Suspended hand travel does not move the selection on release or after scrolling. Explicit recenter clears all intent and returns to center. Debug can select the historical absolute mode and adjust gain independently.

Camera, worker, finger/orientation recognition, 140 ms smoothing, dead zone and click/pose/freshness deadlines remain unchanged. This is a movement-continuity improvement, not a reduced-latency or all-angle recognition claim. Camera feed, skeleton and interaction point remain debug-only. No OS input, new gesture or external processing was added.

## Verification

- Initial eight regressions failed against the old absolute-only implementation, then passed after the relative implementation. Additional coverage checks uncertainty and config/gain continuity.
- Independent review found that changing mapping could preserve the outer TARGET_FOCUSED state until a RAF tick. The new no-tick regression reproduced a stale activation. Non-gain config changes now clear outer click intent synchronously; gain-only continuity is preserved. The review verified the correction with 28 focused tests and reported no remaining actionable findings.
- Eleven touchpad regressions cover first anchor, mirroring/gain, clamp/reversal, filter-lag discard, UNKNOWN recovery, click/reopen, new identity, explicit recenter, config cancellation without RAF and return from scrolling. Existing absolute-mode tests remain unchanged.
- Browser loads the existing localhost:5173/scroll-test app with camera off. Debug confirms Touchpad relative selected, gain 1.6 and range 70%.
- Final `npm test`: 172 passed; TypeScript/Vite build and ESLint: exit 0. `git diff --check` succeeds. Inference worker remains `handTracking.worker-BixMcT-V.js`. Results are also recorded in the execution ledger in pointer-touchpad-plan.md.

## Next webcam acceptance

With one comfortably upright open hand: move between targets; lower/reposition/raise and check continuity; click with a full fist, reopen and continue; approach each edge and reverse; briefly scroll and return upright. The point is diagnostic only. Observe target highlights and registered clicks in ordinary UI. Confirm that reduced positional jumps actually improve usability; do not infer acceptance from synthetic tests. Keep the rejected projection candidate disconnected. No video recording; any numeric measurements remain local.

## 2026-10-26 live result: user improvement not accepted

The free camera trial recorded five registered gesture clicks (North west 1, North east 2, Center 2), with zero recorded rejected attempts. There is no labeled intended-click denominator and thus no accuracy claim. The user rated the touchpad movement **approximately the same as before** and explicitly reported navigation still far from fluid enough without a visible interaction point. Do not call this an accepted improvement.

Live samples showed repeated scroll entry while the user held a hand to point, confirmed pointer mode later, and hand identity changes. The cumulative numeric export covers 137.6 seconds including preparation and paused export time: processed 16.75 FPS, camera 29.60 FPS, inference median/p95 45.5/63.8 ms, delivery 48.6/87.9 ms, first CSS feedback 56.45/100.8 ms. Last registered fist-capture-to-activation is 296.5 ms. The 477 cumulative mode transitions include idle/uncertain alternation and deliberate changes; they are not a count of recognition errors. Numeric files are preserved in ignored `.local-evaluation/touchpad-2026-10-26-{scroll,performance}.json`. No video or landmark recording occurred.

### Isolate the remaining causes before another acceptance trial

A debug-only **Automatic page scrolling** switch now permits a navigation-only comparison across palm orientations. It defaults on, changing it cancels all prepared click/scroll intent, and leaving debug restores automatic scrolling. Common stale/identity/one-hand guards remain active. A regression checks direct camera delivery without a RAF tick, complete click/release, restoring automatic scroll and stopping an active scroll. This is a diagnostic control, not a fix for recognizing intended scroll posture.

The existing smoothing time constant is also exposed independently in debug (35–200 ms, unchanged default 140). Config changes cancel click readiness and retain relative geometry. This changes no recognition threshold or filtering algorithm. A deterministic 160-pixel step, rendered every 10 ms, quantifies the distinction between first feedback and settling:

| Smoothing constant | Time to 90% of movement | Within 7 pixels |
| --- | ---: | ---: |
| 140 ms (current default) | 330 ms | 440 ms |
| 70 ms (comparison only) | 170 ms | 220 ms |
| 35 ms (comparison only) | 90 ms | 110 ms |

These are controller-only synthetic results, excluding capture, inference, gesture confirmation and display. They do not establish acceptable stationary jitter or physical latency. No faster default is promoted without comparing both responsiveness and stationary focus. The camera remains stopped; no further live trial was requested during these changes. Broader work remains: prevent unwanted mode switching, improve the latency/steadiness tradeoff with measured input, and validate target acquisition without the debug point.

The independent review verified these additions with 41 focused tests and found no actionable issue. Final full checks: 173 tests pass; TypeScript/Vite build and ESLint exit 0. Browser verified navigation-only checkbox, smoothing 140→70→140 and automatic-scroll restoration after Debug OFF→ON. Left camera off, Debug OFF, actions paused, reference settings restored. No push or merge.
