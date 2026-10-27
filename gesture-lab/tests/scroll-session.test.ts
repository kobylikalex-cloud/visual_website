import test from 'node:test'
import assert from 'node:assert/strict'
import { PageScrollSession } from '../src/control/PageScrollSession.ts'
import { classifyScrollPose, calibrateFlatPose, DEFAULT_SCROLL_POSE } from '../src/control/ScrollPoseProfile.ts'
import type { TrackedHand } from '../src/control/types.ts'

const hand = (t: number, y = .5, extra: Partial<TrackedHand> = {}): TrackedHand => ({
  id: 1, timestampMs: t, center: { x: .5, y }, pose: 'OPEN', orientation: 'FLAT_LIKE', ...extra,
})
function active() {
  const session = new PageScrollSession()
  for (let t = 0; t <= 500; t += 50) session.observe(hand(t), true, true, t)
  assert.equal(session.tick(500).state, 'ACTIVE')
  return session
}

test('default scroll pose distinguishes upright, sideways yaw, partial tilt, entry and hysteresis', () => {
  for (const metrics of [{ imageTiltDegrees: 0, depthTiltDegrees: 9, palmFacingCameraPercent: 93 },
    { imageTiltDegrees: 0, depthTiltDegrees: 0, palmFacingCameraPercent: 0 }]) {
    assert.equal(classifyScrollPose(metrics, DEFAULT_SCROLL_POSE), 'POINTER')
  }
  assert.equal(classifyScrollPose({ imageTiltDegrees: 15, depthTiltDegrees: 31, palmFacingCameraPercent: 84 }, DEFAULT_SCROLL_POSE), 'RETAIN')
  assert.equal(classifyScrollPose({ imageTiltDegrees: 15, depthTiltDegrees: 50, palmFacingCameraPercent: 62 }, DEFAULT_SCROLL_POSE), 'ENTER')
  assert.equal(classifyScrollPose(null, DEFAULT_SCROLL_POSE), 'UNKNOWN')
})

test('flat calibration uses a fresh stable same-hand sample window and rejects upright or noisy data', () => {
  const samples = Array.from({ length: 9 }, (_, i) => ({ timestampMs: i * 50, handId: 1, pose: 'OPEN' as const,
    metrics: { imageTiltDegrees: 10, depthTiltDegrees: 34 + i % 2, palmFacingCameraPercent: 80 + i % 2 } }))
  const profile = calibrateFlatPose(samples, 400)
  assert.equal(classifyScrollPose(samples[0].metrics, profile), 'ENTER')
  assert.equal(classifyScrollPose({ imageTiltDegrees: 0, depthTiltDegrees: 9, palmFacingCameraPercent: 93 }, profile), 'POINTER')
  for (const invalid of [samples.slice(0, 2), samples.map(s => ({ ...s, handId: s.timestampMs < 200 ? 1 : 2 })),
    samples.map(s => ({ ...s, metrics: { ...s.metrics, depthTiltDegrees: 10 } })),
    samples.map(s => ({ ...s, metrics: { ...s.metrics, depthTiltDegrees: s.timestampMs < 200 ? 30 : 60 } }))]) {
    assert.throws(() => calibrateFlatPose(invalid, 400), RangeError)
  }
  assert.throws(() => calibrateFlatPose(samples, 601), RangeError)
  assert.equal(classifyScrollPose({ imageTiltDegrees: 0, depthTiltDegrees: 20, palmFacingCameraPercent: 94 }, profile), 'POINTER',
    'personal flat calibration must never swallow clearly upright aiming')
})

test('flat entry needs distinct observations, confirmation and settled height before neutral capture', () => {
  const session = new PageScrollSession()
  assert.equal(session.observe(hand(0), true, true, 0).state, 'ENTRY')
  assert.equal(session.tick(190).neutralY, null, 'render ticks never supply gesture evidence')
  session.observe(hand(100), true, true, 100)
  session.observe(hand(200), true, true, 200)
  assert.equal(session.tick(210).state, 'ENTRY')
  for (let t = 250; t <= 450; t += 50) session.observe(hand(t), true, true, t)
  const result = session.tick(450)
  assert.equal(result.state, 'ACTIVE'); assert.equal(result.neutralY, .5); assert.equal(result.velocity, 0)
})

test('intermediate orientation alone never enters scroll and moving entry does not capture neutral', () => {
  const partial = new PageScrollSession()
  for (let t = 0; t <= 700; t += 50) {
    assert.notEqual(partial.observe(hand(t), false, true, t).state, 'ACTIVE')
    assert.equal(partial.tick(t).deltaY, 0)
  }
  const moving = new PageScrollSession()
  for (let t = 0; t <= 700; t += 50) moving.observe(hand(t, t % 100 ? .4 : .6), true, true, t)
  assert.equal(moving.tick(700).neutralY, null)
})

test('neutral is motionless, signed displacement ramps monotonically to a bounded speed and never drifts', () => {
  const session = active()
  for (const [i, y] of [.5, .51, .49].entries()) assert.equal(session.observe(hand(550 + i * 50, y), true, true, 550 + i * 50).velocity, 0)
  const ramp = active()
  let previous = 0
  for (const [i, y] of [.54, .58, .64, .8].entries()) {
    const value = ramp.observe(hand(550 + i * 50, y), true, true, 550 + i * 50)
    assert.ok(value.velocity > 0 && value.velocity >= previous && value.velocity <= 600)
    assert.equal(value.neutralY, .5); previous = value.velocity
  }
  assert.equal(ramp.observe(hand(750), true, true, 750).velocity, 0, 'no momentum at neutral')
  assert.ok(ramp.observe(hand(800, .3), true, true, 800).velocity < 0)
  assert.ok(ramp.observe(hand(850, .7), true, true, 850).velocity > 0, 'controlled sign reversal')
})

test('retention band can continue confirmed scrolling but cannot establish its own new neutral', () => {
  const session = active()
  const moved = session.observe(hand(550, .65), false, true, 550)
  assert.equal(moved.state, 'ACTIVE'); assert.ok(moved.velocity > 0); assert.equal(moved.neutralY, .5)
})

test('fist, unknown, loss of pose, changed identity, stale and repeated timestamps stop without replay', () => {
  for (const [h, receipt, retain] of [
    [hand(550, .7, { pose: 'FIST' }), 550, true], [hand(550, .7, { pose: 'UNKNOWN' }), 550, true],
    [hand(550, .7, { id: 2 }), 550, true], [hand(550, .7), 751, true],
    [hand(500, .7), 550, true], [hand(550, .7), 550, false],
  ] as const) {
    const session = active()
    assert.equal(session.observe(h, true, retain, receipt).velocity, 0)
    assert.equal(session.tick(receipt + 10).deltaY, 0)
  }
})

test('scroll distance uses elapsed time, caps large display gaps and stops at capture expiry', () => {
  const session = active()
  session.observe(hand(550, .8), true, true, 550)
  const a = session.tick(566), b = session.tick(582)
  assert.ok(a.deltaY > 0); assert.ok(Math.abs(b.deltaY - 9.6) < 1e-8)
  assert.ok(session.tick(700).deltaY <= 30, '50 ms max integration at 600 px/s')
  assert.equal(session.tick(751).deltaY, 0)
  assert.equal(session.tick(767).deltaY, 0)
})
