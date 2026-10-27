import test from 'node:test'
import assert from 'node:assert/strict'
import { PageScrollTarget, interruptsPageInput } from '../src/control/PageScrollTarget.ts'

function setup(top = 400, max = 2000) {
  const writes: number[] = []
  const target = new PageScrollTarget({ read: () => ({ top, max }), write: y => { top = y; writes.push(y) } })
  return { target, writes }
}

test('page effects scroll a bounded defined target and distinguish own from external movement', () => {
  const { target, writes } = setup()
  assert.equal(target.apply(20, 1000, 950), 20)
  assert.deepEqual(writes, [420])
  assert.equal(target.isOwnScroll(420, 1016), true)
  assert.equal(target.isOwnScroll(500, 1016), false)
  assert.equal(target.isOwnScroll(420, 1201), false)
  target.clear()
  assert.equal(target.isOwnScroll(420, 1020), false)
})

test('target clamps page edges and excessive steps without queueing or replaying stale effects', () => {
  const bottom = setup(1990)
  assert.equal(bottom.target.apply(40, 1000, 950), 10)
  assert.equal(bottom.target.apply(40, 1016, 950), 0)
  assert.deepEqual(bottom.writes, [2000])
  const top = setup(5)
  assert.equal(top.target.apply(-30, 1000, 950), -5)
  assert.equal(top.target.apply(-30, 1016, 950), 0)
  const step = setup()
  assert.equal(step.target.apply(5000, 1000, 950), 100)
  assert.equal(step.target.apply(40, 1201, 950), 0)
  assert.equal(step.target.apply(NaN, 1202, 1200), 0)
  assert.equal(step.target.apply(30, 1200, 1201), 0)
  assert.deepEqual(step.writes, [500])
})

test('slow scrolling accumulates fractional pixels on quantized targets and stops without residual replay', () => {
  let y = 100
  const target = new PageScrollTarget({ read: () => ({ top: y, max: 2000 }), write: next => { y = Math.round(next) } })
  for (let i = 0; i < 100; i++) target.apply(.49, i * 16, i * 16)
  assert.equal(y, 149, 'requested 49px is not lost to per-frame rounding')
  target.apply(.1, 1600, 1600)
  target.stop()
  target.apply(.1, 1616, 1616)
  assert.equal(y, 149, 'neutral discards fractional intent')
  for (let i = 0; i < 100; i++) target.apply(-.49, 1632 + i * 16, 1632 + i * 16)
  assert.equal(y, 100, 'reversal is symmetric, without a previous-direction jump')
  target.apply(.3, 3300, 3300)
  target.apply(.3, 3600, 3300) // expired capture clears carry
  target.apply(.3, 3616, 3616)
  assert.equal(y, 100)
})

test('native page input interrupts gestures while form-control activation preserves calibration evidence', () => {
  assert.equal(interruptsPageInput('keydown', ' ', true), false)
  assert.equal(interruptsPageInput('touchstart', '', true), false)
  assert.equal(interruptsPageInput('keydown', 'ArrowDown', true), false)
  assert.equal(interruptsPageInput('keydown', 'Enter', true), false)
  assert.equal(interruptsPageInput('keydown', ' ', false), true)
  assert.equal(interruptsPageInput('keydown', 'PageDown', false), true)
  assert.equal(interruptsPageInput('touchstart', '', false), true)
  assert.equal(interruptsPageInput('wheel', '', true), true)
  assert.equal(interruptsPageInput('keydown', 'Escape', true), true)
})
