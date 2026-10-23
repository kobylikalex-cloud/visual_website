import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyFingerPose, classifyHandPose, HandPoseStabilizer } from '../src/gestures/HandPoseEngine.ts'
import { getFingerExtensionReadings } from '../src/gestures/FingerExtensionDiagnostics.ts'
import { getFingerFeatures } from '../src/gestures/FingerGeometry.ts'
import { hasValidHandLandmarks } from '../src/gestures/TrackingQuality.ts'

type Point = { x: number; y: number; z: number }

// Analytic fixtures, not captured people: each bone is 30 mm long.
// Interior joint angles are exactly the supplied PIP and DIP degrees.
function hand(pipDegrees = 180, dipDegrees = pipDegrees): Point[] {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }))
  for (const [finger, mcp] of [5, 9, 13, 17].entries()) {
    const pipBend = (180 - pipDegrees) * Math.PI / 180
    const dipBend = (180 - dipDegrees) * Math.PI / 180
    points[mcp] = { x: finger * 0.02, y: 0.04, z: 0 }
    points[mcp + 1] = { x: points[mcp].x, y: 0.07, z: 0 }
    points[mcp + 2] = {
      x: points[mcp + 1].x + 0.03 * Math.sin(pipBend),
      y: points[mcp + 1].y + 0.03 * Math.cos(pipBend), z: 0,
    }
    points[mcp + 3] = {
      x: points[mcp + 2].x + 0.03 * Math.sin(pipBend + dipBend),
      y: points[mcp + 2].y + 0.03 * Math.cos(pipBend + dipBend), z: 0,
    }
  }
  return points
}

test('recognizes a straight open hand and a consistently folded fist', () => {
  assert.equal(classifyHandPose(hand()), 'OPEN')
  assert.equal(classifyHandPose(hand(90)), 'FIST')
})

test('straight PIP joints with folded fingertips are uncertain, not OPEN', () => {
  assert.equal(classifyHandPose(hand(180, 90)), 'UNKNOWN')
})

test('bent PIP joints with straight fingertips are uncertain, not FIST', () => {
  assert.equal(classifyHandPose(hand(90, 180)), 'UNKNOWN')
})

test('one disagreeing finger prevents whole-hand classification', () => {
  for (const [pip, expected] of [[180, 'OPEN'], [90, 'FIST']] as const) {
    const points = hand(pip)
    points.splice(17, 4, ...hand(pip === 180 ? 90 : 180).slice(17, 21))
    assert.notEqual(classifyHandPose(points), expected)
    assert.equal(classifyHandPose(points), 'UNKNOWN')
  }
})

test('invalid landmarks and collapsed fingertip bones fail closed', () => {
  assert.equal(classifyHandPose([]), 'UNKNOWN')
  for (const value of [NaN, Infinity, -Infinity]) {
    const points = hand()
    points[8].x = value
    assert.equal(classifyHandPose(points), 'UNKNOWN')
    assert.deepEqual(getFingerExtensionReadings(points), [])
  }
  const points = hand()
  points[8] = { ...points[7] }
  assert.equal(classifyHandPose(points), 'UNKNOWN')
  assert.deepEqual(getFingerExtensionReadings(points), [])
})

test('uncertainty immediately clears confirmed pose and requires fresh confirmation', () => {
  const filter = new HandPoseStabilizer(150)
  assert.equal(filter.update('OPEN', 0), 'UNKNOWN')
  assert.equal(filter.update('OPEN', 150), 'OPEN')
  assert.equal(filter.update('UNKNOWN', 160), 'UNKNOWN')
  assert.equal(filter.update('OPEN', 170), 'UNKNOWN')
  assert.equal(filter.update('OPEN', 319), 'UNKNOWN')
  assert.equal(filter.update('OPEN', 320), 'OPEN')
})

test('an unconfirmed opposite pose never republishes the previous pose', () => {
  const filter = new HandPoseStabilizer(150)
  filter.update('OPEN', 0)
  filter.update('OPEN', 150)
  assert.equal(filter.update('FIST', 200), 'UNKNOWN')
  assert.equal(filter.update('FIST', 349), 'UNKNOWN')
  assert.equal(filter.update('FIST', 350), 'FIST')
})

test('retains exact angle bands and rejects contradictory, dead-band and invalid angles', () => {
  assert.equal(classifyFingerPose(145, 145), 'EXTENDED')
  assert.equal(classifyFingerPose(125, 125), 'CURLED')
  for (const [pip, dip] of [
    [144.9, 180], [180, 144.9], [125.1, 90], [90, 125.1],
    [135, 135], [180, 90], [90, 180], [NaN, 180], [90, Infinity], [-1, 90], [181, 180],
  ]) assert.equal(classifyFingerPose(pip, dip), 'UNKNOWN')
})

test('geometric angles remain unrounded until display, so rounding cannot cross a boundary', () => {
  const points = hand(144.9, 180)
  const features = getFingerFeatures(points)
  assert.ok(features)
  assert.ok(Math.abs(features[0].pipAngleDegrees - 144.9) < 1e-10)
  assert.equal(getFingerExtensionReadings(points)[0].pipAngleDegrees, 145)
  assert.equal(classifyHandPose(points), 'UNKNOWN')
})

test('measures both joints and normalized reach on analytic geometry', () => {
  const straight = getFingerFeatures(hand())
  const folded = getFingerFeatures(hand(90))
  assert.ok(straight && folded)
  assert.deepEqual(straight.map(finger => finger.finger), ['Index', 'Middle', 'Ring', 'Pinky'])
  for (const finger of straight) {
    assert.ok(Math.abs(finger.pipAngleDegrees - 180) < 1e-6)
    assert.ok(Math.abs(finger.dipAngleDegrees - 180) < 1e-6)
    assert.ok(Math.abs(finger.reachPercent - 100) < 1e-6)
  }
  for (const finger of folded) {
    assert.ok(Math.abs(finger.pipAngleDegrees - 90) < 1e-6)
    assert.ok(Math.abs(finger.dipAngleDegrees - 90) < 1e-6)
    assert.ok(Math.abs(finger.reachPercent - 100 / 3) < 1e-6)
  }
  assert.deepEqual(getFingerExtensionReadings(hand(90))[0], {
    finger: 'Index', pipAngleDegrees: 90, dipAngleDegrees: 90, reachPercent: 33,
  })
})

test('pose and geometric features survive rotation, reflection, translation and uniform scale', () => {
  const rotations = [0, 0.7, 1.6, 2.9]
  for (const [pip, dip, expected] of [
    [180, 180, 'OPEN'], [90, 90, 'FIST'], [180, 90, 'UNKNOWN'], [135, 135, 'UNKNOWN'],
  ] as const) {
    const original = hand(pip, dip)
    const originalFeatures = getFingerFeatures(original)!
    for (const scale of [0.00001, 0.2, 1, 100]) {
      for (const angle of rotations) {
        for (const mirror of [-1, 1]) {
          const points = original.map(({ x, y, z }) => {
            const rx = Math.cos(angle) * x - Math.sin(angle) * y
            const ry = Math.sin(angle) * x + Math.cos(angle) * y
            return {
              x: mirror * scale * rx + 0.1,
              y: scale * (Math.cos(angle) * ry - Math.sin(angle) * z) - 0.2,
              z: scale * (Math.sin(angle) * ry + Math.cos(angle) * z) + 0.3,
            }
          })
          assert.equal(classifyHandPose(points), expected)
          const features = getFingerFeatures(points)
          assert.ok(features)
          features.forEach((finger, index) => {
            for (const key of ['pipAngleDegrees', 'dipAngleDegrees', 'reachPercent'] as const) {
              assert.ok(Math.abs(finger[key] - originalFeatures[index][key]) < 1e-4, key)
            }
          })
        }
      }
    }
  }
})

test('every measured finger bone must have nonzero length', () => {
  for (const mcp of [5, 9, 13, 17]) {
    for (const joint of [mcp, mcp + 1, mcp + 2]) {
      const points = hand()
      points[joint + 1] = { ...points[joint] }
      assert.equal(classifyHandPose(points), 'UNKNOWN')
      assert.equal(getFingerFeatures(points), null)
      assert.deepEqual(getFingerExtensionReadings(points), [])
    }
  }
})

test('validates all 21 landmarks including unused thumb and sparse data', () => {
  assert.equal(hasValidHandLandmarks(hand()), true)
  for (let index = 0; index < 21; index++) {
    const points = hand()
    points[index].z = NaN
    assert.equal(hasValidHandLandmarks(points), false)
    assert.equal(classifyHandPose(points), 'UNKNOWN')
  }
  const sparse = hand()
  delete sparse[8]
  assert.equal(classifyHandPose(sparse), 'UNKNOWN')
  assert.equal(classifyHandPose(hand().slice(0, 20)), 'UNKNOWN')
  assert.equal(classifyHandPose([...hand(), { x: 0, y: 0, z: 0 }]), 'UNKNOWN')
})

test('reset clears confirmed and pending states before reacquisition', () => {
  const filter = new HandPoseStabilizer()
  filter.update('OPEN', 0)
  filter.update('OPEN', 150)
  filter.reset()
  assert.equal(filter.update('OPEN', 200), 'UNKNOWN')
  assert.equal(filter.update('OPEN', 350), 'OPEN')
  filter.update('FIST', 400)
  filter.reset()
  assert.equal(filter.update('FIST', 550), 'UNKNOWN')
  assert.equal(filter.update('FIST', 700), 'FIST')
})

test('alternating candidates and repeated timestamps cannot prematurely confirm', () => {
  const filter = new HandPoseStabilizer()
  for (const [pose, time] of [['OPEN', 0], ['FIST', 100], ['OPEN', 200], ['OPEN', 200]] as const) {
    assert.equal(filter.update(pose, time), 'UNKNOWN')
  }
  assert.equal(filter.update('OPEN', 349), 'UNKNOWN')
  assert.equal(filter.update('OPEN', 350), 'OPEN')
  assert.equal(filter.update('FIST', 400), 'UNKNOWN')
  assert.equal(filter.update('OPEN', 500), 'UNKNOWN')
  assert.equal(filter.update('OPEN', 650), 'OPEN')
})

test('invalid or backwards timestamps clear pose and confirmation history', () => {
  for (const invalid of [NaN, Infinity, -Infinity, 100]) {
    const filter = new HandPoseStabilizer()
    filter.update('OPEN', 0)
    filter.update('OPEN', 150)
    assert.equal(filter.update('OPEN', invalid), 'UNKNOWN')
    assert.equal(filter.update('OPEN', 200), 'UNKNOWN')
    assert.equal(filter.update('OPEN', 350), 'OPEN')
  }
})

test('supports deliberate zero confirmation and rejects invalid durations', () => {
  const filter = new HandPoseStabilizer(0)
  assert.equal(filter.update('OPEN', 0), 'OPEN')
  assert.equal(filter.update('UNKNOWN', 1), 'UNKNOWN')
  for (const duration of [-1, NaN, Infinity]) {
    assert.throws(() => new HandPoseStabilizer(duration), RangeError)
  }
})

test('landmark-to-pose pipeline fails closed and recovers after distorted fingertip data', () => {
  const filter = new HandPoseStabilizer()
  assert.equal(filter.update(classifyHandPose(hand()), 0), 'UNKNOWN')
  assert.equal(filter.update(classifyHandPose(hand()), 150), 'OPEN')
  const distorted = hand()
  distorted[8].x = NaN
  assert.equal(filter.update(classifyHandPose(distorted), 200), 'UNKNOWN')
  assert.equal(filter.update(classifyHandPose(hand(90)), 250), 'UNKNOWN')
  assert.equal(filter.update(classifyHandPose(hand(90)), 400), 'FIST')
})
