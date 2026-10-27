import test from 'node:test'
import assert from 'node:assert/strict'
import { PageGestureEngine } from '../src/control/PageGestureEngine.ts'
import { FistClickEngine } from '../src/control/FistClickEngine.ts'
import { HandTracker } from '../src/control/HandTracker.ts'
import { controlHand } from './fixtures/controlHand.ts'
import type { InteractionFrame, TrackedHand } from '../src/control/types.ts'

const target = { id: 'test-0', kind: 'click' as const, activationToken: 1, rect: { left: 450, top: 350, width: 100, height: 100 } }
const hand = (t: number, flat = false, y = .5, extra: Partial<TrackedHand> = {}): TrackedHand => ({
  id: 1, timestampMs: t, center: { x: .5, y }, pose: 'OPEN', orientation: flat ? 'FLAT_LIKE' : 'UPRIGHT_LIKE',
  orientationMetrics: { imageTiltDegrees: 0, depthTiltDegrees: flat ? 50 : 9, palmFacingCameraPercent: flat ? 62 : 93 }, ...extra,
})
const frame = (t: number, flat = false, y = .5, extra: Partial<InteractionFrame> = {}): InteractionFrame => ({
  timestampMs: t, hands: [hand(t, flat, y)], ambiguous: false, reason: 'valid geometry', targets: [target], viewport: { width: 1000, height: 800 }, ...extra,
})
function scroll() {
  const engine = new PageGestureEngine()
  for (let t = 0; t <= 500; t += 50) engine.update(frame(t, true), t)
  assert.equal(engine.tick(500).interactionState, 'SCROLL_ACTIVE')
  return engine
}

test('pointer and one-shot fist activation match the protected engine outside scroll intent', () => {
  const page = new PageGestureEngine(), reference = new FistClickEngine()
  let clicks = 0
  for (let t = 0; t <= 1300; t += 50) {
    const f = frame(t, false, .5, { hands: [hand(t, false, .5, { pose: t < 450 || t > 1000 ? 'OPEN' : 'FIST' })] })
    const result = page.update(f, t), expected = reference.update(f, t)
    assert.deepEqual(result.pointer, expected.pointer); assert.equal(result.focusId, expected.focusId)
    assert.deepEqual(result.activation, expected.activation); assert.equal(result.scrollVelocity, 0)
    if (result.activation) clicks++
    assert.equal(page.tick(t + 16).scrollDeltaY, 0)
    reference.tick(t + 16)
  }
  assert.equal(clicks, 1)
})

test('partial rotation never scrolls, cancels old focus and cannot become a rotation-induced click', () => {
  const engine = new PageGestureEngine()
  for (let t = 0; t <= 400; t += 50) engine.update(frame(t), t)
  for (let t = 450; t <= 750; t += 50) {
    const r = engine.update(frame(t, false, .5, { hands: [hand(t, false, .5, { orientationMetrics: { imageTiltDegrees: 0, depthTiltDegrees: 31, palmFacingCameraPercent: 84 } })] }), t)
    assert.equal(r.focusId, null); assert.equal(r.activation, null); assert.equal(r.scrollVelocity, 0)
  }
  for (let t = 800; t <= 1200; t += 50) assert.equal(engine.update(frame(t, true, .5, { hands: [hand(t, true, .5, { pose: 'FIST' })] }), t).activation, null)
})

test('scroll entry discards old target, neutral then signed motion produces only page scroll effects', () => {
  const engine = scroll()
  const r = engine.update(frame(550, true, .7), 550)
  assert.equal(r.pointer, null); assert.equal(r.focusId, null); assert.equal(r.activation, null); assert.ok(r.scrollVelocity > 0)
  assert.ok(engine.tick(566).scrollDeltaY > 0)
  engine.update(frame(600, true, .3), 600)
  assert.ok(engine.tick(616).scrollDeltaY < 0)
  engine.update(frame(650, true), 650)
  assert.equal(engine.tick(666).scrollDeltaY, 0)
})

test('fist during scroll cannot click and upright return must reconfirm before pointing', () => {
  const engine = scroll()
  for (let t = 550; t <= 800; t += 50) assert.equal(engine.update(frame(t, true, .5, { hands: [hand(t, true, .5, { pose: 'FIST' })] }), t).activation, null)
  assert.equal(engine.update(frame(850), 850).pointer, null)
  engine.update(frame(900), 900); engine.update(frame(950), 950)
  assert.notEqual(engine.update(frame(1000), 1000).pointer, null)
  assert.equal(engine.tick(1016).scrollDeltaY, 0)
})

test('hand loss, two hands, ambiguity, UNKNOWN, identity, staleness and viewport changes cancel scrolling', () => {
  for (const [extra, receipt] of [
    [{ hands: [] }, 550], [{ hands: [hand(550, true), hand(550, true, .5, { id: 2 })] }, 550],
    [{ ambiguous: true }, 550], [{ hands: [hand(550, true, .7, { pose: 'UNKNOWN' })] }, 550],
    [{ hands: [hand(550, true, .7, { id: 2 })] }, 550], [{}, 751],
    [{ viewport: { width: 900, height: 800 } }, 550],
  ] as [Partial<InteractionFrame>, number][]) {
    const engine = scroll()
    const result = engine.update(frame(550, true, .7, extra), receipt)
    assert.equal(result.activation, null); assert.equal(result.scrollVelocity, 0)
    assert.equal(engine.tick(receipt + 16).scrollDeltaY, 0)
  }
  const engine = scroll()
  engine.update(frame(550, true, .7), 550)
  assert.equal(engine.tick(751).scrollDeltaY, 0)
  assert.equal(engine.cancel('blur').scrollDeltaY, 0)
})

test('hand recovery captures a new neutral rather than restoring old scroll velocity', () => {
  const engine = scroll()
  engine.update(frame(550, true, .7), 550)
  engine.update(frame(600, true, .7, { hands: [] }), 600)
  for (let t = 650; t <= 1150; t += 50) {
    const r = engine.update(frame(t, true, .7), t)
    assert.equal(r.scrollVelocity, 0); assert.equal(r.activation, null)
  }
  assert.ok(Math.abs(engine.scrollDiagnostics.neutralY! - .7) < 1e-8)
})

test('brief UNKNOWN pauses all effects but preserves confirmed neutral until the original freshness deadline', () => {
  const engine = scroll()
  engine.update(frame(550, true, .65), 550)
  assert.ok(engine.tick(566).scrollDeltaY > 0)
  const uncertain = engine.update(frame(600, true, .65, { hands: [hand(600, true, .65, { pose: 'UNKNOWN' })] }), 600)
  assert.equal(uncertain.scrollVelocity, 0); assert.equal(uncertain.activation, null); assert.equal(uncertain.pointer, null)
  assert.equal(engine.tick(616).scrollDeltaY, 0)
  assert.equal(engine.scrollDiagnostics.neutralY, .5, 'one uncertain observation must not recenter the hand')
  const resumed = engine.update(frame(650, true, .65), 650)
  assert.equal(resumed.interactionState, 'SCROLL_ACTIVE'); assert.ok(resumed.scrollVelocity > 0)
  assert.equal(engine.scrollDiagnostics.neutralY, .5)
  assert.equal(engine.tick(650).scrollDeltaY, 0, 'paused time is never replayed')
  assert.ok(engine.tick(666).scrollDeltaY > 0)

  for (let t = 700; t <= 900; t += 50) {
    engine.update(frame(t, true, .65, { hands: [hand(t, true, .65, { pose: 'UNKNOWN' })] }), t)
    assert.equal(engine.tick(t).scrollDeltaY, 0)
  }
  assert.equal(engine.scrollDiagnostics.neutralY, null, 'UNKNOWN cannot extend the last confirmed OPEN deadline')
  assert.equal(engine.update(frame(950, true, .65), 950).scrollVelocity, 0)
})

test('one orientation outlier pauses without recentering; sustained upright pose leaves scroll mode', () => {
  const engine = scroll()
  engine.update(frame(550, true, .65), 550)
  const spike = engine.update(frame(600, false, .65), 600)
  assert.equal(spike.scrollVelocity, 0); assert.equal(spike.pointer, null); assert.equal(spike.activation, null)
  assert.equal(engine.tick(616).scrollDeltaY, 0)
  assert.equal(engine.scrollDiagnostics.neutralY, .5)
  assert.equal(engine.update(frame(650, true, .65), 650).interactionState, 'SCROLL_ACTIVE')
  assert.equal(engine.scrollDiagnostics.neutralY, .5)
  assert.equal(engine.tick(650).scrollDeltaY, 0)
  for (let t = 700; t < 850; t += 50) {
    const r = engine.update(frame(t), t)
    assert.equal(r.pointer, null); assert.equal(r.scrollVelocity, 0)
    assert.equal(engine.tick(t + 16).scrollDeltaY, 0)
  }
  const returned = engine.update(frame(850), 850)
  assert.equal(returned.scrollVelocity, 0)
  assert.equal(engine.scrollDiagnostics.neutralY, null)
  for (let t = 900; t <= 1000; t += 50) engine.update(frame(t), t)
  assert.notEqual(engine.tick(1000).pointer, null)
})

test('short UNKNOWN gaps do not discard fresh OPEN entry evidence or count as confirmations', () => {
  const engine = new PageGestureEngine()
  for (let t = 0; t <= 450; t += 50) {
    const unknown = t === 100 || t === 300
    const r = engine.update(frame(t, true, .5, { hands: [hand(t, true, .5, { pose: unknown ? 'UNKNOWN' : 'OPEN' })] }), t)
    assert.equal(r.activation, null); assert.equal(r.scrollVelocity, 0)
    assert.equal(engine.tick(t + 16).scrollDeltaY, 0)
    if (unknown) assert.notEqual(r.interactionState, 'SCROLL_ACTIVE')
  }
  assert.equal(engine.scrollDiagnostics.state, 'ACTIVE')
  assert.equal(engine.scrollDiagnostics.neutralY, .5)

  const unconfirmed = new PageGestureEngine()
  unconfirmed.update(frame(0, true), 0)
  for (let t = 50; t <= 500; t += 50) {
    unconfirmed.update(frame(t, true, .5, { hands: [hand(t, true, .5, { pose: 'UNKNOWN' })] }), t)
    assert.equal(unconfirmed.tick(t).scrollDeltaY, 0)
    assert.equal(unconfirmed.scrollDiagnostics.neutralY, null)
  }
})

test('paused scroll intent is fully discarded for fist, loss, ambiguity, replacement or invalid orientation', () => {
  for (const extra of [
    { hands: [hand(650, true, .65, { pose: 'FIST' })] }, { hands: [] }, { ambiguous: true },
    { hands: [hand(650, true, .65, { id: 2 })] },
    { hands: [hand(650, true, .65, { orientationMetrics: null })] },
    { hands: [hand(650, true), hand(650, true, .5, { id: 2 })] },
  ] as Partial<InteractionFrame>[]) {
    const engine = scroll()
    engine.update(frame(550, true, .65), 550)
    engine.update(frame(600, true, .65, { hands: [hand(600, true, .65, { pose: 'UNKNOWN' })] }), 600)
    assert.equal(engine.scrollDiagnostics.neutralY, .5)
    const stopped = engine.update(frame(650, true, .65, extra), 650)
    assert.equal(stopped.scrollVelocity, 0); assert.equal(stopped.activation, null)
    assert.equal(engine.scrollDiagnostics.neutralY, null)
    assert.equal(engine.tick(666).scrollDeltaY, 0)
    assert.equal(engine.update(frame(700, true, .65), 700).scrollVelocity, 0)
  }
})

test('delayed observations pause immediately and RETAIN cannot revive neutral after OPEN expiry', () => {
  for (const kind of ['UNKNOWN', 'upright'] as const) {
    const engine = new PageGestureEngine()
    for (let t = 0; t <= 500; t += 50) { engine.update(frame(t, true), t + 55); engine.tick(t + 61) }
    engine.update(frame(550, true, .65), 605)
    const outlier = (t: number) => kind === 'UNKNOWN'
      ? frame(t, true, .65, { hands: [hand(t, true, .65, { pose: 'UNKNOWN' })] }) : frame(t, false, .65)
    const retained = (t: number) => frame(t, true, .65, { hands: [hand(t, true, .65, {
      orientationMetrics: { imageTiltDegrees: 0, depthTiltDegrees: 31, palmFacingCameraPercent: 84 },
    })] })
    engine.update(outlier(600), 655)
    assert.equal(engine.tick(671).scrollDeltaY, 0)
    assert.equal(engine.scrollDiagnostics.neutralY, .5)
    assert.equal(engine.update(retained(650), 705).interactionState, 'SCROLL_ACTIVE')
    assert.equal(engine.tick(705).scrollDeltaY, 0)
    assert.ok(engine.tick(721).scrollDeltaY > 0)
    engine.update(outlier(700), 755)
    assert.equal(engine.tick(849).scrollDeltaY, 0)
    assert.equal(engine.tick(851).scrollDeltaY, 0)
    assert.equal(engine.scrollDiagnostics.neutralY, null)
    const recovered = engine.update(retained(800), 855)
    assert.equal(recovered.scrollVelocity, 0); assert.equal(recovered.activation, null)
    assert.equal(engine.scrollDiagnostics.neutralY, null, 'expired RETAIN needs a new complete flat entry')
  }
})

test('raw landmark pipeline switches pointer, flat scrolling, neutral, release and a new fist click exclusively', () => {
  const tracker = new HandTracker(), engine = new PageGestureEngine()
  let clicks = 0
  for (let t = 0; t <= 2300; t += 50) {
    const flat = t >= 450 && t < 1450
    const angle = (flat ? t < 500 || t >= 1000 && t < 1150 ? 31 : 50 : 0) * Math.PI / 180
    const pose = t >= 1200 && t < 1450 || t >= 1850 && t <= 2050 ? 'FIST' : 'OPEN'
    const d = controlHand(pose)
    d.worldLandmarks = d.worldLandmarks.map(p => ({ x: p.x, y: p.y * Math.cos(angle) - p.z * Math.sin(angle), z: p.y * Math.sin(angle) + p.z * Math.cos(angle) }))
    const cy = [0, 5, 9, 13, 17].reduce((sum, i) => sum + d.worldLandmarks[i].y, 0) / 5
    const y = t >= 1000 && t < 1150 ? .65 : .5
    d.landmarks = d.worldLandmarks.map(p => ({ x: .5 + p.x, y: y + p.y - cy, z: p.z }))
    const tracking = tracker.update({ timestampMs: t, detections: [d] })
    const r = engine.update({ ...tracking, timestampMs: t, targets: [target], viewport: { width: 1000, height: 800 } }, t + 45)
    if (t === 400) assert.equal(r.focusId, 'test-0')
    if (t === 450) assert.equal(r.scrollVelocity, 0)
    if (t === 950) assert.equal(r.interactionState, 'SCROLL_ACTIVE')
    if (t >= 1000 && t < 1150) assert.ok(r.scrollVelocity > 0, 'arm movement inside retention envelope continues scrolling')
    if (t === 1150) assert.equal(r.scrollVelocity, 0)
    if (t < 1850) assert.equal(r.activation, null)
    if (r.activation) { clicks++; assert.equal(r.scrollVelocity, 0) }
    const tick = engine.tick(t + 61)
    if (tick.scrollDeltaY !== 0) assert.equal(tick.activation, null)
  }
  assert.equal(clicks, 1)
})
