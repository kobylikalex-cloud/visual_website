# Phase 05 Gesture Playground implementation plan

User explicitly requests all four functional gestures in this sprint, conservative reversible page-only effects, and no push/merge. Start clean from `70de000` (which includes conservative recognition and local evaluation). Branch: `codex/gesture-playground`.

## Design

Retain camera/MediaPipe lifecycle and local assets. Add a frame callback and independent watchdog; normal mode hides the mounted video/canvas and all diagnostics. Use normalized image palm centers for positioning, world-space PIP/reach for validated recognition, existing camera-relative orientation metrics unchanged. The observed hybrid evidence supports a control-specific classifier with complete-hand agreement and explicit contradiction rejection; preserve old A/B baselines for regression/debug. No endless threshold tuning.

Spatial one-to-one tracking ignores handedness as identity. Ambiguous association, crossing, unexpected counts, malformed geometry, stale results, tab hiding or camera loss invalidate intent. Each new gesture needs confirmation. A click requires a previously confirmed upright-open hand, a stable eligible target and a deliberate confirmed fist; no pinch shortcut. Lock focus through grasp confirmation. Drag produces only reversible card motion and never a click. After any grasp or invalidation, re-arm through an open hand.

Scrolling occurs only in the playground's dedicated long content pane. Each confirmed flat hand gets its own entry neutral Y. Velocity has a dead zone and smooth bounded ramp. Two independently tracked flat hands must both leave neutral in the same direction for approximately 3x speed; any opposing/neutral/invalid hand stops the pair. A two-to-one transition requires fresh confirmation, never immediate fallback.

Config isolates prototype timing, movement and association settings. Existing 50ms inference interval justifies 150/180ms confirmation and 200ms freshness; spatial/movement values are conservative UX defaults, openly documented and adjustable in debug. No new landmark-derived tuning claim. A small status indicator and element-level magnetic feedback provide normal-mode visibility without rendering an interaction point.

## Tasks and ownership

- [x] Tracking/validation module and tests: spatial identity, crossing/ambiguity, missing/stale hands, full-hand control classifier. Independent tracking suite: 12 cases.
- [x] Pure interaction modules and tests: state/arming, pointer smoothing, focus hysteresis, neutral scroll and agreement. Interaction suite: 27 cases, including dormant closure and all cancellation barriers.
- [x] Professional dark playground component/styles, compact desktop and responsive mobile layout; no rendered point, normal-mode camera or skeleton.
- [x] Camera callback/watchdog, page-only coordinator, movement settings, reversible demonstration callbacks and end-to-end landmark integration regressions. Camera startup/cancellation and A/B labeling preserved.
- [x] Tests 75/75, production build and ESLint pass. Browser verified native buttons, keyboard drag, real journal overflow, hidden normal-mode graphics and physical 1280×720 camera frames; debug on retains stream; stop/idle controls restored. Independent review found gradual closure and evaluation-start gaps, both fixed with regressions. Delivery notes/README document exact launch and limits. No merge/push.

## Completion constraints

Actions only target explicitly eligible demo elements. Camera controls/debug/evaluation never receive gesture clicks. Normal UI has no feed, skeleton, virtual hand or cursor. Gesture loss immediately stops effects; watchdog also covers no-new-frame stalls. User input (Escape, camera stop, tab hidden, debug evaluation recording) cancels action intent. Inference, screenshots, landmarks and local labels are never sent to external services.
