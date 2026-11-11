import test from 'node:test'
import assert from 'node:assert/strict'
import { SpatialInteractionEngine } from '../src/spatial/SpatialInteractionEngine.ts'
import { AdaptivePointerFilter } from '../src/control/AdaptivePointerFilter.ts'
import { TOUCHPAD_GESTURE_CONFIG } from '../src/control/GestureConfig.ts'
import type { Point2, TrackedHand } from '../src/control/types.ts'
import type { SpatialInput, SpatialScenePort, Vec3 } from '../src/spatial/types.ts'

function input(time: number, pose: TrackedHand['pose'] = 'OPEN', x = .5, y = .5, relative = 0): SpatialInput {
  return {
    timestampMs: time, receivedAt: time,
    hands: [{ id: 1, center: { x, y }, pose, orientation: 'TRANSITION', timestampMs: time }],
    ambiguous: false, viewport: { width: 1000, height: 700 },
    base: { pointer: { x: 500, y: 350 }, focusId: null, confirmed: true, scrollActive: false, scrollEntering: false },
    depth: { valid: true, scale: .2, relative, neutralScale: .2, quality: 'valid', reason: 'test' },
  }
}

function fixture() {
  let position: Vec3 = { x: 0, y: 0, z: 0 }, ownerToken = 1
  const rect = { left: 0, top: 0, width: 1000, height: 700 }
  const writes: Vec3[] = []
  let eligible = true, projectable = true
  const port: SpatialScenePort = {
    // Front face at z=.5; projection is deterministic and deliberately depth-dependent.
    pick: pointer => eligible && pointer.x >= 400 && pointer.x <= 600 && pointer.y >= 250 && pointer.y <= 450
      ? { id: 'cube', ownerToken, point: { x: (pointer.x - 500) / 100, y: (350 - pointer.y) / 100, z: .5 }, position: { ...position } } : null,
    planePoint: (pointer, z) => projectable ? { x: (pointer.x - 500) / 100 * (1 + (z - .5) / 10), y: (350 - pointer.y) / 100 * (1 + (z - .5) / 10), z } : null,
    getPosition: () => ({ ...position }),
    setPosition: point => { position = { ...point }; writes.push({ ...point }) },
    getOwnerToken: () => ownerToken,
    getRect: () => ({ ...rect }),
    bounds: { min: { x: -3, y: -2, z: -2 }, max: { x: 3, y: 2, z: 2 } },
  }
  const engine = new SpatialInteractionEngine(port)
  return {
    engine, port, rect, writes,
    position: () => ({ ...position }),
    changeOwner: () => { ownerToken++ },
    noHit: () => { eligible = false },
    noPlane: () => { projectable = false },
  }
}
type Fixture = ReturnType<typeof fixture>

function arm(f: Fixture, pointer: Point2 = { x: 500, y: 350 }) {
  for (const time of [0, 50, 100, 150]) {
    const sample = input(time); sample.base.pointer = { ...pointer }; f.engine.update(sample)
  }
  assert.equal(f.engine.snapshot.ready, true, 'fixture must actually arm before exercising closure')
}
function grab(f: Fixture, pointer?: Point2, depth = 0) {
  arm(f, pointer)
  for (const time of [200, 250, 300, 350, 400]) f.engine.update(input(time, 'FIST', .5, .5, depth))
  assert.equal(f.engine.snapshot.state, 'GRABBING_3D', 'fixture must actually grab before exercising safety')
  f.engine.tick(400)
}
function near(actual: number, expected: number, tolerance = 1e-8) { assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`) }

test('confirmed OPEN actual ray hit must be stable for 150ms; no effect before confirmation', () => {
  const f = fixture()
  for (const time of [0, 50, 100, 149]) {
    const snapshot = f.engine.update(input(time))
    assert.equal(snapshot.state, 'TARGET_FOCUSED'); assert.equal(snapshot.ready, false); assert.equal(snapshot.exclusive, false)
  }
  const ready = f.engine.update(input(150)); assert.equal(ready.ready, true); assert.equal(ready.selectedId, 'cube')
  assert.equal(f.engine.wouldConsume('OPEN'), false); assert.equal(f.engine.wouldConsume('FIST'), true); assert.equal(f.engine.wouldConsume('UNKNOWN'), true)
  assert.deepEqual(f.writes, [])
})

test('first FIST or render time cannot complete an unfinished observed OPEN dwell', () => {
  const f = fixture()
  f.engine.update(input(0)); f.engine.update(input(100)); assert.equal(f.engine.tick(150).snapshot.ready, false)
  assert.equal(f.engine.wouldConsume('FIST'), false)
  for (const time of [150, 200, 250, 300, 350, 400]) assert.notEqual(f.engine.update(input(time, 'FIST')).state, 'GRABBING_3D')
  assert.deepEqual(f.writes, [])
})

test('ordinary no-hit, unconfirmed pointer, HTML focus, scrolling and initial FIST are no-ops', () => {
  for (const block of ['no-hit', 'unconfirmed', 'HTML', 'scroll', 'entry', 'FIST', 'UNKNOWN'] as const) {
    const f = fixture(); if (block === 'no-hit') f.noHit()
    for (let time = 0; time <= 800; time += 50) {
      const sample = input(time, block === 'UNKNOWN' ? 'UNKNOWN' : block === 'FIST' || time > 150 ? 'FIST' : 'OPEN')
      if (block === 'unconfirmed') sample.base.confirmed = false
      if (block === 'HTML') sample.base.focusId = 'html-button'
      if (block === 'scroll') sample.base.scrollActive = true
      if (block === 'entry') sample.base.scrollEntering = true
      const before = structuredClone(sample)
      const snapshot = f.engine.update(sample)
      assert.equal(snapshot.exclusive, false, block); assert.equal(f.engine.wouldConsume(sample.hands[0].pose), false, block)
      assert.deepEqual(sample, before, block); assert.equal(f.engine.tick(time).retainedPointer, null, block)
    }
    assert.deepEqual(f.writes, [], block)
  }
})

test('full FIST requires 200ms source dwell, permits any orientation and never translates closure motion', () => {
  const f = fixture(); arm(f)
  for (const time of [200, 250, 300, 350, 399]) {
    const sample = input(time, 'FIST', .53, .52, .5); sample.base.confirmed = false; sample.base.pointer = null
    const result = f.engine.update(sample)
    assert.equal(result.state, 'GRAB_PENDING'); assert.equal(result.exclusive, true); assert.equal(f.engine.wouldConsume('OPEN'), true)
    f.engine.tick(time); assert.deepEqual(f.writes, [])
  }
  f.engine.update(input(400, 'FIST', .53, .52, .5)); assert.equal(f.engine.snapshot.state, 'GRABBING_3D')
  f.engine.tick(400); assert.deepEqual(f.position(), { x: 0, y: 0, z: 0 }); assert.deepEqual(f.writes, [])
  f.engine.update(input(450, 'FIST', .53, .52, .5)); f.engine.tick(475)
  assert.deepEqual(f.position(), { x: 0, y: 0, z: 0 })
})

test('bounded UNKNOWN closes without effects and restarts full-fist confirmation', () => {
  const f = fixture(); arm(f)
  for (const [time, pose] of [[200, 'UNKNOWN'], [250, 'FIST'], [300, 'UNKNOWN'], [350, 'FIST'], [400, 'FIST'], [450, 'FIST'], [500, 'FIST']] as const) {
    assert.equal(f.engine.update(input(time, pose)).state, 'GRAB_PENDING'); f.engine.tick(time)
  }
  assert.deepEqual(f.writes, []); assert.equal(f.engine.update(input(550, 'FIST')).state, 'GRABBING_3D')
})

test('UNKNOWN timeout and excessive closure palm travel require new confirmed OPEN', () => {
  for (const rejection of ['timeout', 'travel'] as const) {
    const f = fixture(); arm(f)
    if (rejection === 'timeout') for (let time = 200; time <= 600; time += 50) f.engine.update(input(time, 'UNKNOWN'))
    else f.engine.update(input(200, 'FIST', .581))
    for (let time = 650; time <= 1000; time += 50) assert.notEqual(f.engine.update(input(time, 'FIST')).state, 'GRABBING_3D')
    const unconfirmed = input(1050); unconfirmed.base.confirmed = false
    assert.equal(f.engine.update(unconfirmed).ready, false)
    assert.equal(f.engine.update(input(1100)).ready, false)
    for (const time of [1150, 1200]) f.engine.update(input(time))
    assert.equal(f.engine.update(input(1250)).ready, true)
    assert.deepEqual(f.writes, [])
  }
})

test('grab preserves off-center ray grip offset and captures current object position', () => {
  const f = fixture(); grab(f, { x: 550, y: 325 }, .7)
  assert.deepEqual(f.position(), { x: 0, y: 0, z: 0 })
  f.engine.update(input(450, 'FIST', .5, .5, .7)); f.engine.tick(500)
  assert.deepEqual(f.position(), { x: 0, y: 0, z: 0 }); assert.deepEqual(f.writes, [])
})

test('XY motion is mirrored, relative, uses accepted gain/range and adaptive pixel filtering', () => {
  const f = fixture(); grab(f)
  const oracle = new AdaptivePointerFilter({ baselineTimeConstantMs: 140 })
  oracle.update({ x: 500, y: 350 }, 400, 400)
  const observation = input(450, 'FIST', .465, .535)
  f.engine.update(observation); assert.deepEqual(f.writes, [], 'source update never writes transform')
  // .035/.35*1.6 -> .16 of viewport: +160px X, +112px Y.
  oracle.update({ x: 660, y: 462 }, 450, 450)
  f.engine.tick(450); assert.deepEqual(f.writes, [], 'new target cannot act retroactively')
  const expected = oracle.update({ x: 660, y: 462 }, 450, 475)
  const snapshot = f.engine.tick(475).snapshot
  assert.ok(snapshot.filteredPalm); near(snapshot.filteredPalm.x, expected.x); near(snapshot.filteredPalm.y, expected.y)
  near(f.position().x, (expected.x - 500) / 100); near(f.position().y, (350 - expected.y) / 100)
  assert.ok(f.position().x > 0 && f.position().y < 0)
})

test('depth is relative to confirmed fist; all three axes translate concurrently', () => {
  const f = fixture(); grab(f, undefined, .8)
  f.engine.update(input(450, 'FIST', .48, .52, .9)); f.engine.tick(475)
  const point = f.position(); assert.ok(point.x > 0 && point.y < 0 && point.z > 0)
  assert.ok(point.z < .3, 'filter must not overshoot requested relative-depth delta')
})

test('invalid depth freezes last rendered Z immediately while XY remains live', () => {
  const f = fixture(); grab(f)
  f.engine.update(input(450, 'FIST', .48, .5, .2)); const before = f.engine.tick(475).snapshot.position
  const invalid = input(500, 'FIST', .46, .5, 100); invalid.depth.valid = false
  f.engine.update(invalid); f.engine.tick(525)
  near(f.position().z, before.z); assert.ok(f.position().x > before.x)
  const recovery = input(550, 'FIST', .46, .5, 7)
  f.engine.update(recovery); f.engine.tick(575); near(f.position().z, before.z)
  f.engine.update(input(600, 'FIST', .46, .5, 7.1)); f.engine.tick(625); assert.ok(f.position().z > before.z)
})

test('first reliable depth after a depthless grab anchors without any Z jump', () => {
  const f = fixture(); arm(f)
  for (const time of [200, 250, 300, 350, 400]) { const sample = input(time, 'FIST'); sample.depth.valid = false; f.engine.update(sample) }
  assert.equal(f.engine.snapshot.state, 'GRABBING_3D'); f.engine.tick(400)
  f.engine.update(input(450, 'FIST', .48, .5, 8)); f.engine.tick(475)
  near(f.position().z, 0); assert.ok(f.position().x > 0)
  f.engine.update(input(500, 'FIST', .48, .5, 8.1)); f.engine.tick(525); assert.ok(f.position().z > 0)
})

test('repeated RAF renders never reapply a camera hand delta or replay a transform', () => {
  const f = fixture(); grab(f)
  f.engine.update(input(450, 'FIST', .465)); f.engine.tick(450); f.engine.tick(475)
  const writes = f.writes.length, current = f.position()
  f.engine.tick(475); assert.equal(f.writes.length, writes); assert.deepEqual(f.position(), current)
  f.engine.tick(500); f.engine.tick(525)
  assert.ok(f.position().x > current.x && f.position().x < 1.6)
})

test('render subdivision does not change filtered trajectory of held source observations', () => {
  const coarse = fixture(), fine = fixture(); grab(coarse); grab(fine)
  coarse.engine.update(input(450, 'FIST', .465, .535, .2)); fine.engine.update(input(450, 'FIST', .465, .535, .2))
  coarse.engine.tick(550)
  for (const time of [450, 470, 490, 510, 530, 550]) fine.engine.tick(time)
  near(coarse.position().x, fine.position().x); near(coarse.position().y, fine.position().y); near(coarse.position().z, fine.position().z)
})

test('release drops unapplied filter tail, keeps object still and hands off rendered pointer once', () => {
  const f = fixture(); grab(f)
  f.engine.update(input(450, 'FIST', .465)); const moved = f.engine.tick(475).snapshot
  assert.ok(moved.filteredPalm && moved.position.x > 0)
  const last = f.position(), writeCount = f.writes.length
  f.engine.update(input(500, 'FIST', .43)); // Publish more motion, but do not render it.
  const release = f.engine.update(input(550))
  assert.equal(release.state, 'RELEASING'); assert.equal(release.exclusive, false)
  assert.deepEqual(f.engine.tick(550).retainedPointer, moved.filteredPalm)
  assert.equal(f.engine.tick(550).retainedPointer, null)
  assert.deepEqual(f.position(), last); assert.equal(f.writes.length, writeCount)
  for (const time of [600, 650, 700, 750, 800]) assert.notEqual(f.engine.update(input(time, 'FIST')).state, 'GRABBING_3D')
})

test('unsafe source observations cancel ownership, do not write, and block held-fist regrab', () => {
  for (const fault of ['UNKNOWN', 'missing', 'two-hands', 'ambiguous', 'identity', 'owner', 'viewport', 'canvas', 'stale', 'gap', 'HTML', 'scroll', 'entry', 'mismatched-hand-time'] as const) {
    const f = fixture(); grab(f)
    const sample = input(fault === 'gap' ? 601 : 450, 'FIST', .465)
    if (fault === 'UNKNOWN') sample.hands[0].pose = 'UNKNOWN'
    if (fault === 'missing') sample.hands = []
    if (fault === 'two-hands') sample.hands = [sample.hands[0], { ...sample.hands[0], id: 2 }]
    if (fault === 'ambiguous') sample.ambiguous = true
    if (fault === 'identity') sample.hands[0].id = 2
    if (fault === 'owner') f.changeOwner()
    if (fault === 'viewport') sample.viewport.width++
    if (fault === 'canvas') f.rect.left++
    if (fault === 'stale') { sample.timestampMs = 400; sample.hands[0].timestampMs = 400 }
    if (fault === 'HTML') sample.base.focusId = 'button'
    if (fault === 'scroll') sample.base.scrollActive = true
    if (fault === 'entry') sample.base.scrollEntering = true
    if (fault === 'mismatched-hand-time') sample.hands[0].timestampMs--
    assert.equal(f.engine.update(sample).exclusive, false, fault)
    assert.deepEqual(f.engine.tick(sample.receivedAt).retainedPointer, { x: 500, y: 350 }, fault)
    assert.deepEqual(f.writes, [], fault)
    for (const time of [650, 700, 750, 800, 850]) assert.notEqual(f.engine.update(input(time, 'FIST')).state, 'GRABBING_3D', fault)
  }
})

test('stale RAF, owner or canvas mutation between camera frames cancels before writing', () => {
  for (const fault of ['stale', 'owner', 'canvas'] as const) {
    const f = fixture(); grab(f); f.engine.update(input(450, 'FIST', .465))
    if (fault === 'owner') f.changeOwner()
    if (fault === 'canvas') f.rect.width++
    const result = f.engine.tick(fault === 'stale' ? 651 : 475)
    assert.equal(result.snapshot.exclusive, false, fault)
    assert.deepEqual(result.retainedPointer, { x: 500, y: 350 }, fault); assert.deepEqual(f.writes, [], fault)
  }
})

test('projection failure cancels without a transform; X/Y/Z remain inside scene bounds', () => {
  const missing = fixture(); grab(missing); missing.engine.update(input(450, 'FIST', .465)); missing.noPlane()
  assert.equal(missing.engine.tick(475).snapshot.exclusive, false); assert.deepEqual(missing.writes, [])
  const f = fixture(); grab(f)
  for (let time = 450; time <= 1200; time += 50) { f.engine.update(input(time, 'FIST', 0, 1, 100)); f.engine.tick(time) }
  for (const p of f.writes) assert.ok(p.x >= -3 && p.x <= 3 && p.y >= -2 && p.y <= 2 && p.z >= -2 && p.z <= 2)
  assert.ok(f.position().x > 0 && f.position().y < 0 && f.position().z > 0)
})

test('configuration cancels only own session and resets clutch without tail or aliased state', () => {
  const f = fixture(); grab(f); f.engine.update(input(450, 'FIST', .465)); const moved = f.engine.tick(475).snapshot
  const pointer = { ...moved.filteredPalm! }; moved.position.x = -999; moved.filteredPalm!.x = -999
  f.engine.configure({ ...TOUCHPAD_GESTURE_CONFIG, pointerGain: 2 })
  assert.equal(f.engine.snapshot.exclusive, false); assert.deepEqual(f.engine.tick(500).retainedPointer, pointer)
  assert.ok(f.position().x > 0); assert.notEqual(f.engine.snapshot.position.x, -999)
})

test('source receipt latency cannot advance source gesture dwell', () => {
  const f = fixture()
  for (const time of [0, 50, 100, 149]) { const sample = input(time); sample.receivedAt += 150; assert.equal(f.engine.update(sample).ready, false) }
  const ready = input(150); ready.receivedAt += 150; assert.equal(f.engine.update(ready).ready, true)
  for (const time of [200, 250, 300, 350, 399]) { const sample = input(time, 'FIST'); sample.receivedAt += 150; assert.notEqual(f.engine.update(sample).state, 'GRABBING_3D') }
  const full = input(400, 'FIST'); full.receivedAt += 150; assert.equal(f.engine.update(full).state, 'GRABBING_3D')
  assert.deepEqual(f.writes, [])
})
