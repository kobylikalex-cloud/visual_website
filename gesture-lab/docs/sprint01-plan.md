# Sprint 01: performance and upright open palm

User specification: attachment `2d8d6959-35c0-40f1-a814-e5468e6cc1e6/Pasted text.txt`.

Scope: preserve React interface and native input. Only OPEN_UPRIGHT can move an internal pointer and highlight targets. No gesture callbacks, clicking, dragging, scrolling, or multi-hand control are connected. Old engines remain as regression references, outside the active application path.

Audit: `codex/gesture-playground` e46947c has synchronous CPU inference and coupled gesture actions. `fix/gesture-stability-first-pass` bcc54be adds palm continuity, guarded 3/4 recognition and focus retention; reuse these geometry modules without changing recognition bands. `origin/fix/gesture-engine-performance` ba9c4d3 adds a useful single-inflight worker but chooses GPU without benchmarking and retains all gesture actions. Reuse its camera/worker foundation selectively, never merge it. Existing App.css has an empty content diff and is left untouched.

Chosen implementation: isolated pointer engine, existing spatial tracker and orientation classifier, existing target hysteresis, camera worker plus measured CPU/GPU comparison on identical local frames. Alternatives rejected: tuning all actions together contradicts sprint scope; whole-app rewrite discards working native interactions.

1. Test pointer confirmation, identity, unknown hold, stale clearing, fist/flat/two-hand exclusion and calibration; implement pointer-only engine.
2. Test bounded frame admission and telemetry distributions; implement worker transport, same-frame benchmark, startup cancellation, watchdog, latency/drop/long-task instrumentation.
3. Wire pointer-only engine, render via RAF and CSS properties, add five native buttons, debug-only point/identity/raw+confirmed states, comfortable-center/range calibration and local stationary/moving measurements.
4. Run full tests, TypeScript build, ESLint, browser smoke and available camera performance measurement. Document measured data separately from live human acceptance still pending. Commit locally and stop; no push/merge.

Review focus: asynchronous camera stop/start, late worker delivery, unknown vs missing hand, layout changes, debug hidden privacy. Measurements are browser-side, bounded in memory; exports are explicit local downloads. RAF cadence is a rendering proxy, not proof of GPU presentation or physical camera-to-photon latency. No native NPU claim.
