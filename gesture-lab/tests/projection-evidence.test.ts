import test from 'node:test'
import assert from 'node:assert/strict'
import { getProjectedFingerEvidence } from '../src/evaluation/ProjectionEvidence.ts'
import { getFingerPoseEvidence } from '../src/control/FingerPoseEvidence.ts'
import { controlHand } from './fixtures/controlHand.ts'
import { RecognitionComparison } from '../src/evaluation/RecognitionComparison.ts'
import { LocalEvaluation } from '../src/evaluation/LocalEvaluation.ts'

test('projection diagnostics restore image aspect before measuring angles and ignore model depth', () => {
  const physical = controlHand('OPEN').worldLandmarks
  const image = physical.map(p => ({ x: .5 + p.x / 2, y: .5 + p.y, z: p.z + .4 }))
  const expected = getFingerPoseEvidence(physical.map(p => ({ ...p, z: 0 })))!
  const actual = getProjectedFingerEvidence(image, { width: 1280, height: 640 })!
  assert.ok(actual, 'valid image projection must provide diagnostic evidence')
  assert.equal(actual.length, 4)
  actual.forEach((f,i) => {
    assert.ok(Math.abs(f.pipAngleDegrees - expected[i].pipAngleDegrees) < .001)
    assert.ok(Math.abs(f.reachPercent - expected[i].reachPercent) < .001)
  })
  assert.deepEqual(actual, getProjectedFingerEvidence(image.map(p => ({ ...p, z: p.z + 100 })), { width: 1280, height: 640 }))
})

test('unobservable image geometry cannot become finger evidence', () => {
  const image = controlHand('OPEN').landmarks
  for (const size of [undefined, { width: 0, height: 480 }, { width: NaN, height: 480 }]) {
    assert.equal(getProjectedFingerEvidence(image, size), null)
  }
  const collapsed = image.map(p => ({ ...p, x: .5, y: .5 }))
  assert.equal(getProjectedFingerEvidence(collapsed, { width: 640, height: 480 }), null)
})

test('paired image/world observations are from one comparison row and copied into local samples', () => {
  const d = controlHand('OPEN'), comparison = new RecognitionComparison(), session = new LocalEvaluation()
  const size = { width: 640, height: 480 }
  const rows = comparison.update([{ label: 'Right', landmarks: d.worldLandmarks, imageLandmarks: d.landmarks, imageSize: size }], 3000)
  session.startSingle('OPEN_FLAT', 0)
  session.record(rows, 3055, 45, 3000)
  assert.deepEqual(session.samples[0].imageLandmarks, d.landmarks)
  assert.deepEqual(session.samples[0].imageSize, size)
  assert.equal(session.samples[0].captureTimestampMs, 3000)
  d.landmarks[0].x += 1; size.width = 1
  assert.notEqual(session.samples[0].imageLandmarks![0].x, d.landmarks[0].x)
  assert.equal(session.samples[0].imageSize!.width, 640)
})

test('preparation-captured frames delivered during measurement remain excluded', () => {
  const comparison = new RecognitionComparison(), session = new LocalEvaluation()
  session.startSingle('OPEN_FLAT', 0)
  const d = controlHand('OPEN')
  const rows = comparison.update([{ label: 'Right', landmarks: d.worldLandmarks }], 2980)
  session.record(rows, 3030, 45, 2980)
  assert.equal(session.samples.length, 0)
  session.record(rows, 3090, 45, 3040)
  assert.equal(session.samples.length, 1)
})

test('capture variants retain the exact on-screen prompt and repeated source frames are excluded', () => {
  const session = new LocalEvaluation()
  session.startSingle('OTHER', 0, 'Zwei Finger flach')
  assert.equal(session.singleCapture!.prompt, 'Zwei Finger flach')
  session.record([], 3050, 45, 3000)
  session.record([], 3100, 45, 3000)
  session.record([], 3150, 45, 3200)
  assert.equal(session.samples.length, 1)
})
