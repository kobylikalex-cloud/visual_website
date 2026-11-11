# Sprint 03: single-hand page scrolling

Baseline: `6a1573f` (functional change `f19b963`), accepted by the user. Branch `codex/sprint03-palm-scroll`. Pre-existing App.css status has no content diff and is preserved. Baseline: 124 passing tests.

## Agreed behavior and evidence

The user demonstrated a roughly horizontal open palm moving vertically and returning upright. They explicitly confirmed continuous scrolling while held outside the neutral band, stopping when returned to neutral. This is a position-to-velocity controller, not swipes or movement-only scrolling. Live camera-relative depth changed from about 50° (62% facing) to 31° (84% facing) while raising the flat hand. Upright example: 9° depth / 93% facing. Sampled tracking HUD ~18–20 updates/s, inference ~40–45 ms; these are snapshots, not a benchmark. There were hand-identity reacquisitions and a worker timeout; do not attribute either to code not yet changed.

## Approach

Wrap the protected FistClickEngine in an exclusive PageGestureEngine. Keep OpenPointerEngine, FistClickEngine, finger recognition, gain/filter/mirroring and camera/worker code unchanged. Add orientation metrics to tracked observations for a scroll-specific calibrated gate; retain the existing orientation diagnostic classifier. Do not activate the dormant legacy InteractionEngine/ScrollController: they also include drag and dual-hand behavior.

Reserve the horizontal pose for scrolling; ordinary sideways yaw remains pointer-compatible. Use the existing measured default entry band (depth >=42°, facing <=75%) and a wider retention band (depth >27°, facing <90%) only after confirmed entry. Initial intermediate rotation never scrolls. Personal calibration derives the entry band from a bounded recent stable, single-hand OPEN sequence; retain geometric separation from the default upright band and report rejected/overlapping calibration. Never change finger thresholds through scroll settings.

Confirm flat pose for 200 ms and at least three observations. Then require 250 ms of settled height within the configured dead-zone width before capturing the average neutral height. Do not move the neutral while active. Fresh UNKNOWN, FIST, another hand, invalid identity or stale data stop scrolling; normal open-pointer confirmation is required on return. Target locks are canceled before entering scroll intent, including partial rotation. A fist during scroll cannot activate anything.

Controller: signed normalized height displacement, smoothstep transfer with provisional dead zone .03, full-speed range .16, max 600 px/s. Settings are independent of pointer gain. Integrate at RAF cadence with <=50 ms elapsed steps and <=200 ms capture freshness. Neutral means exactly zero; no output inertia, backlog or automatic center drift. Neutral reset restarts settling. Settings changes cancel pending scroll intent.

Scroll only document.scrollingElement through a small bounded adapter. Track the expected page position to distinguish own scroll events from unrelated scrolls. Native wheel/touch/scroll keys cancel gesture intent and keep their default behavior. Own page scrolling must not trigger the old unconditional scroll cancellation. Keep blur/hidden/resize/Escape safety and registered clicks.

## Tasks (test first, native implementation)

1. ScrollPoseProfile.ts + tests: default entry vs intermediate, calibrated profile validation and hysteresis; expose orientationMetrics on tracked observations.
2. PageScrollSession.ts + tests: confirmation, settled neutral, exact dead zone, signed bounded velocity, reversal, no drift, stale/identity guards, capped elapsed integration.
3. PageGestureEngine.ts + tests: protect pointer/click parity outside reserved pose, exclusive modes, no old target lock, release/identity/loss/two-hand/UNKNOWN guards.
4. PageScrollTarget.ts + tests: actual page effect boundary, clamps, own vs external scroll, no stale replay.
5. Integrate App and compact ScrollDebug settings, subtle fixed mode indicator; add /scroll-test with several viewport heights of content without redesigning the existing site. No video, landmarks or cursor in normal mode. Keep frame-rate work out of React state.
6. Full tests, TypeScript/Vite build, lint, independent review, UI/native input checks. Measure software capture-to-scroll application (not physical display latency), existing tracking/RAF/inference/long tasks and state-transition reasons. Ask for webcam acceptance before declaring production readiness or adding a gesture. No push/merge.

## Progress

- Inspected baseline, read user spec, created branch, confirmed 124 baseline tests.
- Live demonstration observed; continuous outside-neutral behavior explicitly confirmed.
- Implemented all six tasks. Protected pointer/click/recognition/camera/worker modules have no diff. Tracker only adds existing orientation metrics.
- Full suite currently 152 passing tests; TypeScript/Vite build and lint pass. Independent review's two P2 findings were reproduced and fixed (fractional rounding and native control calibration activation). UI/native input checks passed; see sprint03-delivery.md.
- First active webcam acceptance failed: frequent state resets and insufficient angle coverage. Subsequent local actions-paused probe confirmed significant raw pose uncertainty; mixed labels/hand changes do not permit formal accuracy estimates.
- Added immediate effect suppression with bounded evidence/neutral preservation across brief UNKNOWN and orientation outliers. The existing 200ms OPEN deadline never extends on uncertain observations; no paused movement is replayed. Added delayed-delivery/safety regressions and preserved the original upright band after calibration. Scoped review found no actionable defects.
- A pose/orientation-only replay shows a limited improvement in active time but unchanged full-reset count. Underlying longer model uncertainty/false-fist sequences and broader angle support remain unresolved. Corrected build requires a new active webcam test; no production acceptance, push or merge.
- Added German on-screen single-hand measurement prompts after chat cues were missed. Four separate bounded captures now identify the flat finger-evidence veto and the hybrid's two-finger false positives. Guided tests cover preparation/deadline, one-hand semantics, capacity/clock safety and capture-owned cleanup; camera-free browser lifecycle checks pass. See sprint03-guided-evaluation.md. No recognition threshold change is justified by these data alone.
