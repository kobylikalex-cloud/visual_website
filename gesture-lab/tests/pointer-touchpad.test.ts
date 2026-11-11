import test from 'node:test'
import assert from 'node:assert/strict'
import { PointerController } from '../src/control/PointerController.ts'
import { OpenPointerEngine } from '../src/control/OpenPointerEngine.ts'
import { FistClickEngine } from '../src/control/FistClickEngine.ts'
import { PageGestureEngine } from '../src/control/PageGestureEngine.ts'
import { DEFAULT_GESTURE_CONFIG } from '../src/control/GestureConfig.ts'
import type { InteractionFrame, Point2 } from '../src/control/types.ts'

const config = { ...DEFAULT_GESTURE_CONFIG, pointerMode: 'relative' as const, pointerSmoothingMs: 0 }
const viewport = { width: 1000, height: 800 }
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`)
const target = { id: 'test', kind: 'click' as const, activationToken: 1, rect: { left: 450, top: 350, width: 100, height: 100 } }
function frame(t: number, center: Point2, pose: 'OPEN' | 'FIST' | 'UNKNOWN' = 'OPEN', id = 1, flat = false): InteractionFrame {
  return { timestampMs: t, ambiguous: false, reason: 'valid', viewport, targets: [target], hands: [{ id, timestampMs: t, center, pose,
    orientation: flat ? 'FLAT_LIKE' : 'UPRIGHT_LIKE', orientationMetrics: { imageTiltDegrees: 0, depthTiltDegrees: flat ? 60 : 9, palmFacingCameraPercent: flat ? 30 : 95 } }] }
}

test('relative pointer anchors arbitrary first palm at center and scales mirrored hand displacement', () => {
  for (const gain of [.8, 1.6, 2.5]) {
    const p = new PointerController({ ...config, pointerGain: gain })
    assert.deepEqual(p.update({ x: .8, y: .2 }, 0, viewport), { x: 500, y: 400 })
    const moved = p.update({ x: .73, y: .27 }, 50, viewport)
    near(moved.x, 500 + 100 * gain); near(moved.y, 400 + 80 * gain)
  }
})

test('relative edge clamping has no hidden accumulation and reverses on the next movement', () => {
  const p = new PointerController(config)
  p.update({ x: .5, y: .5 }, 0, viewport)
  assert.deepEqual(p.update({ x: 0, y: 1 }, 50, viewport), { x: 1000, y: 800 })
  const returning = p.update({ x: .07, y: .93 }, 100, viewport)
  near(returning.x, 840); near(returning.y, 672)
  assert.deepEqual(p.update({ x: 1, y: 0 }, 150, viewport), { x: 0, y: 0 })
  const fromLeft = p.update({ x: .93, y: .07 }, 200, viewport)
  near(fromLeft.x, 160); near(fromLeft.y, 128)
})

test('lifting the relative pointer retains filtered position and discards pending movement', () => {
  const p = new PointerController({ ...config, pointerSmoothingMs: 140 })
  p.update({ x: .5, y: .5 }, 0, viewport)
  const last = p.update({ x: .43, y: .57 }, 50, viewport)
  assert.ok(last.x > 500 && last.x < 660)
  p.reset()
  assert.deepEqual(p.update({ x: .9, y: .1 }, 1000, viewport), last)
  assert.deepEqual(p.update({ x: .9, y: .1 }, 1100, viewport), last)
  p.setGain(2.5)
  assert.deepEqual(p.update({ x: .9, y: .1 }, 1200, viewport), last)
  const moved = p.update({ x: .83, y: .17 }, 1250, viewport)
  assert.ok(moved.x > last.x && moved.x < last.x + 250)
})

test('first confirmed palm establishes the relative anchor before any RAF movement', () => {
  const p = new OpenPointerEngine(config)
  p.update(frame(0, { x: .8, y: .2 }), 0)
  p.update(frame(100, { x: .7, y: .3 }), 100)
  const first = p.update(frame(150, { x: .6, y: .4 }), 150)
  assert.deepEqual(first.pointer, { x: 500, y: 400 })
  assert.deepEqual(p.tick(166).pointer, first.pointer)
  const next = p.update(frame(200, { x: .53, y: .47 }), 200)
  near(next.pointer!.x, 660); near(next.pointer!.y, 528)
})

test('relative uncertainty freezes geometry and reconfirmation excludes motion during the gap', () => {
  const p = new OpenPointerEngine(config)
  for (let t = 0; t <= 300; t += 50) p.update(frame(t, { x: .5, y: .5 }), t)
  const paused = p.update(frame(350, { x: .2, y: .7 }, 'UNKNOWN'), 350)
  assert.equal(paused.focusId, 'test'); assert.equal(paused.pointer, null)
  assert.equal(p.tick(366).pointer, null)
  for (let t = 400; t <= 550; t += 50) p.update(frame(t, { x: .8, y: .2 }), t)
  assert.deepEqual(p.tick(550).pointer, { x: 500, y: 400 })
  near(p.update(frame(600, { x: .73, y: .2 }), 600).pointer!.x, 660)
})

test('relative gain updates and movement-range calibration retain position without importing camera offsets', () => {
  const p = new OpenPointerEngine(config)
  for (let t = 0; t <= 300; t += 50) p.update(frame(t, { x: .8, y: .2 }), t)
  p.update(frame(350, { x: .73, y: .2 }), 350)
  p.configure({ ...config, pointerGain: 2.5 })
  near(p.tick(350).pointer!.x, 660)
  near(p.update(frame(400, { x: .66, y: .2 }), 400).pointer!.x, 910)
  p.configure({ ...config, pointerMinX: -.2, pointerMaxX: .5 })
  for (let t = 450; t <= 600; t += 50) p.update(frame(t, { x: .2, y: .8 }), t)
  near(p.tick(600).pointer!.x, 910)
  near(p.tick(600).pointer!.y, 400)
})

test('relative click/reopen continues from its old position without replay or repeated activation', () => {
  const p = new FistClickEngine(config), center = { x: .8, y: .2 }
  for (let t = 0; t <= 300; t += 50) p.update(frame(t, center), t)
  assert.equal(p.clickDiagnostics.state, 'TARGET_FOCUSED')
  let clicks = 0
  for (let t = 350; t <= 550; t += 50) if (p.update(frame(t, { x: .77, y: .22 }, 'FIST'), t).activation) clicks++
  assert.equal(clicks, 1)
  for (let t = 600; t <= 800; t += 50) assert.equal(p.update(frame(t, { x: .77, y: .22 }, 'FIST'), t).activation, null)
  for (let t = 850; t <= 1000; t += 50) p.update(frame(t, { x: .3, y: .7 }), t)
  assert.deepEqual(p.tick(1000).pointer, { x: 500, y: 400 })
  near(p.update(frame(1050, { x: .23, y: .7 }), 1050).pointer!.x, 660)
})

test('relative reacquisition keeps only position and cannot inherit click focus or identity', () => {
  const p = new FistClickEngine(config)
  for (let t = 0; t <= 300; t += 50) p.update(frame(t, { x: .5, y: .5 }), t)
  p.update(frame(350, { x: .43, y: .5 }), 350)
  p.cancel('Tracking lost')
  for (let t = 400; t <= 700; t += 50) assert.equal(p.update(frame(t, { x: .9, y: .2 }, 'FIST', 2), t).activation, null)
  assert.equal(p.tick(700).pointer, null)
  for (let t = 750; t <= 900; t += 50) p.update(frame(t, { x: .9, y: .2 }, 'OPEN', 2), t)
  near(p.tick(900).pointer!.x, 660)
  assert.equal(p.tick(900).activation, null)
})

test('mode or mapping changes discard click-ready intent before the next camera frame without a RAF tick', () => {
  for (const change of [{ ...config, pointerMode: 'absolute' as const }, { ...config, pointerMinX: .2 }]) {
    const p = new PageGestureEngine(config)
    for (let t = 0; t <= 300; t += 50) p.update(frame(t, { x: .5, y: .5 }), t)
    assert.equal(p.clickDiagnostics.state, 'TARGET_FOCUSED')
    assert.equal(p.configure(change).focusId, null)
    for (let t = 350; t <= 700; t += 50) {
      assert.equal(p.update(frame(t, { x: .5, y: .5 }, 'FIST'), t).activation, null)
    }
    assert.equal(p.clickDiagnostics.validClicks, 0)
  }
})

test('explicit relative recenter cancels click intent and preserves gain through the page engine', () => {
  const p = new PageGestureEngine(config)
  for (let t = 0; t <= 300; t += 50) p.update(frame(t, { x: .8, y: .2 }), t)
  p.update(frame(350, { x: .73, y: .2 }), 350)
  p.recenterPointer()
  for (let t = 400; t <= 600; t += 50) assert.equal(p.update(frame(t, { x: .73, y: .2 }, 'FIST'), t).activation, null)
  for (let t = 650; t <= 800; t += 50) p.update(frame(t, { x: .2, y: .8 }), t)
  assert.deepEqual(p.tick(800).pointer, { x: 500, y: 400 })
  near(p.update(frame(850, { x: .13, y: .8 }), 850).pointer!.x, 660)
})

test('scroll return reanchors relative movement instead of applying arm travel to the pointer', () => {
  const p = new PageGestureEngine(config)
  for (let t = 0; t <= 300; t += 50) p.update(frame(t, { x: .8, y: .2 }), t)
  p.update(frame(350, { x: .73, y: .2 }), 350)
  for (let t = 400; t <= 950; t += 50) p.update(frame(t, { x: .4, y: .5 }, 'OPEN', 1, true), t)
  assert.equal(p.tick(950).interactionState, 'SCROLL_ACTIVE')
  for (let t = 1000; t <= 1450; t += 50) p.update(frame(t, { x: .4, y: .7 }), t)
  near(p.tick(1450).pointer!.x, 660)
  near(p.tick(1450).pointer!.y, 400)
  assert.equal(p.tick(1450).activation, null)
})

test('debug navigation-only trial bypasses automatic rotation switching and requires fresh click intent when toggled', () => {
  const p = new PageGestureEngine(config)
  p.setAutomaticScroll(false)
  for (let t = 0; t <= 300; t += 50) p.update(frame(t, { x: .8, y: .2 }, 'OPEN', 1, true), t)
  assert.equal(p.clickDiagnostics.state, 'TARGET_FOCUSED')
  assert.equal(p.tick(300).interactionState, 'POINTER_MODE')
  let clicks = 0
  for (let t = 350; t <= 550; t += 50) if (p.update(frame(t, { x: .8, y: .2 }, 'FIST', 1, true), t).activation) clicks++
  assert.equal(clicks, 1)
  for (let t = 600; t <= 900; t += 50) p.update(frame(t, { x: .8, y: .2 }, 'OPEN', 1, true), t)
  p.setAutomaticScroll(true)
  for (let t = 950; t <= 1200; t += 50) {
    const result = p.update(frame(t, { x: .8, y: .2 }, 'FIST', 1, true), t)
    assert.equal(result.activation, null); assert.equal(result.scrollDeltaY, 0)
  }
  for (let t = 1250; t <= 1800; t += 50) p.update(frame(t, { x: .8, y: .5 }, 'OPEN', 1, true), t)
  assert.equal(p.tick(1800).interactionState, 'SCROLL_ACTIVE')
  assert.equal(p.setAutomaticScroll(false).scrollDeltaY, 0)
  assert.equal(p.tick(1816).scrollVelocity, 0)
})
