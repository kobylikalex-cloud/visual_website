# Sprint 02: deliberate fist-to-click

Specification: user attachment `1f0ca3cb-3b7d-4d18-b28a-250d1e4ab948/Pasted text.txt`.
Base: Sprint 01.1, 76080c5. Existing App.css status is preserved. Dedicated branch; no push/merge.

Architecture: compose the unchanged OpenPointerEngine with a separate FistClickEngine. During ordinary open-hand navigation, forward its pointer output unchanged. A confirmed upright palm plus stable eligible target can initiate a bounded closing transition; freeze original target/identity and palm anchor. A complete four-finger fist must remain observed for 200 ms. Emit a single activation request, then require 150 ms confirmed upright reopening. All effects pass through a small registered-action registry for test-0 through test-4, revalidated at dispatch. Native controls retain their existing handlers. No drag/scroll actions are connected.

Provisional parameters reuse existing timing: focus 150 ms, fist 200 ms, uncertainty 350 ms, freshness 200 ms. Closure travel is separately limited to .08 normalized camera units; target layout must stay fixed. These are engineering starting values, not measured accuracy claims. Finger closure uses the existing PIP <=135° AND normalized reach <=58% evidence on all four fingers; no rigid thumb requirement and no DIP hard veto. Existing OPEN acceptance bands are unchanged. Personal movement calibration is not a gesture-truth calibration and must not silently loosen closure.

1. Write failing regression tests for four-finger closure, no target/no intent, stable focus, one-shot, release, bounded UNKNOWN, identity/missing/stale/two-hand cancellation, target removal/disable/replacement, excess motion, neighboring targets, and exact open-pointer equivalence.
2. Implement pure click state machine and action registry; monotonic event IDs and no activation from RAF tick. Recheck target eligibility at observation, render and dispatch. Canceled attempts cannot retarget or resume until confirmed reopening.
3. Wire only the five registered actions. Add restrained focus/confirmation/pulse feedback and debug pose/state/lock/progress/rejection/click-count/confirmation latency. Keep frame processing separate from rendering and numeric debug updates throttled.
4. Run full tests, TypeScript build, ESLint, independent review, native browser smoke and available local performance checks. Report actual webcam data separately from fixtures; stop for the user's 20-click/all-target/negative/performance acceptance trial before further gestures.

Review focus: same-ID DOM replacement, stale worker result or lost browser focus immediately before dispatch, held fist across failures/config changes, UNKNOWN during fist confirmation, action pulses replayed by tick/re-render, and preserving pointer/gain behavior. No video or landmarks leave the machine; downloads stay explicit and local.
