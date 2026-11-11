# Continuous pointer and multi-view fist correction

Starting point: `be333bf`, branch `codex/continuous-angle-control`. Keep the accepted pointer filter, gain, mirroring, target registry, camera stream and worker inference. No scrolling, dragging, two-hand actions, OS clicks, uploads or video recording.

## Evidence and decisions

- Live observation: +3 accepted and +6 rejected clicks; repeated `Closing uncertainty expired`. Several visible, landmarked palms coincided with `Observation expired; movement stopped`. These are observations, not a labeled accuracy rate.
- Code rejects every open palm outside UPRIGHT_LIKE, and rejects FLAT_LIKE during fist closure. Finger pose already uses world-space geometry. Remove these control gates; preserve orientation diagnostics and historical classifiers. Open palms of any orientation now aim; orientation will require a separate explicit mode if scrolling is added later.
- Initial/reacquisition confirmation mistakenly uses the 150 ms uncertainty deadline in RAF ticks instead of the 200 ms measurement freshness limit. At measured 50–95 ms delivery and ~60–100 ms frame gaps this can repeatedly erase confirmation before the next valid result. Keep the 200 ms safety cutoff; do not extend stale movement or authorize clicks from ticks.
- Busy inference currently marks camera frames as submitted before capturing them. An available newest frame can therefore be forgotten until the camera advances again. Consume a frame only when capture actually starts; never queue frames.
- Projected 2D palm area rejects exactly side-on palms even when the 3D landmarks span a valid palm. Test image-space 3D nondegeneracy instead, preserving out-of-bounds and identity guards.
- Local opt-in world-landmark run (142 hand-label slots; both labels enabled to tolerate MediaPipe label flips). First ~4.3 seconds show curled fingers, later samples show reopening despite the unchanged FIST marker. Exclude reopening/transition and missing-label slots from fist analysis; do not publish its summary as an error rate. Observed index PIP ~106–120°, reach ~62–68%, fingertip advance along wrist-to-middle-MCP axis ~−15% to −27% of finger-chain length. All four tips fold behind their own MCP plane. Add this geometric half-space evidence alongside the existing compactness band, with existing PIP and OPEN-contradiction guards. Do not relax a scalar threshold globally. Raw data stays ignored/local.
- A worker watchdog timeout occurred in this run. Its cause is not established by the current data. Preserve timeout cancellation, measure the corrected foreground pipeline and CPU/GPU comparison before claiming this is solved.

## Implementation plan (TDD, in this checkout)

1. Reproduce confirmation with RAF ticks between delayed 70–100 ms observations; fix the mistaken timeout. Preserve uncertainty freeze/expiry and strict stale cancellation.
2. Add rotated/mirrored raw-landmark pipeline tests for open, fist and partial fingers through 90° yaw and pitched/flat views. Remove orientation action gates; validate a 3D palm instead of its projected area. Preserve pointer math and one-shot release.
3. Add realistic bone-chain fixtures whose tips fold palmward but whose MCP-to-tip reach exceeds 58%. Add the palm-relative feature and four-finger decision. Test open, hook/partial, extended-finger contradictions, malformed chains and rigid rotations. Replay private samples locally against before/after; report limitations.
4. Pin latest-frame scheduling with busy-then-free and duplicate/cadence tests. Use the tested scheduler in CameraManager without changing getUserMedia or worker delegate/model.
5. Update instructions/diagnostics to explain any-angle open aiming, retain normal-mode privacy. Run full tests, build and lint. Review the change and perform foreground live acceptance; no push or merge.

## Completion record

Implemented the five planned corrections without changing pointer filtering, gain, mirroring, orientation metrics or worker inference/model. Initial confirmation and side-on pipeline tests were observed failing before their fixes. The new palmward fist fixture failed under the former classifier and passes with the additional half-space evidence. Capture admission tests pin busy-frame retention, duplicate/cadence handling and session-token isolation.

- Full suite: 124/124 passing; TypeScript/Vite production build and ESLint pass.
- Independent read-only review found no actionable correctness or click-safety issues.
- Private replay: observed held-closure window <=4300 ms, 45 samples: former control FIST 27 / UNKNOWN 18; corrected FIST 45. Reopened window >=4800 ms, 21 samples: OPEN 21 before and after. Intermediate transitions excluded. This is an exploratory, single-user sample, not a held-out accuracy estimate or an independent false-positive benchmark.
- Same-frame device benchmark: 20 pairs after five warmups, CPU median/p95 116.9/155.9 ms; GPU 27.4/40.5 ms. The existing comparison selected GPU. The comparison itself adds latency and its aggregate FPS is not steady-state acceptance performance.
- Live acceptance: the user tested the corrected working tree on 2026-10-23 and reported being very satisfied. This is qualitative acceptance, not a measured all-angle error rate. The earlier worker timeout remains a tracked observation; its cause has not been proven fixed by the scheduler change.

Synthetic fixtures establish invariance/safety, not real-camera accuracy. Fully occluded fingers cannot be guaranteed from a single camera; UNKNOWN must remain safe. No new raw landmark data is committed. No push or merge.
