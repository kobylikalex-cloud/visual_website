import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PlaygroundController } from '../src/control/PlaygroundController.ts'
import { calibratePointer, constrainCardPosition } from '../src/control/MovementCalibration.ts'
import { DEFAULT_GESTURE_CONFIG } from '../src/control/GestureConfig.ts'
import type { Detection, TrackingFrame, InteractionTarget } from '../src/control/types.ts'

function detection(centerX = 0.5, centerY = 0.5, fist = false, flat = false): Detection {
  const world = Array.from({ length: 21 }, () => ({ x: 0, y: 0.04, z: 0 }))
  world[0] = { x: 0, y: 0.08, z: 0 }
  for (const [offset, mcp] of [5, 9, 13, 17].entries()) {
    world[mcp] = { x: (offset - 1.5) * 0.025, y: 0, z: 0 }
    const bend = fist ? Math.PI / 2 : 0
    for (let bone = 1; bone <= 3; bone++) {
      world[mcp + bone] = {
        x: world[mcp + bone - 1].x,
        y: world[mcp + bone - 1].y - 0.025 * Math.cos((bone - 1) * bend),
        z: world[mcp + bone - 1].z + 0.025 * Math.sin((bone - 1) * bend),
      }
    }
  }
  const meanY = (world[0].y + world[5].y + world[9].y + world[13].y + world[17].y) / 5
  const landmarks = world.map(point => ({ x: centerX + point.x, y: centerY + point.y - meanY, z: point.z }))
  const angle = flat ? Math.PI / 3 : 0
  const worldLandmarks = world.map(point => ({ x: point.x,
    y: point.y * Math.cos(angle) - point.z * Math.sin(angle),
    z: point.y * Math.sin(angle) + point.z * Math.cos(angle) }))
  return { landmarks, worldLandmarks, handedness: 'Left' }
}
const target: InteractionTarget = { id: 'pulse', kind: 'click', rect: { left: 450, top: 350, width: 100, height: 100 } }
const viewport = { width: 1000, height: 800 }
function setup() {
  const clicks: string[] = [], drags: { x: number; y: number }[] = [], scrolls: number[] = []
  const controller = new PlaygroundController({ activate: id => clicks.push(id), dragBy: delta => drags.push(delta), scrollBy: dy => scrolls.push(dy) })
  const feed = (time: number, observations: Detection[] = [detection()], targets = [target], receivedAt = time, evaluationOnly = false) =>
    controller.update({ timestampMs: time, detections: observations, evaluationOnly } satisfies TrackingFrame, targets, viewport, receivedAt)
  return { controller, feed, clicks, drags, scrolls }
}

test('full landmark pipeline authorizes exactly one eligible click after open focus and deliberate fist', () => {
  const { feed, clicks } = setup()
  for (let t = 0; t <= 300; t += 50) feed(t)
  for (let t = 350; t <= 750; t += 50) feed(t, [detection(0.5, 0.5, true)])
  assert.deepEqual(clicks, ['pulse'])
})

test('natural partial-finger closure survives without effects and still requires a complete fist interval', () => {
  const { feed, clicks } = setup()
  for (let t = 0; t <= 300; t += 50) feed(t)
  const partial = detection()
  const curled = detection(0.5, 0.5, true)
  partial.worldLandmarks.splice(5, 4, ...curled.worldLandmarks.slice(5, 9))
  partial.landmarks.splice(5, 4, ...curled.landmarks.slice(5, 9))
  feed(350, [partial]); feed(400, [partial])
  assert.deepEqual(clicks, [])
  for (let t = 450; t < 650; t += 50) feed(t, [curled])
  assert.deepEqual(clicks, [])
  feed(650, [curled])
  assert.deepEqual(clicks, ['pulse'])
})

test('full landmark grasp moves only the registered demo object and opening releases without a click', () => {
  const { feed, clicks, drags } = setup()
  const dragTarget: InteractionTarget = { ...target, id: 'orbit-card', kind: 'drag' }
  for (let t = 0; t <= 300; t += 50) feed(t, [detection()], [dragTarget])
  const partial = detection()
  const curled = detection(0.5, 0.5, true)
  partial.worldLandmarks.splice(5, 4, ...curled.worldLandmarks.slice(5, 9))
  feed(350, [partial], [dragTarget])
  for (let t = 400; t <= 600; t += 50) feed(t, [curled], [dragTarget])
  feed(650, [detection(0.45, 0.5, true)], [dragTarget])
  assert.ok(drags.some(delta => delta.x > 0))
  const count = drags.length
  feed(700, [detection(0.45)], [dragTarget])
  assert.equal(drags.length, count)
  assert.deepEqual(clicks, [])
})

test('late inference, evaluation recording, pause and unseen fists cannot trigger actions', () => {
  for (const unsafe of ['late', 'evaluation', 'pause', 'fist'] as const) {
    const { controller, feed, clicks } = setup()
    if (unsafe === 'pause') controller.setEnabled(false)
    for (let t = 0; t <= 600; t += 50) {
      feed(t, [detection(0.5, 0.5, unsafe === 'fist' || t >= 350)], [target], unsafe === 'late' ? t + 250 : t, unsafe === 'evaluation')
    }
    assert.deepEqual(clicks, [], unsafe)
  }
})

test('scroll effects integrate elapsed time and stop on no-hand or watchdog expiry', () => {
  const { controller, feed, scrolls } = setup()
  for (let t = 0; t <= 250; t += 50) feed(t, [detection(0.5, 0.5, false, true)])
  feed(300, [detection(0.5, 0.66, false, true)])
  controller.tick(300)
  controller.tick(316)
  assert.ok(scrolls.some(value => value > 0))
  feed(350, [])
  const count = scrolls.length
  controller.tick(366)
  controller.tick(1000)
  assert.equal(scrolls.length, count)
})

test('canceling for an evaluation-start event stops scroll before another camera frame', () => {
  const { controller, feed, scrolls } = setup()
  for (let t = 0; t <= 250; t += 50) feed(t, [detection(0.5, 0.5, false, true)])
  feed(300, [detection(0.5, 0.66, false, true)])
  controller.tick(300)
  controller.tick(316)
  assert.ok(scrolls.length > 0)
  // CameraManager's recording-start callback invokes this synchronously.
  controller.cancel()
  const count = scrolls.length
  controller.tick(332)
  controller.tick(348)
  assert.equal(scrolls.length, count)
})

test('pointer calibration accounts for mirroring and card displacement stays inside its arena', () => {
  const config = calibratePointer({ x: 0.3, y: 0.4 }, DEFAULT_GESTURE_CONFIG)
  assert.ok(Math.abs((config.pointerMinX + config.pointerMaxX) / 2 - 0.7) < 1e-8)
  assert.ok(Math.abs((config.pointerMinY + config.pointerMaxY) / 2 - 0.4) < 1e-8)
  assert.deepEqual(constrainCardPosition({ x: 0, y: 0 }, { x: 1000, y: -1000 }, { width: 500, height: 300 }, { width: 200, height: 100 }), { x: 150, y: -100 })
})
