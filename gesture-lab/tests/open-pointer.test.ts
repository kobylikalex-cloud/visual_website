import test from 'node:test'
import assert from 'node:assert/strict'
import { OpenPointerEngine } from '../src/control/OpenPointerEngine.ts'
import { DEFAULT_GESTURE_CONFIG } from '../src/control/GestureConfig.ts'
import type { InteractionFrame, TrackedHand } from '../src/control/types.ts'

const hand = (time: number, overrides: Partial<TrackedHand> = {}): TrackedHand => ({ id: 1, center: { x: .5, y: .5 }, pose: 'OPEN', orientation: 'UPRIGHT_LIKE', timestampMs: time, ...overrides })
const frame = (time: number, overrides: Partial<InteractionFrame> = {}): InteractionFrame => ({ timestampMs: time, hands: [hand(time)], ambiguous: false, reason: 'valid palm geometry', viewport: { width: 1000, height: 800 }, targets: [{ id: 'a', kind: 'click', rect: { left: 450, top: 350, width: 100, height: 100 } }], ...overrides })
const start = (engine: OpenPointerEngine) => { for (let t = 0; t <= 300; t += 50) engine.update(frame(t), t) }

test('only a continuously confirmed upright open palm moves and focuses a target', () => {
  const engine = new OpenPointerEngine()
  assert.equal(engine.update(frame(0), 0).pointer, null)
  assert.equal(engine.update(frame(100), 100).pointer, null)
  const result = engine.update(frame(150), 150)
  assert.equal(result.mode, 'POINTER')
  assert.deepEqual(result.pointer, { x: 500, y: 400 })
  assert.equal(result.focusId, 'a')
  assert.equal(engine.diagnostics.raw, 'OPEN')
  assert.equal(engine.diagnostics.confirmed, true)
})

test('fist and two hands never produce gesture actions or pointer movement', () => {
  for (const hands of [[hand(350, { pose: 'FIST' })], [hand(350), hand(350, { id: 2 })]]) {
    const engine = new OpenPointerEngine(); start(engine)
    const result = engine.update(frame(350, { hands }), 350)
    assert.equal(result.pointer, null)
    assert.equal(result.focusId, null)
    assert.equal(result.clickId, null); assert.equal(result.drag, null); assert.equal(result.scrollVelocity, 0)
  }
})

test('one uncertain pose freezes existing focus without moving, then expires without renewed open evidence', () => {
  const engine = new OpenPointerEngine(); start(engine)
  const unknown = engine.update(frame(350, { hands: [hand(350, { pose: 'UNKNOWN', center: { x: .4, y: .5 } })] }), 350)
  assert.equal(unknown.focusId, 'a'); assert.equal(unknown.pointer, null)
  assert.equal(engine.diagnostics.confirmed, false)
  assert.equal(engine.tick(451).focusId, null)
})

test('missing, ambiguous, identity replacement and stale deliveries clear focus immediately', () => {
  for (const overrides of [{ hands: [] }, { ambiguous: true, reason: 'crossing' }, { hands: [hand(350, { id: 2 })] }]) {
    const engine = new OpenPointerEngine(); start(engine)
    assert.equal(engine.update(frame(350, overrides), 350).focusId, null)
  }
  const engine = new OpenPointerEngine(); start(engine)
  assert.equal(engine.update(frame(350), 551).focusId, null)
  start(new OpenPointerEngine())
  assert.equal(engine.tick(1000).pointer, null)
})

test('freshness watchdog, cancellation and layout changes never retain a focus', () => {
  const engine = new OpenPointerEngine(); start(engine)
  assert.equal(engine.tick(300 + DEFAULT_GESTURE_CONFIG.freshnessMs + 1).focusId, null)
  const second = new OpenPointerEngine(); start(second)
  assert.equal(second.update(frame(350, { viewport: { width: 500, height: 800 } }), 350).pointer, null)
  assert.equal(second.cancel('Paused').focusId, null)
})

test('repeated uncertain frames cannot extend visual focus and a returning palm reconfirms', () => {
  const engine = new OpenPointerEngine(); start(engine)
  for (const t of [350, 400, 450]) engine.update(frame(t, { hands: [hand(t, { pose: 'UNKNOWN' })] }), t)
  assert.equal(engine.tick(451).focusId, null)
  assert.equal(engine.update(frame(500), 500).pointer, null)
  for (const t of [550, 600, 650]) engine.update(frame(t), t)
  assert.equal(engine.diagnostics.confirmed, true)
})

test('tiny palm noise preserves target focus while no gesture action ever appears', () => {
  const engine = new OpenPointerEngine(); start(engine)
  for (let t = 350; t < 2000; t += 33) {
    const result = engine.update(frame(t, { hands: [hand(t, { center: { x: .5 + Math.sin(t) * .002, y: .5 } })] }), t)
    assert.equal(result.focusId, 'a'); assert.equal(result.clickId, null)
    assert.equal(result.drag, null); assert.equal(result.scrollVelocity, 0)
  }
})

test('returning OPEN within the uncertainty hold keeps established focus while reconfirming', () => {
  const engine = new OpenPointerEngine(); start(engine)
  engine.update(frame(350, { hands: [hand(350, { pose: 'UNKNOWN' })] }), 350)
  const returning = engine.update(frame(383), 383)
  assert.equal(returning.focusId, 'a')
  assert.equal(returning.pointer, null)
  assert.equal(engine.tick(420).focusId, 'a')
})

test('confirmed open uses the freshness limit rather than the shorter uncertainty hold', () => {
  const engine = new OpenPointerEngine(); start(engine)
  assert.equal(engine.update(frame(350), 510).mode, 'POINTER')
  assert.equal(engine.tick(510).mode, 'POINTER')
  assert.equal(engine.tick(551).pointer, null)
})

test('initial open confirmation survives display ticks between fresh but delayed camera results', () => {
  const engine = new OpenPointerEngine()
  // 70 ms capture cadence + 95 ms delivery: at display time 160 the
  // first observation is fresh, but older than the 150 ms pose dwell.
  engine.update(frame(0), 95)
  engine.tick(160)
  engine.update(frame(70), 165)
  engine.tick(230)
  engine.update(frame(140), 235)
  engine.tick(300)
  const result = engine.update(frame(210), 305)
  assert.equal(result.mode, 'POINTER')
  assert.equal(result.focusId, 'a')
  assert.equal(engine.diagnostics.confirmed, true)
  assert.equal(engine.tick(411).pointer, null, 'real stale data still stops movement')
})
