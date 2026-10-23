import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HandTracker } from '../src/control/HandTracker.ts'
import { recognizeControlHand } from '../src/control/ControlRecognition.ts'
import { getFingerFeatures } from '../src/gestures/FingerGeometry.ts'
import type { Detection } from '../src/control/types.ts'
import type { Point3D } from '../src/gestures/TrackingQuality.ts'

// Analytic bones, with a nondegenerate wrist/MCP palm matching image anatomy.
function world(pip = 165, dip = 150, lengths = [0.03, 0.03, 0.02]): Point3D[] {
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
  return points
}

function detection(x: number, y = 0.5, handedness = 'Left', points = world()): Detection {
  return {
    worldLandmarks: points,
    landmarks: points.map(p => ({ x: x + p.x, y: y + p.y + 0.04, z: p.z })),
    handedness,
  }
}

test('tracks spatial identity through array reorder and handedness label flips', () => {
  const tracker = new HandTracker()
  const initial = tracker.update({ timestampMs: 0, detections: [detection(0.25), detection(0.75, 0.5, 'Right')] })
  assert.equal(initial.hands.length, 2)
  assert.notEqual(initial.hands[0].id, initial.hands[1].id)
  assert.ok(Math.abs(initial.hands[0].center.x - 0.25) < 1e-10)
  assert.ok(Math.abs(initial.hands[0].center.y - 0.5) < 1e-10)
  const next = tracker.update({ timestampMs: 50, detections: [detection(0.73, 0.5, 'Left'), detection(0.27, 0.5, 'Right')] })
  assert.deepEqual(next.hands.map(h => h.id), [initial.hands[1].id, initial.hands[0].id])
  assert.deepEqual(next.hands.map(h => h.pose), ['OPEN', 'OPEN'])
})

test('missing hands discard history and reacquire with a fresh identity', () => {
  const tracker = new HandTracker()
  const first = tracker.update({ timestampMs: 0, detections: [detection(0.25), detection(0.75)] }).hands
  const remaining = tracker.update({ timestampMs: 50, detections: [detection(0.74)] }).hands
  assert.equal(remaining[0].id, first[1].id)
  const restored = tracker.update({ timestampMs: 100, detections: [detection(0.26), detection(0.73)] }).hands
  assert.notEqual(restored[0].id, first[0].id)
  assert.equal(restored[1].id, first[1].id)
  assert.deepEqual(tracker.update({ timestampMs: 150, detections: [] }).hands, [])
  assert.notEqual(tracker.update({ timestampMs: 200, detections: [detection(0.73)] }).hands[0].id, first[1].id)
})

test('close palms and equally plausible assignments fail closed and erase identity', () => {
  for (const detections of [[detection(0.47), detection(0.53)], [detection(0.5)]]) {
    const tracker = new HandTracker()
    const first = tracker.update({ timestampMs: 0, detections: [detection(0.35), detection(0.65)] }).hands
    const bad = tracker.update({ timestampMs: 50, detections })
    assert.equal(bad.ambiguous, true)
    assert.deepEqual(bad.hands, [])
    const recovered = tracker.update({ timestampMs: 100, detections: [detection(0.35)] }).hands
    assert.equal(recovered.length, 1)
    assert.ok(first.every(h => h.id !== recovered[0].id))
  }
})

test('ambiguous two-to-two and one-to-two assignments cannot create identity swaps', () => {
  for (const [before, after] of [
    [[detection(0.4), detection(0.6)], [detection(0.5, 0.4), detection(0.5, 0.6)]],
    [[detection(0.5)], [detection(0.35), detection(0.65)]],
  ]) {
    const tracker = new HandTracker()
    assert.ok(tracker.update({ timestampMs: 0, detections: before }).hands.length > 0)
    const result = tracker.update({ timestampMs: 50, detections: after })
    assert.equal(result.ambiguous, true)
    assert.deepEqual(result.hands, [])
  }
})

test('motion passing too close between separated endpoints rejects the crossing frame', () => {
  const tracker = new HandTracker()
  assert.equal(tracker.update({ timestampMs: 0, detections: [detection(0.43), detection(0.57)] }).hands.length, 2)
  // Both endpoint separations exceed 0.12; simultaneous linear paths approach within 0.115.
  const result = tracker.update({ timestampMs: 50, detections: [detection(0.476, 0.4342), detection(0.524, 0.5658)] })
  assert.equal(result.ambiguous, true)
  assert.deepEqual(result.hands, [])
})

test('rejects implausible jumps, excessive counts, and stale or nonmonotonic frames', () => {
  for (const [timestampMs, detections] of [
    [50, [detection(0.9)]], [50, [detection(0.2), detection(0.5), detection(0.8)]],
    [251, [detection(0.2)]], [0, [detection(0.2)]], [-1, [detection(0.2)]],
    [NaN, [detection(0.2)]], [Infinity, [detection(0.2)]],
  ] as const) {
    const tracker = new HandTracker()
    tracker.update({ timestampMs: 0, detections: [detection(0.2)] })
    const result = tracker.update({ timestampMs, detections: [...detections] })
    assert.equal(result.ambiguous, true)
    assert.deepEqual(result.hands, [])
  }
})

test('malformed, sparse and degenerate geometry never produces usable hands', () => {
  for (const mutate of [
    (d: Detection) => { d.landmarks = [] },
    (d: Detection) => { d.worldLandmarks[8].x = NaN },
    (d: Detection) => { delete d.landmarks[8] },
    (d: Detection) => { d.worldLandmarks[8] = { ...d.worldLandmarks[7] } },
    (d: Detection) => { d.landmarks = d.landmarks.map(() => ({ x: 0.5, y: 0.5, z: 0 })) },
    (d: Detection) => { d.worldLandmarks[9] = { ...d.worldLandmarks[0] } },
  ]) {
    const bad = detection(0.5)
    mutate(bad)
    const result = new HandTracker().update({ timestampMs: 0, detections: [bad] })
    assert.equal(result.ambiguous, true)
    assert.deepEqual(result.hands, [])
  }
})

test('reset clears tracking while preserving uniqueness across resets', () => {
  const tracker = new HandTracker()
  const first = tracker.update({ timestampMs: 100, detections: [detection(0.5)] }).hands[0]
  tracker.reset()
  const next = tracker.update({ timestampMs: 0, detections: [detection(0.5)] }).hands[0]
  assert.notEqual(next.id, first.id)
})

test('recognizes observed open and flat bands without a DIP hard veto', () => {
  for (const [pip, dip] of [[142, 177], [165, 141], [125, 170]]) {
    const points = world(pip, dip)
    assert.equal(recognizeControlHand(points).pose, 'OPEN')
  }
  const flat = world(142, 177).map(({ x, y, z }) => ({ x, y: y * 0.5 - z * Math.sqrt(0.75), z: y * Math.sqrt(0.75) + z * 0.5 }))
  assert.deepEqual(recognizeControlHand(flat), { pose: 'OPEN', orientation: 'FLAT_LIKE' })
})

test('recognizes all-four short bent fingers as a fist despite DIP 127–128', () => {
  for (const [pip, dip] of [[77, 128], [90, 127]]) {
    const points = world(pip, dip, [0.03, 0.012, 0.03])
    const features = getFingerFeatures(points)!
    assert.ok(features.every(f => f.reachPercent >= 32 && f.reachPercent <= 44))
    assert.equal(recognizeControlHand(points).pose, 'FIST')
  }
})

test('mixed fingers and contradictory PIP/reach evidence remain UNKNOWN', () => {
  const mixed = world()
  mixed.splice(5, 4, ...world(90, 127, [0.03, 0.015, 0.03]).slice(5, 9))
  assert.equal(recognizeControlHand(mixed).pose, 'UNKNOWN')
  for (const points of [world(90, 180), world(180, 30), world(135, 90), []]) {
    assert.equal(recognizeControlHand(points).pose, 'UNKNOWN')
  }
})

test('raw uncertainty is immediate and not hidden by tracker stabilization', () => {
  const tracker = new HandTracker()
  const first = tracker.update({ timestampMs: 0, detections: [detection(0.5)] }).hands[0]
  const mixed = world()
  mixed.splice(5, 4, ...world(90, 127, [0.03, 0.015, 0.03]).slice(5, 9))
  const transition = mixed.map(({ x, y, z }) => ({ x, y: y * 0.8 - z * 0.6, z: y * 0.6 + z * 0.8 }))
  const next = tracker.update({ timestampMs: 50, detections: [detection(0.5, 0.5, 'Right', transition)] }).hands[0]
  assert.equal(next.id, first.id)
  assert.equal(next.pose, 'UNKNOWN')
  assert.equal(next.orientation, 'TRANSITION')
})
