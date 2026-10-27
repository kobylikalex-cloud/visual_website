import test from 'node:test'
import assert from 'node:assert/strict'
import { isEvaluationFrame } from '../src/tracking/EvaluationMode.ts'

test('learned model frames always pause effects, even with labels and debug disabled', () => {
  for (const recording of [false,true]) for (const benchmark of [false,true]) {
    assert.equal(isEvaluationFrame(recording, benchmark, 'learned'), true)
  }
  assert.equal(isEvaluationFrame(false, false, 'landmarks'), false)
  assert.equal(isEvaluationFrame(true, false, 'landmarks'), true)
  assert.equal(isEvaluationFrame(false, true, 'landmarks'), true)
})
