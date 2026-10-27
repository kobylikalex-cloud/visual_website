# Open / click / scroll production candidate — 2026-10-26

The user explicitly requests sustained work toward production readiness today, without repeated permission stops. This plan authorizes no push, merge, video recording or external camera/landmark processing. Work continues in the existing dirty dedicated branch; preserve the accepted baseline and all existing Sprint 03 changes.

## Evidence and decisions

The latest touchpad trial registered five clicks but the user rated it approximately unchanged and insufficient for cursorless navigation. Automatic scroll intruded into pointing. Last numeric session: camera29.6Hz, processing16.75Hz, inference45.5/63.8ms median/p95, first CSS56.45/100.8ms. A controller-only160px step needs330ms to90% with140ms smoothing; first feedback understates perceived motion lag. Existing projected-finger rescue was rejected after44/199 falseOPEN fist observations. Do not relax finger thresholds or promote that rule.

1. Fix independently reproduced cancellation/state-reporting churn while preserving release lockout and replay protection.
2. Implement and test a causal speed-adaptive movement filter candidate. Preserve the slow baseline for comparison, no prediction or overshoot, source timestamps independent of RAF. Compare coarse response and stationary noise, then live focus.
3. Add opt-in learned MediaPipe recognition comparison using one local recognizer graph, same returned landmarks for geometric versus learned classification, no duplicate inference. All frames from this unvalidated mode must pause effects regardless of debug/recording. Keep default hand model intact. Model outputs including None remain visible; no forced binary classifier.
4. Remove misleading target feedback: only registered, eligible app click actions may acquire click focus. Extend the existing explicit safe action registry to ordinary app buttons; leave dragging and arbitrary DOM/system inputs disconnected.
5. Investigate scroll intent independently of finger pose. Evaluate paired palm projection as a possible veto on erroneous 3D orientation; add no unmeasured arbitrary angle band. If evidence cannot distinguish intended posture, preserve abstention and discuss an explicit intent signal rather than claiming universal angle support.
6. Integrate candidate, run full tests/build/lint and independent review; verify actual local browser lifecycle. Live comparisons must include stationary pointing, all click targets, partial gestures, scrolling neutral/directions/stops, open↔fist↔scroll, hand loss/two hands/focus loss and the normal UI without a point.

## Finite release gate

Additional user requirement2026-10-26: fast, fluid movement for rapid users and short open/fist/scroll combinations; a friend entering the camera exposed the sluggishness. Measure transport, coarse tracking response, gesture dwell and reacquisition separately. Remove avoidable scheduling/filter delay before weakening confirmation. Preserve one-hand identity and abstention when two hands appear. A fast-user live acceptance block is mandatory, including reversals, repeated clicks, resting height stops and hand return. Existing200ms fist dwell remains a known restriction until labeled short-fist/negative trials justify a change.

Automated checks and review clean; no effects from uncertain/missing/stale/two-hand/evaluation inputs; correct action eligibility and no duplicate/held-fist clicks. Repeated live open/fist/scroll transitions, neutral stops and screen-edge navigation must pass, with user acceptance without debug visuals. Count intended attempts, successes, misses and false activations separately; report software capture, inference and filter settling rather than claiming physical latency. A finite successful local trial does not establish all users/devices/all angles. If any required gate fails, keep the candidate unapproved and name the remaining failure. The desired date is a target, not evidence of readiness.

## Ownership / progress

2026-10-26 live feedback: the first adaptive candidate was "very much better" but still too slow and needed excessive arm travel. After compact35% mapping, early OPEN geometry preview, adaptive fine movement without the old dead zone, the user explicitly accepted hand travel and following ("Handweg und Folgen passen jetzt"). Preserve these settings. Scroll acceptance still fails, including when the user waits flat first. A later explicit requirement removes the stationary prerequisite: a deliberate flat up/down stroke should start scrolling directly. Implement a separate motion-intent entry using the existing minimum3 fresh strong-flat OPEN samples and existing3% neutral band; freeze neutral at the stroke origin. Retain continuous position control after entry, existing orientation/finger thresholds, no action from UNKNOWN, no queued time, and the stationary entry as an optional fallback. This is a changed entry contract, not an approved universal scroll solution.

- State integrity agent: PageGestureEngine cancellation tick guard and focused regressions.
- Movement agent: standalone AdaptivePointerFilter and tests; root integrates.
- Model agent: worker/protocol/local official model and tests; root integrates camera lifecycle.
- Evaluation agent (after state fix): learned rows/capture/metrics/debug panel.
- Root: camera safeguards, integration, registry, intent investigation and browser/live acceptance.
