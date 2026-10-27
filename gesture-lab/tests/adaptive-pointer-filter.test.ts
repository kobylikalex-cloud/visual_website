import test from 'node:test'
import assert from 'node:assert/strict'
import { AdaptivePointerFilter } from '../src/control/AdaptivePointerFilter.ts'

type Point = { x: number; y: number }
const near = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`)

function trace(sourceHz: number, renderHz: number, sample: (index: number) => Point, durationMs: number) {
  const filter = new AdaptivePointerFilter()
  const points: { time: number; point: Point; baseline: Point; raw: Point }[] = []
  let target = sample(0)
  let baseline = { ...target }
  let previousTime = 0
  for (let frame = 0; frame <= durationMs * renderHz / 1000; frame++) {
    const time = frame * 1000 / renderHz
    const index = Math.floor(time * sourceHz / 1000 + 1e-8)
    const alpha = -Math.expm1(-(time - previousTime) / 140)
    baseline = { x: baseline.x + alpha * (target.x - baseline.x), y: baseline.y + alpha * (target.y - baseline.y) }
    target = sample(index)
    const point = filter.update(target, index * 1000 / sourceHz, time)
    points.push({ time, point, baseline: { ...baseline }, raw: target })
    previousTime = time
  }
  return points
}

test('a coarse 160px move reaches 90% in under 180ms at camera and display cadences', () => {
  for (const sourceHz of [17, 30]) for (const renderHz of [60, 120]) {
    const points = trace(sourceHz, renderHz, index => ({ x: index === 0 ? 0 : 160, y: 0 }), 1000)
    const onset = points.find(entry => entry.raw.x === 160)!.time
    const reached = points.find(entry => entry.point.x >= 144)
    assert.ok(reached, `${sourceHz}/${renderHz}: never reached90%`)
    assert.ok(reached.time - onset < 180, `${sourceHz}/${renderHz}: ${reached.time - onset}ms`)
    const baselineReached = points.find(entry => entry.baseline.x >= 144)!
    assert.ok(reached.time < baselineReached.time / 2, 'response should substantially improve on140ms baseline')
    let previous = 0
    for (const entry of points) {
      assert.ok(entry.point.x >= previous && entry.point.x <= 160, 'step must converge without overshoot')
      assert.equal(entry.point.y, 0)
      previous = entry.point.x
    }
  }
})

test('small stationary noise retains suppression close to the 140ms baseline', () => {
  for (const sourceHz of [17, 30]) for (const renderHz of [60, 120]) {
    const points = trace(sourceHz, renderHz, index => ({
      x: 500 + .75 * Math.sin(index * 2.1) + .25 * Math.sin(index * .73),
      y: 400 + .5 * Math.sin(index * 1.7),
    }), 10000).filter(entry => entry.time >= 2000)
    const rms = (select: (entry: typeof points[number]) => Point) => Math.sqrt(points.reduce((sum, entry) => {
      const point = select(entry)
      return sum + (point.x - 500) ** 2 + (point.y - 400) ** 2
    }, 0) / points.length)
    const filtered = rms(entry => entry.point)
    const baseline = rms(entry => entry.baseline)
    assert.ok(filtered <= baseline * 1.1, `${sourceHz}/${renderHz}: ${filtered} vs${baseline}`)
    assert.ok(filtered < rms(entry => entry.raw) / 2, 'suppress at least half of stationary RMS noise')
  }
})

test('repeated source samples do not re-estimate velocity or change their held target', () => {
  const sparse = new AdaptivePointerFilter()
  const frequent = new AdaptivePointerFilter()
  for (const filter of [sparse, frequent]) {
    filter.update({ x: 0, y: 0 }, 0, 0)
    filter.update({ x: 160, y: 80 }, 50, 50)
  }
  for (let time = 60; time < 250; time += 10) frequent.update({ x: -900, y: -900 }, 50, time)
  const actual = frequent.update({ x: -900, y: -900 }, 50, 250)
  const expected = sparse.update({ x: 160, y: 80 }, 50, 250)
  near(actual.x, expected.x); near(actual.y, expected.y)
})

test('stationary lowpass has the configured 140ms time constant independently of RAF timestep', () => {
  for (const renderMs of [5, 10, 20, 35, 140]) {
    const filter = new AdaptivePointerFilter({ beta: 0 })
    filter.update({ x: 0, y: 0 }, 0, 0)
    filter.update({ x: 100, y: 50 }, 10, 10)
    for (let time = 10 + renderMs; time < 150; time += renderMs) filter.update({ x: 100, y: 50 }, 10, time)
    const result = filter.update({ x: 100, y: 50 }, 10, 150)
    // One time constant reaches1-e^-1 of the held target.
    near(result.x, 63.212055882855765); near(result.y, 31.60602794142788)
  }
})

test('new measurements never move output before their publication time', () => {
  const filter = new AdaptivePointerFilter()
  filter.update({ x: 10, y: 20 }, 0, 0)
  assert.deepEqual(filter.update({ x: 170, y: 100 }, 60, 105), { x: 10, y: 20 })
  const output = filter.update({ x: 170, y: 100 }, 60, 115)
  assert.ok(output.x > 10 && output.x < 170)
  near((output.x - 10) / (output.y - 20), 2)
})

test('stale sources cannot rewind the accepted target and backward render timestamps are ignored', () => {
  const filter = new AdaptivePointerFilter({ beta: 0 })
  filter.update({ x: 0, y: 0 }, 0, 0)
  filter.update({ x: 100, y: 100 }, 10, 10)
  const before = filter.update({ x: 100, y: 100 }, 10, 50)
  assert.deepEqual(filter.update({ x: -500, y: -500 }, 20, 40), before)
  const after = filter.update({ x: -500, y: -500 }, 5, 150)
  near(after.x, 63.212055882855765); near(after.y, after.x)
})

test('reset discards position, target, derivative and both clocks', () => {
  const filter = new AdaptivePointerFilter()
  filter.update({ x: 0, y: 0 }, 0, 0)
  filter.update({ x: 300, y: 100 }, 30, 30)
  filter.update({ x: 300, y: 100 }, 30, 60)
  filter.reset()
  const point = { x: 12, y: 13 }
  const result = filter.update(point, 0, 0)
  assert.deepEqual(result, point)
  point.x = -100; result.y = -100
  assert.deepEqual(filter.update({ x: 12, y: 13 }, 0, 100), { x: 12, y: 13 })
})

test('nonfinite samples and invalid tuning fail before changing valid filter state', () => {
  for (const options of [{ beta: -1 }, { beta: Infinity }, { baselineTimeConstantMs: 0 },
    { baselineTimeConstantMs: NaN }, { derivativeCutoffHz: 0 }, { derivativeCutoffHz: Infinity }]) {
    assert.throws(() => new AdaptivePointerFilter(options), RangeError)
  }
  const filter = new AdaptivePointerFilter({ beta: 0 })
  filter.update({ x: 0, y: 0 }, 0, 0)
  filter.update({ x: 100, y: 100 }, 10, 10)
  for (const [point, source, render] of [[{ x: NaN, y: 0 }, 20, 20], [{ x: 0, y: Infinity }, 20, 20],
    [{ x: 0, y: 0 }, NaN, 20], [{ x: 0, y: 0 }, 20, Infinity]] as [Point, number, number][]) {
    assert.throws(() => filter.update(point, source, render), RangeError)
  }
  near(filter.update({ x: 100, y: 100 }, 10, 150).x, 63.212055882855765)
})

test('a long render pause converges finitely without extrapolation', () => {
  const filter = new AdaptivePointerFilter()
  filter.update({ x: 0, y: 100 }, 0, 0)
  filter.update({ x: 160, y: 20 }, 50, 50)
  assert.deepEqual(filter.update({ x: 160, y: 20 }, 50, 100000), { x: 160, y: 20 })
})

test('finite inputs that overflow derived cutoff or velocity are rejected without poisoning state', () => {
  for (const baselineTimeConstantMs of [Number.MIN_VALUE, Number.MAX_VALUE]) {
    assert.throws(() => new AdaptivePointerFilter({ baselineTimeConstantMs }), RangeError)
  }
  const filter = new AdaptivePointerFilter({ beta: Number.MAX_VALUE })
  filter.update({ x: 0, y: 0 }, 0, 0)
  assert.throws(() => filter.update({ x: 160, y: 80 }, 50, 50), RangeError)
  assert.deepEqual(filter.update({ x: 0, y: 0 }, 0, 100), { x: 0, y: 0 })
  assert.throws(() => filter.update({ x: Number.MAX_VALUE, y: 0 }, Number.MIN_VALUE, 100), RangeError)
  assert.deepEqual(filter.update({ x: 0, y: 0 }, 0, 200), { x: 0, y: 0 })
})
