import test from 'node:test'
import assert from 'node:assert/strict'
import { PointerController } from '../src/control/PointerController.ts'
import { calibratePointer } from '../src/control/MovementCalibration.ts'
import { DEFAULT_GESTURE_CONFIG as defaults } from '../src/control/GestureConfig.ts'
import { OpenPointerEngine } from '../src/control/OpenPointerEngine.ts'
import type { InteractionFrame } from '../src/control/types.ts'

const viewport = { width: 1000, height: 800 }
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)

test('default gain is 1.6 and independently scales mirrored displacement about screen center', () => {
  assert.equal(defaults.pointerGain, 1.6)
  for (const gain of [.8, 1, 1.6, 2.5]) {
    const pointer = new PointerController({ ...defaults, pointerGain: gain })
    const center = pointer.project({ x: .5, y: .5 }, viewport)
    near(center.x, 500); near(center.y, 400)
    const moved = pointer.project({ x: .43, y: .57 }, viewport)
    near(moved.x, 500 + 100 * gain); near(moved.y, 400 + 80 * gain)
  }
})

test('recenter preserves gain and movement span even near camera edges, then clamps only the screen output', () => {
  const restingPalm = { x: .2, y: .75 }
  const config = calibratePointer(restingPalm, { ...defaults, pointerGain: 2.5 })
  assert.equal(config.pointerGain, 2.5)
  near(config.pointerMaxX - config.pointerMinX, defaults.pointerMaxX - defaults.pointerMinX)
  near(config.pointerMaxY - config.pointerMinY, defaults.pointerMaxY - defaults.pointerMinY)
  const pointer = new PointerController(config)
  near(pointer.project(restingPalm, viewport).x, 500)
  near(pointer.project(restingPalm, viewport).y, 400)
  near(pointer.project({ x: .13, y: .68 }, viewport).x, 750)
  near(pointer.project({ x: .13, y: .68 }, viewport).y, 200)
  assert.deepEqual(pointer.project({ x: 0, y: 1 }, viewport), { x: 1000, y: 800 })
  assert.deepEqual(pointer.project({ x: 1, y: 0 }, viewport), { x: 0, y: 0 })
})

test('gain changes preserve the current smoothed position and converge without overshoot', () => {
  const pointer = new PointerController({ ...defaults, pointerGain: 1 })
  pointer.update({ x: .5, y: .5 }, 0, viewport)
  const before = pointer.update({ x: .43, y: .57 }, 50, viewport)
  pointer.setGain(2.5)
  assert.deepEqual(pointer.update({ x: .43, y: .57 }, 50, viewport), before)
  let previous = before
  for (let time = 66; time <= 1000; time += 16) {
    const next = pointer.update({ x: .43, y: .57 }, time, viewport)
    assert.ok(next.x >= previous.x && next.x <= 750)
    assert.ok(next.y >= previous.y && next.y <= 600)
    previous = next
  }
  assert.ok(previous.x > 740)
  pointer.setGain(.8)
  assert.deepEqual(pointer.update({ x: .43, y: .57 }, 994, viewport), previous)
})

test('active engine gain adjustment preserves confirmation, focus and current pointer position', () => {
  const config = { ...defaults, pointerGain: 1 }
  const engine = new OpenPointerEngine(config)
  const frame = (time: number): InteractionFrame => ({ timestampMs: time,
    hands: [{ id: 1, center: { x: .43, y: .5 }, pose: 'OPEN', orientation: 'UPRIGHT_LIKE', timestampMs: time }],
    ambiguous: false, reason: 'valid palm', viewport,
    targets: [{ id: 'button', kind: 'click', rect: { left: 550, top: 350, width: 100, height: 100 } }] })
  for (let time = 0; time <= 300; time += 50) engine.update(frame(time), time)
  const before = engine.tick(300)
  assert.equal(before.focusId, 'button')
  const adjusted = engine.configure({ ...config, pointerGain: 2.5 })
  assert.deepEqual(adjusted, before)
  assert.equal(engine.diagnostics.confirmed, true)
  assert.deepEqual(engine.tick(300).pointer, before.pointer)
  const next = engine.tick(316)
  assert.ok(next.pointer!.x > before.pointer!.x && next.pointer!.x < 750)
  assert.equal(next.clickId, null); assert.equal(next.drag, null); assert.equal(next.scrollVelocity, 0)
})
