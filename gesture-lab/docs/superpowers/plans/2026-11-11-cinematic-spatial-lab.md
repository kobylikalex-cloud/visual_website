# Cinematic Spatial Lab Implementation Plan

**Goal:** Implement the user's approved cyan/violet glass-cube concept as a real interactive webpage, without changing the accepted gesture controls.

**Architecture:** Add a scoped presentation stylesheet and a small renderer-only decoration module. Keep the original interaction mesh, its world size/rotation, camera, picking/projection, world limits, clocks, callback ownership and all inference/gesture modules unchanged. Keep the original page routes and controls.

**Tech stack:** Existing React, TypeScript, Vite, Three.js. No new runtime dependency, external image service or font request.

**Approved design:** User approved the cinematic mockup on 2026-11-11: dark spatial lab, cyan/violet glass cube, illuminated circular stage, restrained HUD cards and polished camera controls. Implement a real scene, not the mockup as a flattened background. Do not copy fabricated ACTIVE/version badges, fake metrics, or unimplemented controls from the concept.

## Approaches and decision

1. Rebuild the application as a new showcase: rejected because it risks the accepted input behavior.
2. Separate presentation over the accepted scene: selected, matching the user's requirement to keep controls while improving the whole page.
3. Static concept-image background: rejected because the cube must remain genuinely interactive.

## Global constraints

- Work only on `design/spatial-lab-cinematic`, from `dd6b905acabf8106e3afec9e28cde253e5d9e776`. Never merge without approval.
- Protect `src/control`, `src/gestures`, `src/workers`, `src/evaluation`, `src/App.tsx`, `CameraManager.tsx`, depth estimator, bridge, interaction engine, render clock and their types byte-for-byte.
- Keep the camera at (0,0,7), FOV 42, cube BoxGeometry(1.2,1.2,1.2), rotation (.18,.42,-.025), interaction bounds and mesh identity intact.
- No input remapping, threshold changes, extra grab gestures, auto movement or rotation of the target, artificial camera drift, or release momentum.
- Retain native keyboard/mouse handlers, every existing registered button ID, calibration/debug controls and Escape behavior.
- Use decorative elements with pointer-events:none and no pick ownership. No blocking overlays.
- Keep bounded DPR/render cadence. No fullscreen bloom, multiple live reflection cameras, volumetric raymarching or large particle simulations.
- Actual webcam smoothness is user-validated separately; passing tests is not a physical latency claim.

## Review focus

- Render decorations must not enter cube raycast results or change hit bounds.
- Transparent glass must remain visible in dark conditions and not alter selection semantics.
- Responsive CSS may rearrange the UI but cannot cover controls or create horizontal overflow.
- Start camera/debug/pause states must reflect existing live state, never fabricated telemetry.
- Resource cleanup and reduced-motion behavior must not introduce runaway GPU work.

## Task 1 — Establish baseline and preservation checks

- [ ] Run existing tests, production build and lint on isolated branch before product changes.
- [ ] Add tests proving protected source hashes, unchanged projection/input handlers, and renderer decorations do not alter target transforms/picking.
- [ ] Confirm a missing visual-decorator test fails before implementation.

## Task 2 — Renderer-only scene treatment

Files: `src/spatial/SpatialScene.ts`, new `src/spatial/SpatialAppearance.ts`, test `tests/spatial-appearance.test.ts`.

- [ ] Add geometry-only tests for a decorative group, resource disposal and unchanged cube position/rotation/scale.
- [ ] Add a transmissive-looking cyan/violet cube shell, illuminated edges, lighting and a dark circular stage using existing Three.js.
- [ ] Keep pick/projection/bounds and input mesh exactly unchanged; separate decorations from interactive geometry.
- [ ] Run full tests and audit protected sources.

## Task 3 — Whole-page presentation

Files: new `src/components/cinematic.css`, presentation-only import/markup in `GesturePlayground.tsx`, presentation-only markup in `SpatialScenePanel.tsx`.

- [ ] Style the header, hero, camera card, spatial viewport, gesture hints, target buttons, native interaction area and lower sections cohesively.
- [ ] Add concise spatial guidance and coordinates without new state or handlers.
- [ ] Keep existing button labels, callbacks and keyboard behavior; no fake badges.
- [ ] Test normal/debug modes, reduced motion and narrow desktop layouts in a browser.

## Task 4 — Verify and publish the isolated review branch

- [ ] Run complete tests, TypeScript/Vite build, ESLint.
- [ ] Browser-test real WebGL, mouse drag, keyboard X/Y/Z, reset, normal/debug toggles, responsive overflow and console errors.
- [ ] Capture actual implementation screenshots; compare with the approved reference and refine once needed.
- [ ] Verify protected-source diff is empty against the pinned base.
- [ ] Create a draft PR for review; do not merge. Provide commands to test and return to main.

## Execution note

GitHub Actions supplies the reproducible baseline/build environment because this session's local container cannot resolve external GitHub/npm hosts. No local user files or private camera recordings are accessed. Review artifacts contain only repository code/build files and development dependencies, expire after three days, and are not a public demo deployment.
