import test from 'node:test'
import assert from 'node:assert/strict'
import { LocalEvaluation } from '../src/evaluation/LocalEvaluation.ts'
import { RecognitionComparison } from '../src/evaluation/RecognitionComparison.ts'
import { controlHand } from './fixtures/controlHand.ts'

const rows = () => new RecognitionComparison().update([{ label: 'Right', landmarks: controlHand('OPEN').worldLandmarks }], 0)

test('guided single-hand capture excludes preparation and late frames despite a delayed UI timer', () => {
  const session = new LocalEvaluation()
  session.startSingle('OPEN_FLAT', 1000)
  assert.equal(session.recording, true, 'actions remain paused throughout preparation')
  session.record(rows(), 3999, 45)
  assert.equal(session.samples.length, 0)
  session.record(rows(), 4000, 45)
  assert.equal(session.samples.length, 1)
  assert.equal(session.samples[0].hand, 'Single')
  assert.equal(session.samples[0].markerMs, 3000)
  session.record(rows(), 15999, 45)
  assert.equal(session.samples.length, 2)
  session.record(rows(), 16000, 45)
  assert.equal(session.recording, false)
  assert.equal(session.samples.length, 2)
})

test('guided capture scores one expected hand and does not invent a missing second hand or select among two', () => {
  const session = new LocalEvaluation()
  session.setLabel('Left', 'FIST', 0); session.setLabel('Right', 'FIST', 0)
  session.startSingle('OPEN_FLAT', 0)
  session.record(rows(), 3000, 45)
  session.record([], 3050, 45)
  session.record([...rows(), { ...rows()[0], label: 'Left' }], 3100, 45)
  assert.equal(session.samples.length, 3)
  assert.deepEqual(session.samples.map(s => s.observed), [true, false, false])
  assert.ok(session.samples.every(s => s.truth === 'OPEN_FLAT' && s.hand === 'Single'))
  session.stop(); session.record(rows(), 3150, 45)
  assert.equal(session.samples.length, 3)
  session.start(4000); session.record(rows(), 4050, 45)
  assert.equal(session.samples.length, 2, 'manual Left/Right labeling remains independent')
})

test('guided capture remains bounded and rejects invalid or repeated clocks', () => {
  const session = new LocalEvaluation(2)
  assert.throws(() => session.startSingle('FIST', NaN), RangeError)
  session.startSingle('FIST', 0)
  session.record(rows(), NaN, 45)
  session.record(rows(), 3000, 45)
  session.record(rows(), 3000, 45)
  session.record(rows(), 2999, 45)
  assert.equal(session.samples.length, 1)
  session.record(rows(), 3050, 45)
  assert.equal(session.samples.length, 2); assert.equal(session.recording, false)
  session.record(rows(), 3100, 45)
  assert.equal(session.samples.length, 2)
  session.clear(); assert.equal(session.singleCapture, null)
})

test('cleanup from an old guided capture cannot stop a newer guided or manual session', () => {
  const session = new LocalEvaluation()
  session.startSingle('OPEN_FLAT', 0)
  const old = session.singleCapture!.segmentId
  session.startSingle('FIST', 100)
  const current = session.singleCapture!.segmentId
  assert.equal(session.stopSingle(old), false)
  assert.equal(session.recording, true)
  assert.equal(session.stopSingle(current), true)
  assert.equal(session.recording, false)
  session.setLabel('Right', 'OPEN_UPRIGHT', 200)
  session.start(200)
  assert.equal(session.stopSingle(current), false)
  assert.equal(session.recording, true)
})
