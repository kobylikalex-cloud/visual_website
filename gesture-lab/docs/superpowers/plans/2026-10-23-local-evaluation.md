# Local recognition evaluation plan

User-authorized scope: investigate the live regression, compare conservative `99131fc` with hybrid `a54a49e`, add debug A/B and optional local labels/metrics, preserve camera/orientation, no actions, push or merge.

Verified starting state: clean `codex/conservative-finger-recognition`, HEAD `99131fc`. Vite PID 34440 on localhost:5174 serves the strict DIP >=145 code. Work continues on `codex/local-recognition-evaluation`. Hybrid commit `a54a49e` is on a sibling remote-tracking branch; it was not the parent of the conservative change.

## Design

- Keep active recognition unchanged during evaluation. Run a provenance-marked copy of historical hybrid raw classification on the very same world-landmark array as conservative classification. Preserve historical rounding/geometry for a faithful reference.
- Compare raw output and output through identical fresh 150 ms fail-closed stabilizers; explain that historical temporal behavior is intentionally not restored.
- Debug-only A/B table with raw/stabilized predictions, hand label, timing and source identity. No action outputs.
- Opt-in recording with independent Left/Right truth labels: OPEN_UPRIGHT, OPEN_FLAT, FIST, OTHER, or unlabeled. Labels are manual ground truth, never derived from recognition. Missing hands count UNKNOWN; duplicate/unusable handedness cannot share histories. Orientation remains diagnostic and unchanged.
- Keep bounded samples in memory only until explicit local JSON download. Retain landmarks only while recording. No video recording, persistence, uploads or remote APIs. Stop on debug off, camera stop/error, or capacity.
- Report raw/stabilized one-vs-rest OPEN/FIST false negatives/positives with denominators, per-label counts, UNKNOWN, and manual-label-marker-to-first-correct latency. Unrecognized segments are censored (reported separately, never silently dropped). Per-observation inference/classifier compute timing is separate from manual-marker latency.
- Include source metadata and exact classifier versions in exports. Static build identity describes source at build/server-config time and marks modified worktrees.

## Verification

- [x] Write failing tests for hybrid/reference parity, observed strict rejection, same-input A/B, independent histories and missing/ambiguous hands.
- [x] Implement comparison and local session/scoring modules; test correct metric denominators, OTHER negatives, wrong-class FP+FN, no-detection, per-hand labels, start/stop/reset, caps and censored latency.
- [x] Integrate a separate debug panel without changing inference startup or orientation code. Add source badge via Vite metadata. Follow React review guidance for lazy initialization, stable handlers and accessible controls.
- [x] Inspect newest video locally in ignored `.local-evaluation`, transcribe representative timecoded readings and qualify sampling/rounding limits. Three unambiguous upright-open samples display UNKNOWN; no full-landmark replay or exact physical latency claim.
- [x] Tests/build/lint and browser checks completed; independent review found no blocking findings. Report and measurement-led classifier proposal: `docs/live-recognition-evaluation.md`. Retain shared-filter no-frame-gap behavior for policy parity and document the measurement limitation rather than add an unmeasured freshness timeout.

Why this approach: lowering the DIP threshold would not measure the reach/angle tradeoff or the four-finger veto. Replacing the active classifier now would confound evaluation. Controlled shadow comparison preserves the working pipeline and yields reusable evidence.
