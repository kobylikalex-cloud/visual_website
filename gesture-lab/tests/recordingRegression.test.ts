import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyFingerPose, type HandPose } from '../src/gestures/HandPoseEngine.ts'
import { classifyHybridReadings } from '../src/evaluation/HistoricalHybrid.ts'

// Rounded display readings manually transcribed from the authorized local recording.
// These are feature-level regressions, not reconstructed landmark fixtures or live rates.
const observations = [
  { second: 23, readings: [[157, 145, 91], [147, 173, 95], [155, 166, 96], [163, 159, 97]], strictRounded: 'OPEN', hybrid: 'OPEN' },
  { second: 24, readings: [[164, 141, 91], [142, 177, 95], [156, 170, 97], [164, 150, 95]], strictRounded: 'UNKNOWN', hybrid: 'OPEN' },
  { second: 26, readings: [[162, 143, 91], [145, 176, 95], [157, 168, 97], [165, 154, 96]], strictRounded: 'UNKNOWN', hybrid: 'OPEN' },
  { second: 36, readings: [[81, 128, 42], [83, 101, 33], [87, 113, 41], [104, 92, 39]], strictRounded: 'UNKNOWN', hybrid: 'FIST' },
  { second: 37, readings: [[79, 127, 43], [79, 107, 32], [90, 109, 41], [95, 100, 39]], strictRounded: 'UNKNOWN', hybrid: 'FIST' },
  { second: 38, readings: [[77, 128, 41], [77, 108, 32], [89, 110, 41], [94, 99, 38]], strictRounded: 'UNKNOWN', hybrid: 'FIST' },
] as const

test('observed rounded feature cases reproduce independent OPEN and FIST joint vetoes', () => {
  for (const observation of observations) {
    const fingers = observation.readings.map(([pip, dip]) => classifyFingerPose(pip, dip))
    const pose: HandPose = fingers.every(finger => finger === 'EXTENDED') ? 'OPEN'
      : fingers.every(finger => finger === 'CURLED') ? 'FIST' : 'UNKNOWN'
    assert.equal(pose, observation.strictRounded, `${observation.second}s conservative rounded features`)
    assert.equal(classifyHybridReadings(observation.readings.map(([pip, , reach]) => ({
      pipAngleDegrees: pip, reachPercent: reach,
    }))), observation.hybrid, `${observation.second}s hybrid rounded features`)
  }
})
