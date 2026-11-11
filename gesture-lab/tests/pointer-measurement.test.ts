import test from 'node:test'
import assert from 'node:assert/strict'
import { PointerMeasurementSession, FeedbackLatency } from '../src/evaluation/PointerMeasurement.ts'
import { OpenPointerEngine } from '../src/control/OpenPointerEngine.ts'

const idle = new OpenPointerEngine().cancel()
const focused = { ...idle, mode: 'POINTER' as const, focusId: 'a', pointer: { x: 100, y: 100 } }

test('measurement counts watchdog and cancellation transitions even without new camera frames', () => {
  const session = new PointerMeasurementSession('moving')
  session.observe(focused, true, 0, true)
  session.observe(idle, false, 201, false)
  session.observe(idle, false, 250, false)
  assert.equal(session.data.frames, 1)
  assert.equal(session.data.interruptions, 1)
  assert.equal(session.data.switches, 1)
})

test('stationary capture stops after ten seconds and ignores later movement', () => {
  const session = new PointerMeasurementSession('stationary')
  session.observe(focused, true, 0, true)
  session.observe(focused, true, 9999, true)
  session.observe({ ...focused, pointer: { x: 500, y: 500 } }, true, 10000, true)
  assert.equal(session.data.complete, true)
  assert.equal(session.data.points.length, 2)
})

test('software feedback latency is sampled only once at the first CSS update', () => {
  const latency = new FeedbackLatency()
  latency.submitted(100)
  latency.rendered(130); latency.rendered(150)
  assert.deepEqual(latency.report(), { median: 30, p95: 30 })
  latency.submitted(200); latency.cancel(); latency.rendered(400)
  assert.deepEqual(latency.report(), { median: 30, p95: 30 })
})
