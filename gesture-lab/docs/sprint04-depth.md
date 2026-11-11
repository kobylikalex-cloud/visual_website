# Relative palm depth

`RelativePalmDepth` supplies a dimensionless magnification proxy to the isolated spatial scene. Larger values mean a larger projected palm and normally move the cube toward the viewer. No output is a measured camera distance, and there is no conversion to centimetres. Depth validity is separate from gesture classification and X/Y validity: an invalid reading freezes its last relative value while the scene can continue valid lateral motion.

## Geometry and assumptions

Seven fixed palm baselines use landmarks `0–5`, `0–9`, `0–13`, `0–17`, `5–17`, `5–13`, and `9–17`. Finger joints, fingertips, thumb motion and whole-hand bounds never participate. MCP motion caused by a real change in palm shape can still affect this proxy; finger-only closure is invariant by construction.

For each baseline, aspect-correct projected length is `p = hypot(ΔimageX × width, ΔimageY × height) / width`. The camera-oriented world vector supplies only its projection fraction `g = hypot(ΔworldX, ΔworldY) / norm(Δworld)`. Corrected length is `l = p/g`; `scale = sqrt(mean(l²))` over the same seven baselines every time. Dividing by width makes the proxy independent of source pixel resolution for the same normalized projection. Using actual width and height avoids an artificial pitch/roll response on a nonsquare camera image.

Under weak perspective, a rigid baseline of length L has projected length `s × L × g`, so the corrected length is exactly `s × L`. This cancels rigid rotation analytically instead of relying on a palm bounding box. Keeping a fixed set of baselines avoids changing aggregate scale when a shorter or longer baseline drops out; an ill-conditioned baseline invalidates the measurement. The output is invariant to uniform scaling and translation of all world landmarks. World coordinate magnitudes, world centroid Z and image Z never measure camera distance here. The image/world X/Y direction comparison assumes MediaPipe world axes are camera oriented; this is a model-coordinate assumption that should be checked when changing providers or preprocessing.

Google documents image X/Y normalized by image width/height, image Z relative to the wrist, and world landmarks centred on the hand. These definitions make image Z and the world origin unsuitable as absolute camera distance: [official MediaPipe Web Hand Landmarker result definition](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js#handle_and_display_results).

## Error budget and rejection gates

For a baseline at angle θ out of the image plane, `g = cos θ`. A first-order correction error is approximately `δl/l ≈ δp/p + tan θ × δθ`. The image noise term grows as the palm gets smaller, and orientation error grows without bound approaching edge-on. With coordinate errors bounded by one pixel per endpoint coordinate, a deterministic image-length perturbation is at most `2√2 / projectedPixels`. A 2° direction error contributes about 3.5% at 45°, and about 5.3% at the permitted plane-normal limit. These are conditional geometric budgets; one-pixel and 2° errors are explicit engineering assumptions, not empirically established MediaPipe guarantees.

| Gate | Value and justification |
| --- | --- |
| Palm plane conditioning | Absolute normal Z cosine ≥0.55, approximately ≤56.6° tilt. This caps planar orientation amplification at approximately 1.82; near-edge-on is frozen. |
| Each baseline conditioning | Projected world fraction ≥0.5, so its individual correction never exceeds 2×. A nonplanar palm can fail this even when the coarse plane passes. |
| Projected baseline size | At least 24 source pixels for every baseline. The conservative one-pixel coordinate bound is already approximately 11.8% at this minimum, before orientation error; smaller palms cannot provide a useful correction. Passing this gate does not imply 5% accuracy. |
| Degenerate palm | Wrist/index/little cross-product divided by side-length product ≥0.15; this rejects collinearity with a normal amplification above approximately 6.7×. All baseline lengths must also be finite and nonzero. |
| Image/world agreement | Projected baseline directions must agree within 20°. This is a coarse structural mismatch guard with margin for weak perspective, not an accuracy claim. |
| Cross-baseline consistency | Remove the common median log-scale change. Each residual must fit `max(0.06, 2 × hypot(currentError, referenceError))`, where `error = √2/projectedPixels + tan θ × 2°`. The 6% floor allows modest nonrigid/model geometry error; the conditional two-sample noise term tightens for larger, frontal palms. These are rejection heuristics, not statistical confidence bounds. The grab profile stays fixed so slow one-baseline drift cannot silently redefine it. |
| Temporal continuity | Absolute log scale step ≤`0.04 + 1.6 × elapsedSeconds`, with elapsed capped at 250 ms. At 40 ms this permits approximately 11% magnification change. This is an interaction continuity envelope, not an inferred physical speed. A single rejected glitch does not become the next reference. |
| Source validity | Finite positive image dimensions, all five palm points inside the image, paired arrays of 21 points, finite palm X/Y/world XYZ, strictly increasing source timestamps and no source gap >250 ms. Render ticks are not new depth evidence. |

Perspective cannot be fully corrected using orientation alone. If every palm point is within depth fraction ρ of the camera distance, its individual perspective magnification differs from weak perspective by at most `ρ/(1−ρ)`. Baseline subtraction also makes off-axis perspective and depth differences relevant; that point bound alone is not a bound on a recovered baseline. The synthetic camera test therefore explicitly checks the implemented estimator at a palm-centred 0.8 virtual-unit camera distance with palm half-span approximately 0.045 and yaw through ±45°. Its measured scale error must remain below 5%. This is a test geometry, not an estimate of the user's hand or camera distance. Close range, off-axis viewing, lens distortion, model direction error, occlusion and actual palm deformation remain unobservable confounders.

## API and lifecycle

`measure(observation)` performs stateless diagnostics. It returns `{valid, scale, relative:1, neutralScale:null, quality, reason}` and does not change reference, calibration, frozen output or source clocks. `quality` is `conditioned` or `invalid`; it is not a probability or tracking confidence score.

`observe(observation, {handId, pose})` checks source continuity and tracks the last accepted measurement. `pose` is supplied by the existing recognizer; this class does not classify a hand. Before acquisition, valid debug measurements are allowed for any pose and relative remains 1. Pass the actual tracked identity and source timestamp, not RAF time. While a reference exists, every pose other than `FIST` returns invalid and freezes relative depth. Every invalid observe returns `scale:null`, `valid:false` and the last accepted `relative`.

On confirmed FIST acquisition call `captureGrabReference()`. It returns `true` only if the most recent observe itself produced a valid FIST measurement. It anchors that sample and resets relative to 1. A prior valid OPEN or FIST cannot be reused after an invalid latest observation. Capture the cube transform separately in the spatial engine. If initial depth is invalid, acquisition can remain lateral-only; the first later valid FIST can be captured as a depth anchor without moving Z. After anchoring, `relative = currentScale/grabScale`, and output `neutralScale` is that grab scale. Without a grab, `neutralScale` reports the optional calibration neutral scale or null.

`resetGrabReference()` removes the grab, continuity sample and stable window, resets relative to 1, and retains calibration and the source timestamp high-water mark. Use it at release/cancellation or before starting a new calibration position. `reset()` additionally clears calibration, identity, pose and clocks. A detected identity change returns an invalid frozen frame, clears the grab and calibration, and starts a new identity history. The ownership engine must cancel the old grab; this estimator does not own cube selection or cancellation.

There are no thrown validation errors for malformed numeric samples. Reasons distinguish observation/landmark validity, edge-on/ill-conditioned geometry, image-world mismatch, inconsistent baselines, scale jumps, source gaps, pose changes and identity changes. Do not use reason text to bypass ordinary interaction guards.

## Optional near/neutral/far calibration

`captureCalibration('near' | 'neutral' | 'far')` returns a boolean. It captures only a latest valid FIST, with at least six accepted samples in the last 400 ms spanning at least 240 ms. Their maximum/minimum log-scale spread must be ≤0.04 (approximately 4.1%) and their plane normals within 5°. Invalid observations and pose changes clear the window. Failure leaves the existing calibration unchanged. Users should hold each position still; a moving fist cannot be captured as neutral.

`getCalibration()` returns a defensive copy of `{nearScale:number|null, neutralScale:number|null, farScale:number|null, complete:boolean}`. Capture order is unrestricted. Existing pairs must preserve `near > neutral > far`, separated by more than 0.08 log scale, twice the permitted stable-window range. This separation gives distinct sensitivity endpoints; it does not prove a real-world distance separation.

`mapRelativeToScene(relative, {near,neutral,far})` always maps relative 1 to the requested neutral scene value. With complete calibration, it uses separate log-ratio interpolation on each side: `nearScale/neutralScale` maps to `near`, and `farScale/neutralScale` maps to `far`. Values beyond an endpoint clamp there. These calibrated ratios control sensitivity around the current grab anchor; the function does not place the cube at a fixed physical calibration position. Incomplete calibration falls back to bounded linear unit-ratio sensitivity. Nonfinite or nonpositive ratios return the neutral scene value. The caller supplies finite scene range values.

## Local numeric characterization

Only existing ignored local JSON recordings were read. No video, frames or landmarks were uploaded or copied into committed fixtures. These four 2026-10-26 pose recordings lack known camera distances and fixed-distance rotation ground truth, so they cannot establish depth accuracy or distinguish motion from estimator noise.

| Label | Total samples | Paired geometry available | Valid static measurements | Rejections | Accepted scale p90/p10 |
| --- | ---: | ---: | ---: | --- | ---: |
| OPEN_UPRIGHT | 253 | 253 | 206 | 45 edge-on, 2 baseline conditioning | 1.134 |
| OPEN_FLAT | 253 | 224 | 25 | 199 edge-on | 1.055 |
| FIST | 250 | 244 | 183 | 59 edge-on, 2 image/world direction mismatch | 1.221 |
| OTHER | 242 | 242 | 242 | none | 1.080 |

These are `measure()` availability counts before temporal, pose and cross-baseline continuity rejection. The flat-palm freeze is intentional, and the FIST segment's approximately 22% p90/p10 variation is a material limitation. No geometric gate was relaxed to make these recordings appear smoother. Stable fist calibration, depth-only freeze and actual webcam acceptance remain necessary; ordinary side-on gesture recognition is unchanged and can remain valid while depth is invalid.

## Verification

The 20 CPU-only tests cover projected magnification, aspect ratio, exact rigid rotations, bounded synthetic perspective error, one-pixel endpoint perturbations, 2° world-direction error, absolute world-coordinate invariance, closure versus bounding-box false depth, invalid geometry, confirmed-FIST anchoring, glitch recovery, inconsistent baselines, stale/duplicate clocks, identity/pose guards, calibration and reset. Initial execution failed because the depth module did not exist. An isolated in-memory mutation removing foreshortening correction then failed four rotation/error-budget tests; the unmodified source passes all 20. No application files were changed during that mutation check. Two additional failing assertions exposed world-unit underflow and an overflowing direction-agreement calculation; normalizing vectors before cross/dot products turned both green without changing the geometric gates.

At the depth-module verification checkpoint, the full CPU suite passed, TypeScript test checking and the application TypeScript build passed, and ESLint passed for the module and tests. Browser/camera acceptance is owned by the integrated spatial view and has not been established by these synthetic tests.
