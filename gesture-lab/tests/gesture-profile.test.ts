import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGestureProfile, readCalibrationSample, recognizeCalibratedHand,
  type CalibrationRecordings } from '../src/control/GestureProfile.ts'
import type { Point3D } from '../src/gestures/TrackingQuality.ts'

function hand(pip = 165, dip = 150, lengths = [0.03, 0.03, 0.02], flat = false): Point3D[] {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }))
  for (const [i, mcp] of [5, 9, 13, 17].entries()) {
    points[mcp] = { x: (i - 1.5) * 0.02, y: -0.05, z: 0 }
    let angle = 0
    for (let bone = 0; bone < 3; bone++) {
      if (bone === 1) angle += (180 - pip) * Math.PI / 180
      if (bone === 2) angle += (180 - dip) * Math.PI / 180
      const prev = points[mcp + bone]
      points[mcp + bone + 1] = {
        x: prev.x + lengths[bone] * Math.sin(angle),
        y: prev.y - lengths[bone] * Math.cos(angle), z: 0,
      }
    }
  }
  if (!flat) return points
  return points.map(({ x, y, z }) => ({
    x, y: y * 0.5 - z * Math.sqrt(0.75),
    z: y * Math.sqrt(0.75) + z * 0.5,
  }))
}

function examples(): CalibrationRecordings {
  const upright = readCalibrationSample(hand())!
  const fist = readCalibrationSample(hand(90, 127, [.03, .012, .03]))!
  const flat = readCalibrationSample(hand(165, 150, [.03, .03, .02], true))!
  return {
    OPEN_UPRIGHT: Array.from({ length: 8 }, () => upright),
    FIST: Array.from({ length: 8 }, () => fist),
    OPEN_FLAT: Array.from({ length: 8 }, () => flat),
  }
}

test('calibrated recognizer maps the three user-recorded postures', () => {
  const profile = buildGestureProfile(examples())
  assert.ok(profile)
  assert.deepEqual(recognizeCalibratedHand(hand(), profile), { pose: 'OPEN', orientation: 'UPRIGHT_LIKE' })
  assert.deepEqual(recognizeCalibratedHand(hand(165, 150, [.03, .03, .02], true), profile),
    { pose: 'OPEN', orientation: 'FLAT_LIKE' })
  assert.deepEqual(recognizeCalibratedHand(hand(90, 127, [.03, .012, .03]), profile),
    { pose: 'FIST', orientation: 'UPRIGHT_LIKE' })
})

test('calibration refuses too few observations or indistinguishable gestures', () => {
  const tooFew = examples()
  tooFew.FIST.length = 2
  assert.equal(buildGestureProfile(tooFew), null)
  const identical = examples()
  identical.OPEN_FLAT = identical.OPEN_UPRIGHT
  assert.equal(buildGestureProfile(identical), null)
  const identicalPose = examples()
  identicalPose.FIST = identicalPose.OPEN_UPRIGHT
  assert.equal(buildGestureProfile(identicalPose), null)
})

test('calibrated recognition rejects broken geometry and unknown profiles do not auto-click', () => {
  const profile = buildGestureProfile(examples())!
  assert.deepEqual(recognizeCalibratedHand([], profile), { pose: 'UNKNOWN', orientation: 'TRANSITION' })
  const invalid = hand()
  invalid[8].x = NaN
  assert.deepEqual(recognizeCalibratedHand(invalid, profile), { pose: 'UNKNOWN', orientation: 'TRANSITION' })
})
