import test from 'node:test'
import assert from 'node:assert/strict'
import { FistClickEngine } from '../src/control/FistClickEngine.ts'
import { HandTracker } from '../src/control/HandTracker.ts'
import { InteractionTargetRegistry } from '../src/control/InteractionTargetRegistry.ts'
import { recognizeControlHand } from '../src/control/ControlRecognition.ts'
import { controlHand } from './fixtures/controlHand.ts'

test('raw landmarks through tracker, click confirmation and registry activate once for either hand', () => {
  for (const mirror of [false, true]) {
    const tracker = new HandTracker(), engine = new FistClickEngine(), registry = new InteractionTargetRegistry()
    let count = 0
    const owner = {}, registration = registry.register('test-0', owner, () => true, () => count++)
    const targets = [{ id: 'test-0', kind: 'click' as const, activationToken: registration.token, rect: { left: 450, top: 350, width: 100, height: 100 } }]
    for (let time = 0; time <= 1400; time += 50) {
      const detections = [controlHand(time <= 300 ? 'OPEN' : time <= 450 ? 'PARTIAL' : 'FIST', mirror)]
      const tracking = tracker.update({ timestampMs: time, detections })
      const result = engine.update({ ...tracking, timestampMs: time, targets, viewport: { width: 1000, height: 800 } }, time)
      if (time <= 650) assert.equal(count, 0)
      if (result.activation) engine.acknowledge(result.activation.sequence, registry.activate(result.activation), time)
      assert.equal(engine.tick(time).activation, null)
    }
    assert.equal(count, 1); assert.equal(engine.clickDiagnostics.validClicks, 1)
  }
})

test('each non-thumb finger must close; thumb position is not a rigid fist requirement', () => {
  const fist = controlHand('FIST').worldLandmarks, open = controlHand('OPEN').worldLandmarks
  assert.equal(recognizeControlHand(fist).pose, 'FIST')
  for (const mcp of [5, 9, 13, 17]) {
    const partial = fist.map(point => ({ ...point }))
    partial.splice(mcp, 4, ...open.slice(mcp, mcp + 4))
    assert.equal(recognizeControlHand(partial).pose, 'UNKNOWN')
  }
  for (const scale of [.5, 2]) {
    const transformed = fist.map(point => ({ x: point.z * scale + 1, y: point.y * scale - 2, z: -point.x * scale + 3 }))
    for (let i = 1; i <= 4; i++) transformed[i] = { x: i * .3, y: i * .1, z: -.2 }
    assert.equal(recognizeControlHand(transformed).pose, 'FIST')
  }
})
