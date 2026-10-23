import test from 'node:test'
import assert from 'node:assert/strict'
import { FistClickEngine } from '../src/control/FistClickEngine.ts'
import { HandTracker } from '../src/control/HandTracker.ts'
import { recognizeControlHand } from '../src/control/ControlRecognition.ts'
import type { Detection } from '../src/control/types.ts'
import { controlHand, palmwardFist } from './fixtures/controlHand.ts'

// Rigid transforms change camera perspective, not finger shape. Center the
// visible palm at the same camera position so pointer mapping is comparable.
function perspective(d: Detection, yaw: number, pitch: number): Detection {
  const a = yaw * Math.PI / 180, b = pitch * Math.PI / 180
  const worldLandmarks = d.worldLandmarks.map(p => {
    const x = p.x * Math.cos(a) + p.z * Math.sin(a), z = -p.x * Math.sin(a) + p.z * Math.cos(a)
    return { x, y: p.y * Math.cos(b) - z * Math.sin(b), z: p.y * Math.sin(b) + z * Math.cos(b) }
  })
  const palm = [0, 5, 9, 13, 17].map(i => worldLandmarks[i])
  const cx = palm.reduce((sum, p) => sum + p.x / 5, 0), cy = palm.reduce((sum, p) => sum + p.y / 5, 0)
  return { ...d, worldLandmarks, landmarks: worldLandmarks.map(p => ({ x: .5 + p.x - cx, y: .5 + p.y - cy, z: p.z })) }
}

const views = [[0, 0], [60, 0], [-60, 0], [90, 0], [-90, 0], [0, 60], [0, -60], [45, 45]]
const targets = [{ id: 'test-0', kind: 'click' as const, activationToken: 1, rect: { left: 450, top: 350, width: 100, height: 100 } }]

test('a side-on projected palm is trackable when its 3D palm is nondegenerate', () => {
  for (const yaw of [90, -90]) {
    const d = perspective(controlHand(), yaw, 0)
    assert.equal(new HandTracker().update({ timestampMs: 0, detections: [d] }).hands.length, 1)
  }
})

test('either hand aims, clicks once and releases across side-on and pitched perspectives', () => {
  for (const folded of [false, true]) for (const mirror of [false, true]) for (const [yaw, pitch] of views) {
    const tracker = new HandTracker(), engine = new FistClickEngine()
    let clicks = 0
    for (let t = 0; t <= 1540; t += 70) {
      const isOpen = t < 490 || t >= 1120
      const d = perspective(isOpen ? controlHand('OPEN', mirror) : folded ? palmwardFist(mirror) : controlHand('FIST', mirror), yaw, pitch)
      const tracking = tracker.update({ timestampMs: t, detections: [d] })
      const result = engine.update({ ...tracking, timestampMs: t, targets, viewport: { width: 1000, height: 800 } }, t + 60)
      if (t === 420) assert.equal(result.focusId, 'test-0', `aim ${mirror}/${yaw}/${pitch}`)
      if (result.activation) clicks++
      assert.equal(engine.tick(t + 120).activation, null)
    }
    assert.equal(clicks, 1, `click ${mirror}/${yaw}/${pitch}`)
    assert.equal(engine.clickDiagnostics.state, 'TARGET_FOCUSED', 'any-view reopening rearms')
  }
})

test('partial hands never activate in any camera perspective', () => {
  for (const [yaw, pitch] of views) {
    const tracker = new HandTracker(), engine = new FistClickEngine()
    for (let t = 0; t <= 1400; t += 70) {
      const d = perspective(controlHand(t < 490 ? 'OPEN' : 'PARTIAL'), yaw, pitch)
      const result = engine.update({ ...tracker.update({ timestampMs: t, detections: [d] }), timestampMs: t,
        targets, viewport: { width: 1000, height: 800 } }, t)
      assert.equal(result.activation, null)
    }
  }
})

test('geometric finger pose is invariant under the same rigid changes of perspective', () => {
  for (const pose of ['OPEN', 'FIST', 'PARTIAL'] as const) for (const [yaw, pitch] of views) {
    assert.equal(recognizeControlHand(perspective(controlHand(pose), yaw, pitch).worldLandmarks).pose, pose === 'PARTIAL' ? 'UNKNOWN' : pose)
  }
})

test('bent fingers with longer reach still form a fist when all four tips fold behind their MCP plane', () => {
  for (const mirror of [false, true]) for (const [yaw, pitch] of views) {
    assert.equal(recognizeControlHand(perspective(palmwardFist(mirror), yaw, pitch).worldLandmarks).pose, 'FIST')
  }
})

test('a hook in front of the MCP plane or any individually extended finger is not a complete fist', () => {
  for (const [yaw, pitch] of views) {
    assert.equal(recognizeControlHand(perspective(palmwardFist(false, 0), yaw, pitch).worldLandmarks).pose, 'UNKNOWN')
    for (const mcp of [5, 9, 13, 17]) {
      const d = palmwardFist(), open = controlHand()
      d.worldLandmarks.splice(mcp, 4, ...open.worldLandmarks.slice(mcp, mcp + 4))
      assert.equal(recognizeControlHand(perspective(d, yaw, pitch).worldLandmarks).pose, 'UNKNOWN')
    }
  }
})
