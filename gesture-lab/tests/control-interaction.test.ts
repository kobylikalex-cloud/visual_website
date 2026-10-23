import test from 'node:test'
import assert from 'node:assert/strict'
import { InteractionEngine } from '../src/control/InteractionEngine.ts'
import { PointerController } from '../src/control/PointerController.ts'
import { TargetSelector } from '../src/control/TargetSelector.ts'
import { DEFAULT_GESTURE_CONFIG as defaults } from '../src/control/GestureConfig.ts'
import type { InteractionFrame, InteractionTarget, TrackedHand } from '../src/control/types.ts'

const button: InteractionTarget = { id: 'button', kind: 'click', rect: { left: 450, top: 350, width: 100, height: 100 } }
const card: InteractionTarget = { ...button, id: 'card', kind: 'drag' }
const hand = (timestampMs: number, pose: TrackedHand['pose'] = 'OPEN', orientation: TrackedHand['orientation'] = 'UPRIGHT_LIKE', x = .5, y = .5, id = 1): TrackedHand => ({ id, center: { x, y }, pose, orientation, timestampMs })
const frame = (timestampMs: number, hands = [hand(timestampMs)], targets = [button]): InteractionFrame => ({ timestampMs, hands, targets, viewport: { width: 1000, height: 800 }, ambiguous: false, reason: 'valid' })
function open(engine: InteractionEngine, targets = [button]) {
  for (const t of [0, 50, 100, 150, 200, 250, 300]) engine.update(frame(t, [hand(t)], targets))
}
function close(engine: InteractionEngine, targets = [button]) {
  let result = engine.update(frame(350, [hand(350, 'FIST')], targets))
  for (const t of [400, 450, 500, 550]) result = engine.update(frame(t, [hand(t, 'FIST')], targets))
  return result
}

test('upright open requires continuous confirmation and stable focus before a deliberate one-shot click', () => {
  const engine = new InteractionEngine()
  assert.equal(engine.update(frame(0)).mode, 'UNCERTAIN')
  assert.equal(engine.update(frame(100)).mode, 'UNCERTAIN')
  assert.equal(engine.update(frame(150)).mode, 'POINTER')
  engine.update(frame(200)); engine.update(frame(250)); engine.update(frame(300))
  assert.equal(engine.update(frame(350, [hand(350, 'FIST')])).mode, 'GRASP_PENDING')
  assert.equal(engine.update(frame(450, [hand(450, 'FIST')])).clickId, null)
  assert.equal(engine.update(frame(550, [hand(550, 'FIST')])).clickId, 'button')
  assert.equal(engine.tick(560).clickId, null)
  assert.equal(engine.update(frame(600, [hand(600, 'FIST')])).clickId, null)
  assert.equal(engine.update(frame(650, [hand(650, 'FIST')])).clickId, null)
})

test('a single uncertain frame pauses effects without destroying locked pointer focus', () => {
  const engine = new InteractionEngine()
  open(engine)
  const uncertain = engine.update(frame(350, [hand(350, 'UNKNOWN')]))
  assert.equal(uncertain.clickId, null)
  assert.equal(uncertain.scrollVelocity, 0)
  assert.equal(uncertain.focusId, 'button')
  const recovered = engine.update(frame(400, [hand(400)]))
  assert.equal(recovered.focusId, 'button')
  assert.equal(recovered.clickId, null)
  // A new complete OPEN confirmation must precede any gesture action.
  const premature = engine.update(frame(450, [hand(450, 'FIST')]))
  assert.equal(premature.clickId, null)
  assert.notEqual(premature.mode, 'GRABBING')
})

test('brief orientation uncertainty preserves visual focus but never arms an action', () => {
  const engine = new InteractionEngine()
  open(engine)
  const paused = engine.update(frame(350, [hand(350, 'OPEN', 'TRANSITION')]))
  assert.equal(paused.mode, 'UNCERTAIN')
  assert.equal(paused.focusId, 'button')
  assert.equal(paused.pointer, null)
  for (const t of [400, 450, 500]) {
    const snapshot = engine.update(frame(t, [hand(t)]))
    assert.equal(snapshot.clickId, null)
  }
  assert.equal(engine.update(frame(550, [hand(550)])).mode, 'POINTER')
  assert.equal(engine.update(frame(600, [hand(600, 'OPEN', 'TRANSITION')])).scrollVelocity, 0)
  // Prolonged uncertainty expires safely.
  assert.equal(engine.update(frame(800, [hand(800, 'OPEN', 'TRANSITION')])).focusId, null)
})

test('starting closed, unknown pose, transition orientation, and interrupted open never authorize clicks', () => {
  const engine = new InteractionEngine()
  for (const t of [0, 100, 200, 300]) assert.equal(engine.update(frame(t, [hand(t, 'FIST')])).clickId, null)
  engine.reset()
  engine.update(frame(0)); engine.update(frame(100))
  engine.update(frame(150, [hand(150, 'UNKNOWN')]))
  assert.equal(engine.update(frame(200)).mode, 'UNCERTAIN')
  engine.reset(); open(engine)
  assert.equal(engine.update(frame(350, [hand(350, 'OPEN', 'TRANSITION')])).pointer, null)
  for (const t of [400, 500, 600]) assert.equal(engine.update(frame(t, [hand(t, 'FIST')])).clickId, null)
})

test('watchdog, backwards time, malformed hands, ambiguity, and missing identity immediately discard armed intent', () => {
  const mutations: Array<(f: InteractionFrame) => InteractionFrame> = [
    f => ({ ...f, timestampMs: 299 }),
    f => ({ ...f, ambiguous: true }),
    f => ({ ...f, hands: [] }),
    f => ({ ...f, hands: [hand(350, 'FIST', 'UPRIGHT_LIKE', .5, .5, 2)] }),
    f => ({ ...f, hands: [hand(0)] }),
    f => ({ ...f, hands: [hand(350, 'OPEN', 'UPRIGHT_LIKE', NaN)] }),
    f => ({ ...f, viewport: { width: 0, height: 800 } }),
    f => ({ ...f, hands: [hand(350), hand(350)] }),
  ]
  for (const mutate of mutations) {
    const engine = new InteractionEngine(); open(engine)
    const stopped = engine.update(mutate(frame(350)))
    assert.equal(stopped.pointer, null); assert.equal(stopped.scrollVelocity, 0); assert.equal(stopped.drag, null)
    for (const t of [400, 500, 600, 700]) assert.equal(engine.update(frame(t, [hand(t, 'FIST')])).clickId, null)
  }
  const engine = new InteractionEngine(); open(engine)
  assert.equal(engine.tick(501).pointer, null)
  assert.equal(engine.update(frame(550, [hand(550, 'FIST')])).clickId, null)
})

test('watchdog expires the source hand timestamp even when the enclosing frame is newer', () => {
  const engine = new InteractionEngine(); open(engine)
  engine.update(frame(350, [hand(325)]))
  assert.equal(engine.tick(526).pointer, null)
  assert.equal(engine.tick(527).scrollVelocity, 0)
})

test('a new-frame gap also cancels intent before a closed hand can resume', () => {
  const engine = new InteractionEngine(); open(engine)
  for (const t of [550, 650, 750, 850]) assert.equal(engine.update(frame(t, [hand(t, 'FIST')])).clickId, null)
})

test('pending focus stays frozen and removed, disabled, or moving click targets cancel the grasp', () => {
  for (const replacement of [[], [{ ...button, disabled: true }]]) {
    const engine = new InteractionEngine(); open(engine)
    engine.update(frame(350, [hand(350, 'FIST')]))
    for (const t of [400, 450, 500, 550]) assert.equal(engine.update(frame(t, [hand(t, 'FIST')], replacement)).clickId, null)
  }
  const engine = new InteractionEngine(); open(engine)
  engine.update(frame(350, [hand(350, 'FIST')]))
  for (const t of [400, 450, 500, 550]) {
    const moved = engine.update(frame(t, [hand(t, 'FIST', 'UPRIGHT_LIKE', .8)]))
    assert.equal(moved.clickId, null)
  }
})

test('target acquisition needs its lock duration and does not retarget during a pending grasp', () => {
  const engine = new InteractionEngine()
  for (const t of [0, 50, 100, 150]) engine.update(frame(t))
  assert.notEqual(engine.update(frame(200, [hand(200, 'FIST')])).mode, 'GRASP_PENDING')
  engine.reset(); open(engine)
  engine.update(frame(350, [hand(350, 'FIST')]))
  const closer: InteractionTarget = { ...button, id: 'closer' }
  assert.equal(engine.update(frame(400, [hand(400, 'FIST')], [button, closer])).focusId, 'button')
})

test('a large initial close motion cannot click the old open-hand target', () => {
  const engine = new InteractionEngine(); open(engine)
  for (const t of [350, 400, 450, 500, 550]) {
    const result = engine.update(frame(t, [hand(t, 'FIST', 'UPRIGHT_LIKE', .38)]))
    assert.equal(result.clickId, null)
    assert.notEqual(result.mode, 'GRASP_PENDING')
  }
})

test('a click target leaving the locked hand vicinity cancels pending intent', () => {
  const engine = new InteractionEngine(); open(engine)
  engine.update(frame(350, [hand(350, 'FIST')]))
  const shifted = { ...button, rect: { ...button.rect, left: 750 } }
  for (const t of [400, 450, 500, 550]) {
    const result = engine.update(frame(t, [hand(t, 'FIST')], [shifted]))
    assert.equal(result.clickId, null)
    assert.notEqual(result.mode, 'GRASP_PENDING')
  }
})

test('a completed click can rearm only after another confirmed open and focus dwell', () => {
  const engine = new InteractionEngine(); open(engine)
  assert.equal(close(engine).clickId, 'button')
  for (const t of [600, 650, 700, 750, 800, 850, 900]) engine.update(frame(t))
  for (const t of [950, 1000, 1050, 1100]) assert.equal(engine.update(frame(t, [hand(t, 'FIST')])).clickId, null)
  assert.equal(engine.update(frame(1150, [hand(1150, 'FIST')])).clickId, 'button')
})

test('layout resizing cancels a drag instead of producing a viewport-size delta', () => {
  const engine = new InteractionEngine(); open(engine, [card]); close(engine, [card])
  const resized = engine.update({ ...frame(600, [hand(600, 'FIST')], [card]), viewport: { width: 2000, height: 800 } })
  assert.equal(resized.drag, null)
  assert.notEqual(resized.mode, 'GRABBING')
})

test('drag emits incremental viewport deltas only on new frames, releases open, and never clicks', () => {
  const engine = new InteractionEngine(); open(engine, [card])
  const grabbed = close(engine, [card]); assert.equal(grabbed.mode, 'GRABBING'); assert.equal(grabbed.clickId, null)
  const moved = engine.update(frame(600, [hand(600, 'FIST', 'UPRIGHT_LIKE', .45)], [card]))
  assert.equal(moved.drag?.id, 'card'); assert.ok(moved.drag!.deltaX > 0); assert.equal(moved.drag!.deltaY, 0)
  assert.equal(engine.tick(610).drag, null)
  const next = engine.update(frame(650, [hand(650, 'FIST', 'UPRIGHT_LIKE', .45)], [card]))
  assert.ok(next.drag!.deltaX > 0); assert.ok(next.drag!.deltaX < moved.drag!.deltaX)
  assert.equal(engine.update(frame(700, [hand(700)], [card])).drag, null)
  assert.equal(engine.update(frame(750, [hand(750, 'FIST')], [card])).mode, 'UNCERTAIN')
})

test('drag cancels on a second hand or identity loss and cannot regrab until reopened', () => {
  const engine = new InteractionEngine(); open(engine, [card]); close(engine, [card])
  assert.equal(engine.update(frame(600, [hand(600, 'FIST'), hand(600, 'OPEN', 'FLAT_LIKE', .7, .5, 2)], [card])).drag, null)
  for (const t of [650, 750, 850]) assert.notEqual(engine.update(frame(t, [hand(t, 'FIST')], [card])).mode, 'GRABBING')
})

test('single flat hand confirms independently, captures entry neutral and scrolls with signed bounded ramp', () => {
  const engine = new InteractionEngine()
  for (const t of [0, 60, 120]) assert.equal(engine.update(frame(t, [hand(t, 'OPEN', 'FLAT_LIKE')])).scrollVelocity, 0)
  assert.equal(engine.update(frame(180, [hand(180, 'OPEN', 'FLAT_LIKE')])).mode, 'SCROLL')
  assert.equal(engine.update(frame(230, [hand(230, 'OPEN', 'FLAT_LIKE', .5, .52)])).scrollVelocity, 0)
  assert.ok(engine.update(frame(280, [hand(280, 'OPEN', 'FLAT_LIKE', .5, .65)])).scrollVelocity > 0)
  const up = engine.update(frame(330, [hand(330, 'OPEN', 'FLAT_LIKE', .5, .1)])); assert.ok(up.scrollVelocity < 0); assert.ok(up.scrollVelocity >= -defaults.maxScrollSpeed)
  assert.equal(engine.update(frame(380, [hand(380, 'OPEN', 'TRANSITION')])).scrollVelocity, 0)
  assert.equal(engine.update(frame(430, [hand(430, 'OPEN', 'FLAT_LIKE', .5, .1)])).scrollVelocity, 0)
})

test('conservative scroll defaults ignore neutral jitter and stop instantly when returning', () => {
  const engine = new InteractionEngine()
  for (const t of [0, 60, 120, 180]) engine.update(frame(t, [hand(t, 'OPEN', 'FLAT_LIKE')]))
  assert.equal(engine.update(frame(230, [hand(230, 'OPEN', 'FLAT_LIKE', .5, .58)])).scrollVelocity, 0)
  const move = engine.update(frame(280, [hand(280, 'OPEN', 'FLAT_LIKE', .5, .75)]))
  assert.ok(move.scrollVelocity > 0 && move.scrollVelocity < defaults.maxScrollSpeed)
  assert.equal(engine.update(frame(330, [hand(330, 'OPEN', 'FLAT_LIKE')])).scrollVelocity, 0)
})

test('two flat hands require independent confirmation and same nonzero direction, then average times three', () => {
  const engine = new InteractionEngine()
  const pair = (t: number, y1 = .5, y2 = .5) => frame(t, [hand(t, 'OPEN', 'FLAT_LIKE', .3, y1), hand(t, 'OPEN', 'FLAT_LIKE', .7, y2, 2)])
  for (const t of [0, 60, 120, 180]) engine.update(pair(t))
  const fast = engine.update(pair(230, .65, .65)); assert.equal(fast.mode, 'SCROLL_FAST'); assert.ok(fast.scrollVelocity > 0 && fast.scrollVelocity <= defaults.maxScrollSpeed * defaults.twoHandMultiplier)
  assert.equal(engine.update(pair(280, .65, .35)).scrollVelocity, 0)
  assert.equal(engine.update(pair(330, .65, .5)).scrollVelocity, 0)
  assert.equal(engine.update(frame(380, [hand(380, 'OPEN', 'FLAT_LIKE', .3, .65)])).scrollVelocity, 0)
  for (const t of [430, 480, 530]) assert.equal(engine.update(frame(t, [hand(t, 'OPEN', 'FLAT_LIKE', .3, .65)])).scrollVelocity, 0)
  assert.equal(engine.update(frame(580, [hand(580, 'OPEN', 'FLAT_LIKE', .3, .65)])).scrollVelocity, 0)
  assert.ok(engine.update(frame(630, [hand(630, 'OPEN', 'FLAT_LIKE', .3, .8)])).scrollVelocity > 0)
})

test('a newly joining flat hand cannot borrow the first hand confirmation or neutral', () => {
  const engine = new InteractionEngine()
  for (const t of [0, 60, 120, 180]) engine.update(frame(t, [hand(t, 'OPEN', 'FLAT_LIKE', .3)]))
  const pair = (t: number, y = .6) => frame(t, [hand(t, 'OPEN', 'FLAT_LIKE', .3, y), hand(t, 'OPEN', 'FLAT_LIKE', .7, y, 2)])
  for (const t of [230, 280, 330, 380]) assert.equal(engine.update(pair(t)).scrollVelocity, 0)
  assert.equal(engine.update(pair(430)).scrollVelocity, 0)
  assert.ok(engine.update(pair(480, .8)).scrollVelocity > 0)
})

test('duplicate timestamps cannot replay a click and reset disarms every active output', () => {
  const engine = new InteractionEngine(); open(engine)
  assert.equal(close(engine).clickId, 'button')
  assert.equal(engine.update(frame(550, [hand(550, 'FIST')])).clickId, null)
  engine.reset()
  assert.equal(engine.tick(600).mode, 'IDLE')
  assert.equal(engine.update(frame(650, [hand(650, 'FIST')])).clickId, null)
})

test('one upright hand among two cannot silently become a pointer or fist gesture', () => {
  const engine = new InteractionEngine(); open(engine)
  const result = engine.update(frame(350, [hand(350), hand(350, 'OPEN', 'FLAT_LIKE', .7, .5, 2)]))
  assert.equal(result.pointer, null); assert.equal(result.scrollVelocity, 0); assert.equal(result.clickId, null)
})

test('pointer mirrors and clamps active area, uses elapsed-time smoothing and a normalized dead zone', () => {
  const pointer = new PointerController(defaults)
  assert.deepEqual(pointer.update({ x: .08, y: .08 }, 0, { width: 1000, height: 800 }), { x: 1000, y: 0 })
  pointer.reset()
  const center = pointer.update({ x: .5, y: .5 }, 0, { width: 1000, height: 800 })
  assert.ok(Math.abs(center.x - 500) < 1e-8 && Math.abs(center.y - 400) < 1e-8)
  const moved = pointer.update({ x: .43, y: .5 }, 80, { width: 1000, height: 800 })
  assert.ok(moved.x > 535 && moved.x < 539)
  pointer.reset(); pointer.update({ x: .5, y: .5 }, 0, { width: 1000, height: 800 })
  const still = pointer.update({ x: .501, y: .501 }, 80, { width: 1000, height: 800 })
  assert.ok(Math.abs(still.x - 500) < 1e-8 && Math.abs(still.y - 400) < 1e-8)
})

test('target selector applies distance-to-rectangle, exit hysteresis, switch margin and dwell lock', () => {
  const selector = new TargetSelector(defaults)
  const a: InteractionTarget = { id: 'a', kind: 'click', rect: { left: 0, top: 0, width: 10, height: 10 } }
  const b: InteractionTarget = { id: 'b', kind: 'click', rect: { left: 100, top: 0, width: 10, height: 10 } }
  assert.equal(selector.update({ x: 5, y: 5 }, [a, b], 0).focusId, 'a')
  assert.equal(selector.isLocked(149), false); assert.equal(selector.isLocked(150), true)
  assert.equal(selector.update({ x: 52, y: 5 }, [a, b], 200).focusId, 'a')
  assert.equal(selector.update({ x: 58, y: 5 }, [a, b], 250).focusId, 'a')
  assert.equal(selector.update({ x: 70, y: 5 }, [a, b], 300).focusId, 'b')
  assert.equal(selector.isLocked(350), false)
  assert.equal(selector.update({ x: 5, y: 5 }, [{ ...a, disabled: true }], 400).focusId, null)
})

test('confirmed open can bridge a bounded upright closing deadband before a fresh full click confirmation', () => {
  const engine = new InteractionEngine(); open(engine)
  for (const t of [350, 400, 450]) {
    const dormant = engine.update(frame(t, [hand(t, 'UNKNOWN')]))
    assert.equal(dormant.mode, 'GRASP_PENDING'); assert.equal(dormant.focusId, 'button')
    assert.equal(dormant.pointer, null); assert.equal(dormant.clickId, null)
    assert.equal(dormant.drag, null); assert.equal(dormant.scrollVelocity, 0)
  }
  for (const t of [500, 550, 600, 650, 699]) {
    assert.equal(engine.update(frame(t, [hand(t, 'FIST')])).clickId, null)
  }
  assert.equal(engine.update(frame(700, [hand(700, 'FIST')])).clickId, 'button')
  assert.equal(engine.tick(710).clickId, null)
})

test('the dormant closing bridge also enables drag without moving during unknown or counting it as fist time', () => {
  const engine = new InteractionEngine(); open(engine, [card])
  for (const t of [350, 400, 450]) {
    const dormant = engine.update(frame(t, [hand(t, 'UNKNOWN')], [card]))
    assert.equal(dormant.focusId, 'card'); assert.equal(dormant.drag, null); assert.equal(dormant.clickId, null)
  }
  for (const t of [500, 550, 600, 650]) assert.equal(engine.update(frame(t, [hand(t, 'FIST')], [card])).drag, null)
  assert.equal(engine.update(frame(700, [hand(700, 'FIST')], [card])).mode, 'GRABBING')
  const moved = engine.update(frame(750, [hand(750, 'FIST', 'UPRIGHT_LIKE', .45)], [card]))
  assert.equal(moved.drag?.id, 'card'); assert.ok(moved.drag!.deltaX > 0); assert.equal(moved.clickId, null)
})

test('closing bridge deadline cannot be extended by repeated unknown frames or fresh watchdog ticks', () => {
  const engine = new InteractionEngine(); open(engine)
  for (const t of [350, 400, 450, 500, 550, 600, 650, 699]) {
    assert.equal(engine.update(frame(t, [hand(t, 'UNKNOWN')])).focusId, 'button')
  }
  assert.equal(engine.tick(700).focusId, null)
  for (const t of [750, 800, 850, 900, 950]) assert.equal(engine.update(frame(t, [hand(t, 'FIST')])).clickId, null)
  const direct = new InteractionEngine(); open(direct)
  for (const t of [350, 450, 550, 650]) direct.update(frame(t, [hand(t, 'UNKNOWN')]))
  assert.equal(direct.update(frame(700, [hand(700, 'FIST')])).mode, 'UNCERTAIN')
})

test('closing bridge retains the original eligible target and never silently retargets', () => {
  const engine = new InteractionEngine(); open(engine)
  engine.update(frame(350, [hand(350, 'UNKNOWN')]))
  const overlapping = { ...button, id: 'overlapping' }
  assert.equal(engine.update(frame(400, [hand(400, 'UNKNOWN')], [overlapping, button])).focusId, 'button')
  for (const t of [450, 500, 550, 600]) assert.equal(engine.update(frame(t, [hand(t, 'FIST')], [overlapping, button])).clickId, null)
  assert.equal(engine.update(frame(650, [hand(650, 'FIST')], [overlapping, button])).clickId, 'button')
})

test('closing bridge fails closed on motion, lost target, tracking, orientation, count, or layout barriers', () => {
  const barriers: Array<(f: InteractionFrame) => InteractionFrame> = [
    f => ({ ...f, hands: [hand(400, 'UNKNOWN', 'UPRIGHT_LIKE', .4)] }),
    f => ({ ...f, targets: [] }),
    f => ({ ...f, targets: [{ ...button, disabled: true }] }),
    f => ({ ...f, targets: [{ ...button, kind: 'drag' }] }),
    f => ({ ...f, targets: [{ ...button, rect: { ...button.rect, left: 750 } }] }),
    f => ({ ...f, hands: [hand(400, 'UNKNOWN', 'UPRIGHT_LIKE', .5, .5, 2)] }),
    f => ({ ...f, ambiguous: true }),
    f => ({ ...f, hands: [hand(400, 'UNKNOWN', 'TRANSITION')] }),
    f => ({ ...f, hands: [hand(400, 'UNKNOWN', 'FLAT_LIKE')] }),
    f => ({ ...f, hands: [hand(400, 'FIST', 'TRANSITION')] }),
    f => ({ ...f, hands: [hand(400, 'FIST', 'FLAT_LIKE')] }),
    f => ({ ...f, hands: [hand(400, 'UNKNOWN'), hand(400, 'UNKNOWN', 'UPRIGHT_LIKE', .7, .5, 2)] }),
    f => ({ ...f, viewport: { width: 1100, height: 800 } }),
    f => ({ ...f, timestampMs: 349 }),
  ]
  for (const barrier of barriers) {
    const engine = new InteractionEngine(); open(engine)
    assert.equal(engine.update(frame(350, [hand(350, 'UNKNOWN')])).focusId, 'button')
    assert.equal(engine.update(barrier(frame(400, [hand(400, 'UNKNOWN')]))).focusId, null)
    for (const t of [450, 500, 550, 600, 650]) assert.equal(engine.update(frame(t, [hand(t, 'FIST')])).clickId, null)
  }
})

test('closing bridge never starts from unknown, unlocked focus, fist interruption, or an unconfirmed reopen', () => {
  const initial = new InteractionEngine()
  for (const t of [0, 50, 100, 150]) assert.equal(initial.update(frame(t, [hand(t, 'UNKNOWN')])).focusId, null)
  for (const t of [200, 250, 300, 350, 400]) assert.equal(initial.update(frame(t, [hand(t, 'FIST')])).clickId, null)
  const unlocked = new InteractionEngine()
  for (const t of [0, 50, 100, 150]) unlocked.update(frame(t))
  assert.equal(unlocked.update(frame(200, [hand(200, 'UNKNOWN')])).focusId, null)
  const interrupted = new InteractionEngine(); open(interrupted)
  interrupted.update(frame(350, [hand(350, 'FIST')]))
  assert.equal(interrupted.update(frame(400, [hand(400, 'UNKNOWN')])).focusId, null)
  for (const t of [450, 500, 550, 600, 650]) assert.equal(interrupted.update(frame(t, [hand(t, 'FIST')])).clickId, null)
  const reopened = new InteractionEngine(); open(reopened)
  reopened.update(frame(350, [hand(350, 'UNKNOWN')]))
  assert.equal(reopened.update(frame(400)).mode, 'UNCERTAIN')
  for (const t of [450, 500, 550, 600, 650]) assert.equal(reopened.update(frame(t, [hand(t, 'FIST')])).clickId, null)
})

test('a dormant closing bridge stops on watchdog expiry or inference gap before receiving a fist', () => {
  const watched = new InteractionEngine(); open(watched)
  assert.equal(watched.update(frame(350, [hand(350, 'UNKNOWN')])).focusId, 'button')
  assert.equal(watched.tick(551).focusId, null)
  for (const t of [600, 650, 700, 750, 800]) assert.equal(watched.update(frame(t, [hand(t, 'FIST')])).clickId, null)
  const gap = new InteractionEngine(); open(gap)
  gap.update(frame(350, [hand(350, 'UNKNOWN')]))
  for (const t of [551, 600, 650, 700, 750]) assert.equal(gap.update(frame(t, [hand(t, 'FIST')])).clickId, null)
})
