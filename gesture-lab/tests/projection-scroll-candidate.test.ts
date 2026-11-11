import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyProjectionScrollCandidate } from '../src/evaluation/ProjectionScrollCandidate.ts'
import { recognizeControlHand } from '../src/control/ControlRecognition.ts'
import { controlHand } from './fixtures/controlHand.ts'

const size = { width: 640, height: 480 }
function conflicting() {
  const hand = controlHand('OPEN'), folded = controlHand('FIST')
  for (let i=9;i<=12;i++) hand.worldLandmarks[i] = { ...folded.worldLandmarks[i] }
  assert.equal(recognizeControlHand(hand.worldLandmarks).pose, 'UNKNOWN')
  return hand
}

test('shadow proposal repairs one contradictory world finger only with four clear projected fingers', () => {
  const hand = conflicting()
  assert.equal(classifyProjectionScrollCandidate(hand.worldLandmarks, hand.landmarks, size), 'OPEN')
})

test('shadow proposal preserves complete world fist even when the image appears open', () => {
  assert.equal(classifyProjectionScrollCandidate(controlHand('FIST').worldLandmarks, controlHand('OPEN').landmarks, size), 'FIST')
})

test('shadow proposal rejects fewer than three world extensions or any unclear projected finger', () => {
  assert.equal(classifyProjectionScrollCandidate(controlHand('PARTIAL').worldLandmarks, controlHand('OPEN').landmarks, size), 'UNKNOWN')
  const hand = conflicting()
  const curled = controlHand('FIST').landmarks
  assert.equal(classifyProjectionScrollCandidate(hand.worldLandmarks, curled, size), 'UNKNOWN')
  assert.equal(classifyProjectionScrollCandidate(hand.worldLandmarks, hand.landmarks, { width: 0, height: 480 }), 'UNKNOWN')
  assert.equal(classifyProjectionScrollCandidate(hand.worldLandmarks), 'UNKNOWN')
})

test('shadow proposal leaves all known baseline poses and input coordinates unchanged', () => {
  for (const pose of ['OPEN','FIST'] as const) {
    const hand = controlHand(pose), before = structuredClone(hand)
    assert.equal(classifyProjectionScrollCandidate(hand.worldLandmarks, hand.landmarks, size), pose)
    assert.deepEqual(hand, before)
  }
})
