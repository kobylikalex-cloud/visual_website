import test from 'node:test'
import assert from 'node:assert/strict'
import { PageGestureEngine, type PageGestureSnapshot } from '../src/control/PageGestureEngine.ts'
import type { InteractionFrame, TrackedHand } from '../src/control/types.ts'

const target = { id: 'action', kind: 'click' as const, activationToken: 1, rect: { left: 450, top: 350, width: 100, height: 100 } }
const frame = (time: number, pose: TrackedHand['pose'] = 'OPEN', extra: Partial<InteractionFrame> = {}): InteractionFrame => ({
  timestampMs: time, hands: [{ id: 1, timestampMs: time, center: { x: .5, y: .5 }, pose, orientation: 'UPRIGHT_LIKE',
    orientationMetrics: { imageTiltDegrees: 0, depthTiltDegrees: 9, palmFacingCameraPercent: 93 } }],
  ambiguous: false, reason: 'valid palm', targets: [target], viewport: { width: 1000, height: 800 }, ...extra,
})
const focused = () => {
  const engine = new PageGestureEngine()
  for (let t = 0; t <= 300; t += 50) engine.update(frame(t), t)
  assert.equal(engine.clickDiagnostics.state, 'TARGET_FOCUSED')
  return engine
}
function inactive(snapshot: PageGestureSnapshot) {
  assert.equal(snapshot.interactionState, 'INACTIVE')
  assert.equal(snapshot.mode, 'IDLE')
  assert.equal(snapshot.activation, null)
  assert.equal(snapshot.pointer, null)
  assert.equal(snapshot.focusId, null)
  assert.equal(snapshot.clickId, null)
  assert.equal(snapshot.targetLocked, false)
  assert.equal(snapshot.confirmationProgress, 0)
  assert.equal(snapshot.scrollVelocity, 0)
  assert.equal(snapshot.scrollDeltaY, 0)
  assert.deepEqual(snapshot.proximity, {})
}

test('cancelled closure remains inactive across display ticks and repeated missing-hand observations', () => {
  for (const stop of ['explicit', 'missing', 'ambiguous', 'invalid', 'expired'] as const) {
    const engine = focused()
    assert.equal(engine.update(frame(350, 'FIST'), 350).targetLocked, true)
    const stopped = stop === 'explicit' ? engine.cancel('Camera stopped')
      : stop === 'expired' ? engine.tick(551)
      : engine.update(frame(400, 'FIST', stop === 'missing' ? { hands: [] }
        : stop === 'ambiguous' ? { ambiguous: true } : { viewport: { width: 0, height: 800 } }), 400)
    inactive(stopped)
    assert.equal(stopped.clickState, 'WAIT_FOR_RELEASE')
    const transitions = engine.scrollDiagnostics.transitionCount
    for (const t of [552, 568, 600, 1000]) {
      inactive(engine.tick(t))
      inactive(engine.update(frame(t + 1, 'FIST', { hands: [] }), t + 1))
      inactive(engine.tick(t + 2))
    }
    assert.equal(engine.scrollDiagnostics.transitionCount, transitions, stop)
  }
})

test('click cancellation inside target validation stays inactive until another observation', () => {
  const engine = focused()
  engine.update(frame(350, 'FIST'), 350)
  inactive(engine.tick(366, []))
  const transitions = engine.scrollDiagnostics.transitionCount
  for (const t of [382, 398, 414]) inactive(engine.tick(t))
  assert.equal(engine.scrollDiagnostics.transitionCount, transitions)
  assert.equal(engine.clickDiagnostics.state, 'WAIT_FOR_RELEASE')
})

test('cancel after activation keeps release lockout without restoring inactive feedback', () => {
  const engine = focused()
  for (let t = 350; t < 550; t += 50) engine.update(frame(t, 'FIST'), t)
  assert.equal(engine.update(frame(550, 'FIST'), 550).activation?.id, 'action')
  inactive(engine.cancel('Camera stopped'))
  inactive(engine.tick(566))
  for (let t = 600; t <= 900; t += 50) {
    const held = engine.update(frame(t, 'FIST'), t)
    assert.equal(held.activation, null)
    assert.equal(held.targetLocked, false)
    assert.equal(held.focusId, null)
    assert.equal(held.clickState, 'WAIT_FOR_RELEASE')
  }
  for (let t = 950; t <= 1250; t += 50) engine.update(frame(t), t)
  assert.equal(engine.clickDiagnostics.state, 'TARGET_FOCUSED')
  for (let t = 1300; t < 1500; t += 50) assert.equal(engine.update(frame(t, 'FIST'), t).activation, null)
  assert.equal(engine.update(frame(1500, 'FIST'), 1500).activation?.id, 'action')
})

test('cancellation preserves observation high-water mark and fresh restart reconfirms open hand', () => {
  const engine = focused()
  inactive(engine.cancel('Camera stopped'))
  for (const t of [250, 300]) {
    inactive(engine.update(frame(t), 350))
    inactive(engine.tick(351))
  }
  assert.equal(engine.update(frame(400), 400).pointer, null)
  assert.equal(engine.update(frame(450), 450).pointer, null)
  assert.equal(engine.update(frame(500), 500).pointer, null)
  assert.notEqual(engine.update(frame(550), 550).pointer, null)
})
