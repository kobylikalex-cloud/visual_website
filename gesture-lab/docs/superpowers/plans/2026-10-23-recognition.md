# Conservative finger recognition implementation plan

Goal: improve the existing recognizer in place, with one isolated geometric and pose-state change.

Starting point: clean `diagnostics/finger-extension` at `5d025b7`; baseline build and lint pass. Work on `codex/conservative-finger-recognition`, retaining that commit and the original branch as the functional baseline. The user's execution instructions authorize implementation after the audit; no additional design approval round is needed.

## Design and scope

- Keep React, TypeScript, MediaPipe, camera lifecycle, local assets and existing debug controls.
- Extract finite landmark validation into `TrackingQuality.ts`, geometric PIP/DIP angles and normalized reach into `FingerGeometry.ts`, and temporal pose state into `HandPoseStabilizer.ts`. Preserve the `HandPoseEngine.ts` public imports.
- Classify a finger only when both measured joint angles agree within the existing extended (>=145 degrees) or curled (<=125 degrees) bands. Require all four non-thumb fingers to agree for OPEN/FIST. Conflicting joints or mixed fingers yield UNKNOWN. This deliberately trades recall for less false activation; thumb opposition and MCP flexion remain future work.
- Share unrounded geometric readings between recognition and rounded debug telemetry. No new reach threshold, model-confidence adjustment, orientation threshold adjustment, or action implementation.
- Clear stabilized pose immediately on uncertainty or an unconfirmed pose change; require a fresh existing 150 ms confirmation before publishing a known pose.
- Default debug off, preserving the opt-in camera/skeleton and telemetry.

Alternatives: tuning PIP thresholds cannot detect distal folding; replacing the model is excessive and would disrupt a working camera stack. Full-chain measurements address the observable information gap with deterministic tests. These synthetic measurements establish geometric correctness, not real-world accuracy or device calibration.

## Steps

- [x] Add dependency-free Node test runner and TypeScript test checking. Initial regressions: 1 pass / 6 failures for the expected behavioral defects.
- [x] Implement the small recognition modules and shared diagnostics; preserve the camera inference path and public API.
- [x] Add transformation invariance, threshold/dead-band, reset/reacquisition, timing and diagnostics regressions; default debug off.
- [x] Run tests (18/18), TypeScript/Vite build and ESLint. Independent read-only review found no blocking findings and reran the tests. Production-preview inspection confirms Debug OFF and video/canvas opacity 0. Detailed evidence and remaining risks: `docs/architecture-audit.md`.

## Review focus

World-space angles must survive mirroring, rigid rotation, translation and uniform scale. Degenerate and non-finite data must fail closed. Uncertainty must reset the confirmation window. Production must initially hide camera and skeleton. Hand identity, long frame gaps, palm calibration and two-hand arbitration remain audited follow-ups; no control consumer may treat the existing orientation candidates as action authorization.
