import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyHybridReadings } from '../src/evaluation/HistoricalHybrid.ts'
import { RecognitionComparison } from '../src/evaluation/RecognitionComparison.ts'
import { LocalEvaluation, summarizeEvaluation } from '../src/evaluation/LocalEvaluation.ts'
import type { Point3D } from '../src/gestures/TrackingQuality.ts'

function hand(pip = 180, dip = pip): Point3D[] {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }))
  for (const mcp of [5, 9, 13, 17]) {
    const a = (180 - pip) * Math.PI / 180
    const b = (360 - pip - dip) * Math.PI / 180
    points[mcp] = { x: mcp * 0.005, y: 0.04, z: 0 }
    points[mcp + 1] = { x: points[mcp].x, y: 0.07, z: 0 }
    points[mcp + 2] = { x: points[mcp + 1].x + 0.03 * Math.sin(a), y: 0.07 + 0.03 * Math.cos(a), z: 0 }
    points[mcp + 3] = { x: points[mcp + 2].x + 0.03 * Math.sin(b), y: points[mcp + 2].y + 0.03 * Math.cos(b), z: 0 }
  }
  return points
}

test('historical hybrid accepts the reported 164 degree PIP / 92 percent reach reading', () => {
  const readings = Array.from({ length: 4 }, () => ({ pipAngleDegrees: 164, reachPercent: 92 }))
  assert.equal(classifyHybridReadings(readings), 'OPEN')
  assert.equal(classifyHybridReadings(readings.slice(0, 3)), 'UNKNOWN')
  assert.equal(classifyHybridReadings(readings.map(r => ({ ...r, reachPercent: NaN }))), 'UNKNOWN')
})

test('historical hybrid retains original fallback, curl and three-finger consensus rules', () => {
  for (const [angle, reach, expected] of [[145, 65, 'OPEN'], [100, 70, 'OPEN'], [99, 97, 'UNKNOWN'], [135, 58, 'FIST'], [136, 58, 'UNKNOWN']] as const) {
    assert.equal(classifyHybridReadings(Array.from({ length: 4 }, () => ({ pipAngleDegrees: angle, reachPercent: reach }))), expected)
  }
})

test('A/B evaluates identical landmarks and independently confirms both algorithms', () => {
  const comparison = new RecognitionComparison()
  const landmarks = hand(164, 144)
  const observation = { label: 'Left', landmarks }
  const first = comparison.update([observation], 0)[0]
  assert.equal(first.conservative.raw, 'UNKNOWN')
  assert.equal(first.hybrid.raw, 'OPEN')
  assert.equal(first.hybrid.stable, 'UNKNOWN')
  assert.equal(comparison.update([observation], 150)[0].hybrid.stable, 'OPEN')
  assert.deepEqual(landmarks, hand(164, 144))
})

test('missing, duplicate or changing handedness cannot reuse another comparison history', () => {
  const comparison = new RecognitionComparison()
  const left = { label: 'Left', landmarks: hand() }
  comparison.update([left], 0)
  assert.equal(comparison.update([left], 150)[0].conservative.stable, 'OPEN')
  const duplicates = comparison.update([left, left], 200)
  assert.ok(duplicates.every(row => !row.identityReliable && row.conservative.stable === 'UNKNOWN'))
  assert.equal(comparison.update([left], 250)[0].conservative.stable, 'UNKNOWN')
  comparison.update([], 300)
  assert.equal(comparison.update([left], 450)[0].conservative.stable, 'UNKNOWN')
  assert.equal(comparison.update([{ ...left, label: 'Right' }], 600)[0].conservative.stable, 'UNKNOWN')
})

test('optional local evaluation counts missed hands, wrong-class errors, latency and negatives', () => {
  const session = new LocalEvaluation(20)
  session.setLabel('Left', 'OPEN_UPRIGHT', 0)
  session.start(0)
  session.record([], 0, 8)
  const comparison = new RecognitionComparison()
  session.record(comparison.update([{ label: 'Left', landmarks: hand() }], 50), 50, 9)
  session.record(comparison.update([{ label: 'Left', landmarks: hand() }], 200), 200, 10)
  session.setLabel('Left', 'OTHER', 250)
  session.record(comparison.update([{ label: 'Left', landmarks: hand() }], 250), 250, 11)
  session.stop()
  const report = summarizeEvaluation(session.samples)
  assert.equal(report.conservative.raw.OPEN.fn, 1)
  assert.equal(report.conservative.raw.OPEN.fp, 1)
  assert.equal(report.conservative.raw.OPEN.positives, 3)
  assert.equal(report.conservative.raw.OPEN.negatives, 1)
  assert.equal(report.conservative.stable.OPEN.fn, 2)
  assert.equal(report.conservative.stable.latency.medianMs, 200)
  assert.equal(report.conservative.stable.latency.unrecognized, 0)
  assert.equal(session.samples.length, 4)
  assert.ok(session.samples[1].landmarks)
})

test('labels are independent, unrecognized latency is censored and samples are bounded', () => {
  const session = new LocalEvaluation(2)
  session.setLabel('Left', 'OPEN_FLAT', 0)
  session.setLabel('Right', 'FIST', 0)
  session.start(0)
  session.record([], 50, 5)
  session.record([], 100, 5)
  assert.equal(session.samples.length, 2)
  assert.equal(session.recording, false)
  const report = summarizeEvaluation(session.samples)
  assert.equal(report.conservative.raw.OPEN.fn, 1)
  assert.equal(report.conservative.raw.FIST.fn, 1)
  assert.equal(report.conservative.stable.latency.unrecognized, 2)
  assert.equal(report.conservative.stable.latency.medianMs, null)
  session.clear()
  assert.equal(session.samples.length, 0)
})

test('disabled recording stores no landmarks or samples', () => {
  const session = new LocalEvaluation()
  session.setLabel('Left', 'FIST', 0)
  const comparison = new RecognitionComparison()
  session.record(comparison.update([{ label: 'Left', landmarks: hand(90) }], 0), 0, 5)
  assert.deepEqual(session.samples, [])
})

test('comparison rejects malformed orientation inputs without breaking camera evaluation', () => {
  const comparison = new RecognitionComparison()
  const sparse = hand()
  delete sparse[0]
  assert.equal(comparison.update([{ label: 'Left', landmarks: sparse }], 0)[0].orientation, 'TRANSITION')
})

test('a new label marker ends prior latency and counts a wrong known pose as FP and FN', () => {
  const session = new LocalEvaluation()
  const comparison = new RecognitionComparison()
  session.setLabel('Left', 'FIST', 0)
  assert.equal(session.getLabel('Left'), 'FIST')
  session.start(0)
  session.record(comparison.update([{ label: 'Left', landmarks: hand() }], 0), 0, 1)
  let report = summarizeEvaluation(session.samples)
  assert.equal(report.conservative.raw.OPEN.fp, 1)
  assert.equal(report.conservative.raw.FIST.fn, 1)
  assert.equal(report.conservative.raw.latency.unrecognized, 1)
  session.setLabel('Left', 'OPEN_FLAT', 100)
  session.record(comparison.update([{ label: 'Left', landmarks: hand() }], 150), 150, 1)
  report = summarizeEvaluation(session.samples)
  assert.equal(report.conservative.raw.latency.medianMs, 50)
  assert.equal(report.conservative.raw.latency.unrecognized, 1)
  assert.equal(report.conservative.raw.byLabel.OPEN_FLAT.OPEN, 1)
  session.setLabel('Left', null, 200)
  assert.equal(session.getLabel('Left'), null)
  session.record([], 250, 1)
  assert.equal(session.samples.length, 2)
})

test('sample copies cannot change when the next camera frame reuses landmark objects', () => {
  const session = new LocalEvaluation()
  session.setLabel('Left', 'OPEN_UPRIGHT', 0)
  session.start(0)
  const landmarks = hand()
  session.record(new RecognitionComparison().update([{ label: 'Left', landmarks }], 0), 0, 1)
  const oldX = landmarks[8].x
  landmarks[8].x = 99
  assert.equal(session.samples[0].landmarks![8].x, oldX)
})
