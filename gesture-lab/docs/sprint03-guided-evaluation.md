# Guided webcam comparison — 2026-10-24

Branch: `codex/sprint03-palm-scroll`, baseline `6a1573f`, modified worktree. No push or merge. All camera processing and exports stayed local; no video was recorded. The camera was stopped and gestures left paused after testing.

## Why the test mode changed

Chat instructions were easy to miss while the browser was foreground. Two preliminary sequences mixed intended postures and are not valid per-posture accuracy measurements. The debug evaluation now offers German on-screen instructions, three seconds of preparation and twelve seconds of bounded measurement for each of OPEN_FLAT, OPEN_UPRIGHT, FIST and OTHER (two fingers).

The guide is a portal so the instruction stays visible independently of page scrolling or the collapsed debug details. The model, not a UI timer, excludes preparation and late frames. One hand is expected independently of MediaPipe handedness flips: zero/multiple/ambiguous observations produce one UNKNOWN slot, rather than inventing a missing second hand. Inference continues, gesture effects remain paused during measurement. Hidden tab, camera stop, debug unmount, abort and capacity stop recording. Each section requires its own explicit local JSON download. New guided exports use schema version 2 with `hand: Single` and capture-window metadata; existing manual Left/Right exports remain version 1. The first four prototype guided captures used version 1 plus the same single-hand metadata.

## Results from four separate guided sections

These are **raw predictions on prompted local sequences**, not independently annotated video ground truth, universal accuracy estimates or click error rates. A visual sample confirmed each requested posture; compliance was not verified frame by frame. In particular the upright interval contained 71 orientation measurements inside the flat band, so it cannot prove whether each frame was physically upright or the 3D estimate was wrong.

| Prompt | Slots / observed hands | Protected control OPEN / FIST / UNKNOWN | Conservative OPEN / FIST / UNKNOWN | Historical hybrid OPEN / FIST / UNKNOWN |
| --- | ---: | ---: | ---: | ---: |
| Flat open | 185 / 185 | 49 / 13 / 123 | 0 / 0 / 185 | 157 / 9 / 19 |
| Upright open, turning sideways | 198 / 198 | 152 / 33 / 13 | 32 / 0 / 166 | 152 / 15 / 31 |
| Fist, frontal and sideways | 205 / 205 | 6 / 193 / 6 | 0 / 41 / 164 | 6 / 193 / 6 |
| Two fingers | 185 / 147 | 0 / 0 / 185 | 0 / 0 / 185 | 43 / 0 / 142 |

The flat sequence passed the **existing orientation entry gate in all 185 observed frames**: depth 59–80 degrees, facing 15–51%. Thus widening that gate does not solve this recorded failure. The main repeated conflict was EXTENDED/CURLED/EXTENDED/EXTENDED (106 of 123 UNKNOWN frames): the middle finger's estimated reach was about 45–62%, although the hand was being shown open. This is a finger-evidence veto, not merely a missing scroll orientation.

The hybrid recovers more flat OPEN observations but falsely emits OPEN on 43 of 147 observed two-finger frames (29.3% of that observed negative sample). The protected control emits no known pose in that section. Missing/ambiguous slots (38) are listed separately rather than counted as evidence that the finger classifier failed. Merely accepting any three extended fingers would sacrifice this guard. An offline candidate requiring at least three extended fingers and every fingertip ahead of its MCP plane recovered only 44/185 flat observations, worse than the current 49/185, and was rejected without entering runtime code.

Median inference in the four sections was approximately 47.3, 44.6, 43.4 and 49.0 ms. These measure inference work, not physical response latency. The first-match marker follows a three-second preparation, so it does **not** measure new-gesture acquisition latency. All five target counters stayed zero; the application pause remained enabled throughout. Those facts establish an actions-paused test, not a live click-accuracy claim.

## Recognition decision and next evidence required

No active recognition threshold or classifier was changed from this probe. Keep the protected pointer/fist engine and strict click confirmation. Keep the already tested scroll pause/freshness corrections. Do not replace the control classifier with the historical hybrid or broadly widen orientation bands.

A balanced scroll classifier needs to distinguish a genuinely folded finger from a bad 3D reconstruction under foreshortening. Evaluate any candidate separately from click recognition, using identical inputs and explicit abstention. Additional negative coverage must include flat two-/three-finger hands, forward hooks and flat fists; the current two-finger negative is mostly upright. A new candidate should also be checked on a separate later session rather than tuned and scored on these same correlated frames. If landmark evidence cannot separate the poses, retain UNKNOWN; temporal hold must not invent OPEN indefinitely. Normalized image landmarks alongside world landmarks would permit a projection-consistency/occlusion comparison; the current exports contain world landmarks only, so this cannot be validated retrospectively.

**Sprint 03 has not passed webcam acceptance.** This work supplies reliable local measurement and identifies the actual bottleneck; it does not establish broad angle robustness or smooth production scrolling.

## Paired image / world comparison

A subsequent debug-only probe exports normalized image landmarks and world landmarks from the **same inference result**, the intrinsic image dimensions and the existing capture timestamp. Schema 3 explains both coordinate systems and relative timestamps. Image diagnostics restore the aspect ratio and discard inferred depth; they do not replace the orientation module. Capture-window enforcement also rejects preparation frames delivered late and repeated or future capture timestamps. Video is neither recorded nor uploaded.

The prompted flat-open sequence contains 182 paired observations. The protected classifier emitted OPEN 126, FIST 9 and UNKNOWN 47. A shadow candidate preserves every known baseline pose and repairs UNKNOWN only when at least three world fingers and all four projected fingers satisfy the existing extension rules. It emits OPEN 162, FIST 9 and UNKNOWN 11 on these identical inputs: 36 additional OPEN observations, without changing angle/reach thresholds. The recurring middle-finger conflict has world reach around 51% versus projected reach around 100%. This supports investigating erroneous inferred depth; it does not prove the projection is always correct.

The two-finger interval has 196 slots, 174 paired; both classifiers emit one OPEN. The fist interval has 197 paired observations; both emit FIST 175 and UNKNOWN 22, with no OPEN. **These negatives are predominantly upright**, despite the original flat prompts, so they do not validate flat negative-pose rejection. Later trials with the hand outside the camera image are excluded from classifier conclusions. The guide now names hand-back-up variants explicitly, adds a partially bent-finger negative and visibly warns when zero or multiple hands are detected.

An offline controller replay uses the same paired positions and capture/delivery times, simulated 16 ms ticks and a fixed viewport. The candidate increases simulated active time from 1088 to 2464 ms, but captured-neutral resets increase from two to four. This is not evidence of uninterrupted or smooth scrolling. Nine baseline false-FIST observations remain unchanged. No production controller imports the candidate; it is shown and exported exclusively for debug comparison. Flat fists, flat partial gestures and a separate positive session must be checked before any controlled scroll-only experiment.

### Flat-negative countercheck: candidate rejected

After improving illumination, the explicitly prompted flat fist was visible in a live sample. The saved sequence contains 199 paired observations, **all 199 inside the existing flat-entry orientation band**. The protected classifier emits UNKNOWN 164 / FIST 35 / OPEN 0; the projection candidate adds **44 false OPEN results (22.1%)**. All 44 share the same world EXTENDED/CURLED/EXTENDED/EXTENDED and all-extended projection pattern as the 36 positive repairs. Refusing to override a world CURLED finger removes all 44 false repairs **and all 36 positive repairs** in these sequences. This directly rejects the proposed rule; changing temporal confirmation cannot establish missing finger-pose evidence.

| Prompted sequence | Slots / paired | Entry-flat paired | Protected OPEN | Shadow OPEN |
| --- | ---: | ---: | ---: | ---: |
| Flat open | 182 / 182 | 118 | 126 | 162 |
| Flat fist, clearer prompt | 199 / 199 | 199 | 0 | 44 |
| Flat two fingers, clearer prompt | 205 / 94 | 94 | 15 | 16 |
| Flat hand, one bent finger | 252 / 0 | 0 | n/a | n/a |

The two-finger run has 111 missing/ambiguous slots, so conditional error counts on the 94 paired observations must not be presented as whole-session classifier accuracy. The final bent-finger run has no eligible paired observations and is unusable for pose discrimination. Neither video nor per-frame independent annotation exists; all tables retain the prompted-sequence qualification.

Flat-fist inference median/p95: 43.0/58.2 ms; observed two-finger frames: 47.4/76.2 ms. These are software inference times, not physical response latency. A same-input simulated replay of the rejected candidate even establishes two scroll neutrals in the fist sequence; signed scroll delta happens to be zero in that motion, which is not a safety pass. No such override ran in the real controller. Camera is stopped, actions paused, and the UI/export explicitly identify the candidate as rejected. Existing pointer/fist recognition remains untouched.

Next recognition work must obtain additional distinguishing evidence rather than reuse this failed override. Compare an independent local image/pose model on these positive and flat-negative cases before changing control behavior. A different landmark classifier alone must demonstrate discrimination; it cannot be assumed to fix contradictory reconstructed fingers. Active scrolling acceptance remains pending.

## Free navigation trial, 18:56–18:58 Europe/Vienna

At the user's request, a later free-use trial replaced prescribed postures with natural pointing, clicking and scrolling. The existing camera was already running; Debug was enabled with historical evaluation collapsed, labeling remained stopped and the application pause was released. No guided capture, video recording, landmark export, classifier change or page manipulation occurred during observation. The rejected candidate remained isolated from controls. Visual/DOM samples span approximately 82 seconds (16:56:46–16:58:08 UTC); cumulative performance includes camera preparation before that interval.

Observed document positions: 0 → 791.8 → 2018.2 → 1722.3 → 0 px. A flat-hand sample reached SCROLL_ACTIVE at 600 px/s downward. Subsequent samples repeatedly returned to SCROLL_ENTRY / finding neutral; one established neutral 0.577 with -0.7% displacement and zero velocity. Upright OPEN subsequently reached confirmed POINTER_MODE. The final export records one registered gesture click, matching North east's counter of one; the other four counters stay zero. One rejected attempt reports `Scroll rotation clears pointer target`. The click arrived after the last intermediate observation reporting zero clicks. No independently labeled intended-click denominator exists, so this is not a click-success/error-rate measurement.

The exported cumulative camera session is 121.1 seconds, processed 15.9 FPS versus 29.5 presented camera FPS. Inference median/p95 41.6/83.6 ms; capture-to-publication 45.9/92.9 ms; capture-to-page-scroll application 59.4/102.3 ms. Last registered fist confirmation is 249.9 ms and first fist capture to registered activation 337.9 ms; these are software timings. The 386 recorded mode transitions include intentional changes, missing-hand periods and an observed INACTIVE/UNCERTAIN alternation, so they must not be presented as 386 recognition failures. The bounded final history has lost earlier transitions and does not explain every neutral reset.

The trial confirms functional page travel and a gesture click, but does **not** pass fluid-scrolling acceptance. Further diagnosis should distinguish pose/identity interruptions from wrapper state-reporting churn rather than equate the transition count with recognition errors. Numeric summaries were downloaded and preserved under ignored `.local-evaluation/free-navigation-2026-10-24-1858-{scroll,performance}.json`; no raw camera data was saved. Camera stopped, Debug OFF and gestures paused at handoff. No source behavior was modified during this trial, and nothing was pushed or merged.

## Verification

- 161 automated tests pass, including all prior evaluation tests, guided preparation/deadline/single-hand/capacity/cleanup ownership, paired coordinate copying, capture-time rejection, aspect-correct projection and shadow-candidate abstention/known-pose preservation.
- TypeScript/Vite build and ESLint pass; inference worker bundle remains unchanged.
- Independent review found an old-guide cleanup race after immediate abort/restart. `stopSingle(segmentId)` now scopes cleanup to the owning capture; Stop/Clear/manual restart clear the portal immediately.
- A camera-free browser harness verified abort → manual recording, abort → new guided recording, and clearing an active guide. New sessions remained recording, old portals disappeared and no camera was requested.
- The user tab was fully reloaded after class changes because HMR preserves old instances held in React state. Camera off, Debug OFF, gestures paused at handoff. Raw JSON, replay tools and browser harness remain outside tracked sources.
