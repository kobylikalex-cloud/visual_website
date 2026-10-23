import test from 'node:test'
import assert from 'node:assert/strict'
import { FrameGate, TrackingPerformance, distribution } from '../src/tracking/TrackingPerformance.ts'

test('frame gate allows exactly one flight, drops backlog and does not unlock another session', () => {
  const gate = new FrameGate()
  const old = gate.begin(10)!
  assert.equal(gate.begin(20), null)
  gate.reset()
  const fresh = gate.begin(30)!
  assert.equal(gate.finish(old), false)
  assert.equal(gate.begin(40), null)
  assert.equal(gate.finish(fresh), true)
  assert.ok(gate.begin(50))
})

test('performance keeps bounded latency samples, reports median/p95 and separated frame drops', () => {
  assert.deepEqual(distribution([1, 2, 3, 4, 100]), { median: 3, p95: 100 })
  const perf = new TrackingPerformance(3)
  perf.start(0)
  perf.render(0); perf.render(16); perf.render(32)
  perf.camera(5); perf.camera(8)
  perf.drop('busy'); perf.drop('stale')
  for (const inference of [100, 10, 20, 30]) perf.result(inference, 2, 50)
  const report = perf.report(1000)
  assert.equal(report.processedFps, 4)
  assert.equal(report.inference.median, 20)
  assert.equal(report.inference.p95, 30)
  assert.equal(report.drops.busy, 1); assert.equal(report.drops.stale, 1)
  assert.equal(report.cameraFrames, 4)
  assert.equal(report.renderFps, 62.5)
})
