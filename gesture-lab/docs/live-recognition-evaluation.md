# Live recognition regression and local A/B evaluation

## Source verification

Before changes, the checkout was clean on `codex/conservative-finger-recognition` at `99131fc`. The existing Vite process (PID 34440, started 2026-10-23 13:16 local time) listened on `::1:5174`; fetching `http://localhost:5174/src/gestures/HandPoseEngine.ts` returned the conservative two-joint, all-four-finger classifier. This verifies the local server's source at inspection time, not which cached page any recording used.

The prior hybrid classifier is `a54a49e5f40a3a962b37149940cda40ec48a3877` on `origin/fix/hybrid-finger-pose`. It is on a sibling branch sharing `5d025b7` with the conservative change; it was not the conservative commit's immediate parent. No fetch, checkout of the remote branch, merge or push was needed. Current evaluation work is on `codex/local-recognition-evaluation`.

The debug panel now identifies branch, source commit, modified-worktree status and server/build-start provenance. Exported sessions include that identity and build timestamp. A modified-worktree badge explicitly means the commit alone does not identify all served code. Restart/reload the Vite configuration after committing to refresh static provenance.

## Observed cause

The conservative classifier uses independent hard requirements: every non-thumb finger must have both PIP and DIP >=145 degrees for OPEN, or both <=125 degrees for FIST. A single noisy or naturally bent joint vetoes the whole hand. Any resulting UNKNOWN also immediately resets the 150 ms confirmation window. The change improved synthetic contradiction rejection but imposed an uncalibrated DIP veto and full agreement. The reported open-hand regression is a consequence of those decisions, not evidence that the camera or palm orientation module should be replaced.

The hybrid reference uses PIP plus reach: extension is `(PIP >=145 and reach >=65) or (PIP >=100 and reach >=70)`; curling is `PIP <=135 and reach <=58`. Three agreeing fingers suffice. These are historical provisional settings, not newly selected optimal thresholds. The reference preserves historical rounded PIP/reach and its geometry calculation; a sparse-array guard returns UNKNOWN instead of reproducing an old exception. Historical unsafe temporal persistence is not restored. Both comparison outputs use separate instances of the current fail-closed 150 ms filter so temporal policy is held constant.

## Recording evidence

Newest recording: filename ending `2026-10-23 14-26-12.mp4` in `C:/Users/kobyl/Videos/Captures`; duration 48.81 s, 1920×1032. It was decoded locally. Private extracted frames, manual transcription and full notes remain in the ignored `.local-evaluation/` directory, excluded from Git and ESLint. No video or personal images are committed.

18 selected chronological frames contain 29 displayed hand-slot observations: 25 UNKNOWN and 4 FIST. These are targeted descriptive counts, not framewise accuracy estimates. Three clearly associated single-hand upright-open samples (23, 24, 26 s) all display UNKNOWN: **3/3 selected open observations rejected**. There are no suitable independent OTHER negatives in this subset; a live false-positive rate is **not available**, and no zero-FP claim is justified.

Representative complete Hand 1 readings are replayed through the historical hybrid rules and the conservative joint rules on identical **rounded features**, not reconstructed landmarks:

| Video time | Recording observation | Conservative from rounded features | Hybrid from same rounded features |
| --- | --- | --- | --- |
| 23 s | Single upright open palm; UNKNOWN; reach 91–97% | OPEN | OPEN |
| 24 s | Single upright open palm; UNKNOWN; index 164/141°, middle 142/177° | UNKNOWN | OPEN |
| 26 s | Single upright open palm; UNKNOWN; index DIP 143° | UNKNOWN | OPEN |
| 36 s | Held-fist interval; Hand 1 UNKNOWN; reach 33–42%, index DIP 128° | UNKNOWN | FIST |
| 37 s | Held-fist interval; Hand 1 UNKNOWN; reach 32–43%, index DIP 127° | UNKNOWN | FIST |
| 38 s | Held-fist interval; Hand 1 UNKNOWN; reach 32–41%, index DIP 128° | UNKNOWN | FIST |

At 23 s an index DIP displayed as exactly 145° can hide an unrounded value below 145°, or UNKNOWN may reflect interrupted confirmation. The screenshot cannot distinguish those causes; do not call the rounded replay a mismatch in the implemented classifier. At 24/26 s the joint veto is visible without relying on rounding at the boundary. During the held-fist interval the asymmetric DIP veto similarly explains Hand 1's rejection while Hand 2 can confirm FIST.

Flat palms visibly remain UNKNOWN at 33/34/44/46 s, but Hand 2's middle/ring/pinky rows are clipped, and two-hand screen-side-to-slot association is unverified. These frames establish a symptom, not complete independently labeled flat-hand fixtures. New per-hand details below the camera expose all finger rows without that clipping.

At 35/40 s the camera and skeleton/telemetry depict different transition states. Exclude these from classifier accuracy and physical latency claims. The old recording has no raw landmarks, sample timestamps or label-onset markers, so exact full-landmark replay and physical recognition latency are **not recoverable**. Re-running MediaPipe on a screen recording would produce new, overlay-occluded estimates and is not a faithful replay of the original input.

## Use the local evaluation mode

1. Open the existing app at `http://localhost:5174/`, enable **Debug**, then start the camera normally. The evaluation panel, video, skeleton and all A/B diagnostics are hidden when debug is off. No automatic camera start was added.
2. Check the MediaPipe Left/Right labels in the A/B rows. These are anatomical category labels, not mirrored screen sides or durable track IDs. Choose independent truth labels for either/both hands. Leave an unobserved target Unlabeled unless testing a deliberately missing labeled hand.
3. Hold a known pose and click **Start new labeled session**. This clears earlier samples and resets both shadow filters. Change a truth label to mark each new segment, or select Unlabeled to stop scoring that hand. Use OTHER for a known negative or deliberate transition; do not use it for an uncertain visual annotation.
4. Alternate OPEN_UPRIGHT, OPEN_FLAT, FIST and representative OTHER poses on both hands. Include pose transitions, partial occlusions and no-hand intervals. Keep independent held-out sessions for evaluating any eventual classifier changes.
5. **Stop labeling** or **Refresh measurements** computes a summary snapshot. Camera stop/error, debug off or the 10,000-observation limit also ends recording. A frame is not partially stored at the limit. Existing samples remain in memory until cleared, a new session starts, or the page closes/reloads.
6. **Download local JSON** explicitly saves labeled landmarks, predictions, orientation telemetry, timing, source provenance and the report. It uses a browser Blob download, without a server request. The JSON is private local evaluation data; it is not automatically persisted, uploaded or committed. No video is recorded. **Clear local samples** releases the session's retained data.

During debug, both algorithms receive the same actual world-landmark array on each detection. Raw and stabilized results appear separately. Label collisions or missing categories make identity unreliable: shadow confirmation histories are removed, and a selected missing/ambiguous hand is scored UNKNOWN. Unique category labels still do not solve physical track identity; avoid crossing hands during a labeled segment or mark that interval OTHER/unlabeled.

## Metric definitions

- OPEN_UPRIGHT and OPEN_FLAT both expect finger pose OPEN; their confusion counts are stratified separately. FIST expects FIST; OTHER expects UNKNOWN. Palm orientation is recorded but does not determine pose ground truth or modify the orientation module.
- For each algorithm and raw/stable stage, report one-vs-rest OPEN and FIST TP/FN/FP/TN. `FNR = FN/(TP+FN)`; `FPR = FP/(FP+TN)`. Empty denominators are n/a. A wrong known class contributes a FN for the intended class and FP for the predicted class. Missing labeled hands contribute false negatives for known targets.
- Positive-segment latency is the manual start/label marker to the first matching analyzed result, summarized by median/p95. Segments that never match are reported separately as unrecognized/censored. This is neither physical-motion latency nor sensor-to-display latency. Manual preparation, label timing, frame cadence and inference all affect it. OTHER is evaluated for false activations, not positive acquisition latency.
- Inference timing measures `detectForVideo`; algorithm compute timing measures each shadow raw classifier. Both are reported separately from marker-to-match time. Inference statistics are weighted per labeled hand observation; two labeled hands share the same frame inference duration. The extra debug work can affect cadence, so compute timings are diagnostic estimates, not a controlled microbenchmark.
- The shared existing stabilizer uses elapsed timestamps, not proof of continuous frames. A frozen video or long period with no analyzed frame can bridge a confirmation window or retain a previous known state. Inspect exported timestamps and exclude stalled intervals when interpreting stable latency. This policy is held equal in A/B and intentionally not changed in the active camera pipeline; freshness gating remains future work. A segment with no analyzed observation has no latency measurement at all.

## Balanced classifier proposal

Do not lower the DIP cutoff globally. The observed separation is between extended-finger reach (91–97% in the unambiguous upright samples, 83–97% in reported flat samples) and short reach (32–43% in the held-fist Hand 1 cases), while individual joint angles cross strict bands. Independent reach evidence is therefore useful; DIP is not a reliable universal veto in these observations.

Evaluate a candidate that restores hybrid PIP-plus-reach evidence, retains finite/degenerate-data rejection and immediate uncertain-output invalidation, and treats DIP as supporting/contradiction evidence when corroborated by reach and other joints. For FIST, require corroborated bend and short reach rather than every DIP <=125. For whole-hand consensus, compare majority-with-contradiction rejection against all-four agreement using the labeled OTHER examples; the old majority rule can accept partial gestures and must not be assumed safe merely because it recognizes these positives.

Keep palm orientation independent. Use upright/flat labels to examine whether missing features, occlusion or camera geometry explain errors, rather than silently changing orientation thresholds to compensate for pose errors. Select reach/angle bands, contradiction policy and temporal tolerance only on a training split; compare both-hand held-out FNR/FPR, UNKNOWN rate, positive-segment failures and latency before promotion. The present positive-heavy recording cannot select final numeric thresholds or establish balanced false-positive performance. The active conservative classifier therefore remains unchanged in this evaluation patch; the historical hybrid is a shadow baseline, not a silently promoted replacement.

## Validation

`npm test` checks TypeScript and runs automated tests for historical rule parity, identical-input A/B, independent histories, missing/ambiguous hands, metric denominators, raw/stable separation, wrong-class FP+FN, censored latency, bounded capture, opt-in behavior, immutable captured samples and recording-derived feature cases. Existing geometric invariance and fail-closed pose tests remain in place. Browser inspection verified debug gating, independent label selection, empty-denominator n/a displays, stopped/unlabeled capture controls, and label consistency after debug remount. No physical-camera capture was started by the agent. Independent read-only review found no blocking issues and identified the documented no-frame freshness limitation.

Final checks: **29/29 automated tests pass**, TypeScript/Vite production build passes, and ESLint passes. `git diff --exit-code` confirms the active classifier, active pose stabilizer and palm orientation module are unchanged. Private frames and transcription files are ignored by Git.
