import test from 'node:test'
import assert from 'node:assert/strict'
import { FistClickEngine } from '../src/control/FistClickEngine.ts'
import { OpenPointerEngine } from '../src/control/OpenPointerEngine.ts'
import { InteractionTargetRegistry } from '../src/control/InteractionTargetRegistry.ts'
import type { InteractionFrame, InteractionTarget, TrackedHand } from '../src/control/types.ts'
import { DEFAULT_GESTURE_CONFIG } from '../src/control/GestureConfig.ts'

const target: InteractionTarget = { id: 'test-0', kind: 'click', activationToken: 1, rect: { left: 450, top: 350, width: 100, height: 100 } }
const hand = (time: number, pose: TrackedHand['pose'] = 'OPEN', extra: Partial<TrackedHand> = {}): TrackedHand => ({ id: 1, center: { x: .5, y: .5 }, pose, orientation: 'UPRIGHT_LIKE', timestampMs: time, ...extra })
const frame = (time: number, pose: TrackedHand['pose'] = 'OPEN', extra: Partial<InteractionFrame> = {}): InteractionFrame => ({ timestampMs: time, hands: [hand(time, pose)], ambiguous: false, reason: 'valid palm', viewport: { width: 1000, height: 800 }, targets: [target], ...extra })
function setup() {
  const engine = new FistClickEngine()
  const events: string[] = []
  const feed = (time: number, pose: TrackedHand['pose'] = 'OPEN', extra: Partial<InteractionFrame> = {}, receipt = time) => {
    const result = engine.update(frame(time, pose, extra), receipt)
    if (result.activation) { events.push(result.activation.id); engine.acknowledge(result.activation.sequence, true, receipt) }
    return result
  }
  const open = (start = 0) => { for (let t = start; t <= start + 300; t += 50) feed(t) }
  const close = (start = 350) => { for (let t = start; t <= start + 200; t += 50) feed(t, 'FIST') }
  return { engine, events, feed, open, close }
}

test('no target, unregistered target, unconfirmed focus, starting fist and UNKNOWN alone never activate', () => {
  for (const scenario of ['no-target', 'unregistered', 'unconfirmed', 'fist', 'unknown']) {
    const { feed, events } = setup()
    for (let t = 0; t <= 1000; t += 50) {
      const pose = scenario === 'unknown' ? 'UNKNOWN' : scenario === 'fist' || t > (scenario === 'unconfirmed' ? 150 : 300) ? 'FIST' : 'OPEN'
      feed(t, pose, { targets: scenario === 'no-target' ? [] : scenario === 'unregistered' ? [{ ...target, activationToken: undefined }] : [target] })
    }
    assert.deepEqual(events, [], scenario)
  }
})

test('stable focus, full fist and confirmed reopening permit one click per gesture, never one per held frame', () => {
  const { engine, feed, open, close, events } = setup(); open()
  assert.equal(engine.clickDiagnostics.state, 'TARGET_FOCUSED')
  close(); assert.deepEqual(events, ['test-0'])
  for (let t = 600; t <= 1500; t += 50) { feed(t, 'FIST'); assert.equal(engine.tick(t).activation, null) }
  assert.deepEqual(events, ['test-0'])
  open(1550); close(1900)
  assert.deepEqual(events, ['test-0', 'test-0'])
  assert.equal(engine.clickDiagnostics.validClicks, 2)
})

test('confirmed reopening clears fist progress and releases the previous target lock', () => {
  const { engine, open, close } = setup(); open(); close(); open(600)
  assert.equal(engine.clickDiagnostics.progress, 0)
  assert.equal(engine.clickDiagnostics.targetLocked, false)
})

test('bounded closing uncertainty freezes original target and never independently clicks', () => {
  const { engine, open, feed, events } = setup(); open()
  for (const t of [350, 400, 450]) {
    const result = feed(t, 'UNKNOWN')
    assert.equal(result.focusId, 'test-0'); assert.equal(result.targetLocked, true)
    assert.equal(result.activation, null)
  }
  feed(500, 'FIST'); feed(550, 'FIST'); feed(600, 'FIST'); feed(650, 'FIST')
  assert.deepEqual(events, [])
  feed(700, 'FIST'); assert.deepEqual(events, ['test-0'])
  assert.equal(engine.clickDiagnostics.lastConfirmationMs, 200)
})

test('partial fist / repeated UNKNOWN expire once and cannot recover through a held fist', () => {
  const { engine, open, feed, events } = setup(); open()
  for (let t = 350; t <= 800; t += 50) feed(t, 'UNKNOWN')
  for (let t = 850; t <= 1400; t += 50) feed(t, 'FIST')
  assert.deepEqual(events, []); assert.equal(engine.clickDiagnostics.rejectedAttempts, 1)
  assert.equal(engine.clickDiagnostics.state, 'WAIT_FOR_RELEASE')
})

test('UNKNOWN interrupts fist evidence instead of counting toward full-fist confirmation', () => {
  const { open, feed, events } = setup(); open()
  feed(350, 'FIST'); feed(400, 'FIST'); feed(450, 'UNKNOWN')
  for (const t of [500, 550, 600, 650]) feed(t, 'FIST')
  assert.deepEqual(events, []); feed(700, 'FIST'); assert.deepEqual(events, ['test-0'])
})

test('identity, tracking, stale data, disabled/removed/replaced/moving targets and two hands cancel pending clicks', () => {
  const cases: [string, Partial<InteractionFrame>, number?][] = [
    ['identity', { hands: [hand(400, 'FIST', { id: 2 })] }],
    ['lost', { hands: [] }], ['ambiguous', { ambiguous: true, reason: 'ambiguous association' }],
    ['stale', {}, 601], ['source time', { hands: [hand(100, 'FIST')] }],
    ['disabled', { targets: [{ ...target, disabled: true }] }], ['removed', { targets: [] }],
    ['replaced', { targets: [{ ...target, activationToken: 2 }] }],
    ['layout', { targets: [{ ...target, rect: { ...target.rect, left: 530 } }] }],
    ['travel', { hands: [hand(400, 'FIST', { center: { x: .59, y: .5 } })] }],
    ['two hands', { hands: [hand(400, 'FIST'), hand(400, 'FIST', { id: 2 })] }],
    ['flat', { hands: [hand(400, 'FIST', { orientation: 'FLAT_LIKE' })] }],
  ]
  for (const [name, extra, receipt] of cases) {
    const { engine, open, feed, events } = setup(); open(); feed(350, 'UNKNOWN')
    feed(400, 'FIST', extra, receipt ?? 400)
    for (const t of [450, 500, 550, 600, 650, 700]) feed(t, 'FIST')
    assert.deepEqual(events, [], name); assert.equal(engine.clickDiagnostics.rejectedAttempts, 1, name)
  }
})

test('closing motion toward a neighbor can only activate the original locked target', () => {
  const { open, feed, events } = setup(); open()
  const neighbor = { ...target, id: 'test-1', activationToken: 2, rect: { ...target.rect, left: 551 } }
  for (let t = 350; t <= 550; t += 50) {
    const result = feed(t, 'FIST', { targets: [target, neighbor], hands: [hand(t, 'FIST', { center: { x: .47, y: .5 } })] })
    assert.equal(result.focusId, 'test-0')
  }
  assert.deepEqual(events, ['test-0'])
})

test('a target replaced or moved on the very first closing frame cannot inherit open-hand intent', () => {
  for (const replacement of [{ ...target, activationToken: 2 }, { ...target, rect: { ...target.rect, left: 460 } }]) {
    const { open, feed, events, engine } = setup(); open()
    for (let t = 350; t <= 700; t += 50) feed(t, 'FIST', { targets: [replacement] })
    assert.deepEqual(events, []); assert.equal(engine.clickDiagnostics.rejectedAttempts, 1)
  }
})

test('brief reopening does not release lockout and gain/config changes cannot resume a canceled fist', () => {
  const { engine, feed, open, close, events } = setup(); open(); close()
  feed(600, 'OPEN'); feed(650, 'OPEN')
  for (let t = 700; t <= 1000; t += 50) feed(t, 'FIST')
  assert.deepEqual(events, ['test-0'])
  open(1050); feed(1400, 'UNKNOWN')
  engine.configure({ ...DEFAULT_GESTURE_CONFIG, pointerGain: 2 })
  for (let t = 1450; t <= 1800; t += 50) feed(t, 'FIST')
  assert.deepEqual(events, ['test-0'])
})

test('watchdog and live target eligibility cancel without waiting for another camera result; ticks never activate', () => {
  for (const failure of ['watchdog', 'removed', 'disabled']) {
    const { engine, open, feed, events } = setup(); open(); feed(350, 'FIST'); feed(400, 'FIST')
    const result = failure === 'watchdog' ? engine.tick(601) : engine.tick(416, failure === 'removed' ? [] : [{ ...target, disabled: true }])
    assert.equal(result.activation, null); assert.equal(result.focusId, null)
    assert.equal(engine.clickDiagnostics.rejectedAttempts, 1)
    assert.deepEqual(events, [])
  }
})

test('open-only navigation and gain updates match Sprint 01.1 pointer outputs exactly', () => {
  const pointer = new OpenPointerEngine(), engine = new FistClickEngine()
  for (let t = 0; t <= 1800; t += 33) {
    const next = frame(t, 'OPEN', { hands: [hand(t, 'OPEN', { center: { x: .5 + Math.sin(t / 1000) * .08, y: .5 } })] })
    const actual = engine.update(next, t), reference = pointer.update(next, t)
    assert.deepEqual(actual.pointer, reference.pointer); assert.equal(actual.focusId, reference.focusId)
    assert.deepEqual(actual.proximity, reference.proximity)
  }
  const config = { ...DEFAULT_GESTURE_CONFIG, pointerGain: 2.5 }
  assert.deepEqual(engine.configure(config).pointer, pointer.configure(config).pointer)
  assert.deepEqual(engine.tick(1798).pointer, pointer.tick(1798).pointer)
})

test('registered actions reject stale tokens, disconnected/disabled owners, duplicates and arbitrary IDs', () => {
  const registry = new InteractionTargetRegistry()
  const owner = {}, replacement = {}; let eligible = true, count = 0
  const registration = registry.register('test-0', owner, () => eligible, () => count++)
  const request = { id: 'test-0', token: registration.token, sequence: 1 }
  assert.equal(registry.activate(request), true); assert.equal(registry.activate(request), false)
  eligible = false; assert.equal(registry.activate({ ...request, sequence: 2 }), false)
  eligible = true
  registry.register('test-0', replacement, () => true, () => count++)
  assert.equal(registry.activate({ ...request, sequence: 3 }), false)
  assert.equal(registry.activate({ ...request, id: 'arbitrary', sequence: 4 }), false)
  registration.unregister(); assert.equal(registry.tokenFor('test-0', owner), undefined)
  assert.equal(count, 1)
})
