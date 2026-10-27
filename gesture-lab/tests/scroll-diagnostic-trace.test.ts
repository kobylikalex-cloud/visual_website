import test from 'node:test'
import assert from 'node:assert/strict'
import {PageGestureEngine} from '../src/control/PageGestureEngine.ts'
import type {InteractionFrame} from '../src/control/types.ts'
const frame=(t:number,pose:'OPEN'|'UNKNOWN'='OPEN',y=.5):InteractionFrame=>({timestampMs:t,ambiguous:false,reason:'valid',viewport:{width:1000,height:800},targets:[],
  hands:[{id:1,timestampMs:t,pose,center:{x:.5,y},orientation:'FLAT_LIKE',orientationMetrics:{imageTiltDegrees:0,depthTiltDegrees:60,palmFacingCameraPercent:30}}]})
test('debug-only bounded numeric trace distinguishes height movement, recognition loss and neutral retention without recording landmarks',()=>{
  const e=new PageGestureEngine()
  e.update(frame(0),45)
  assert.equal(e.scrollDiagnostics.observations.length,0)
  e.setDebugTrace(true)
  for(let t=50;t<=600;t+=50)e.update(frame(t),t+45)
  const result=e.update(frame(650,'OPEN',.6),695)
  e.update(frame(700,'UNKNOWN',.6),745)
  const trace=e.scrollDiagnostics.observations
  assert.equal(trace.at(-2)!.height,.6)
  assert.equal(trace.at(-2)!.neutralY,.5)
  assert.equal(trace.at(-2)!.velocity,result.scrollVelocity)
  assert.equal(trace.at(-1)!.pose,'UNKNOWN')
  assert.equal(trace.at(-1)!.neutralY,.5)
  assert.equal(trace.at(-1)!.velocity,0)
  assert.equal(trace.at(-1)!.sourceAgeMs,45)
  assert.equal('landmarks' in trace.at(-1)!,false)
  for(let t=750;t<=30000;t+=50)e.update(frame(t),t+45)
  assert.equal(e.scrollDiagnostics.observations.length,400)
  e.setDebugTrace(false)
  assert.equal(e.scrollDiagnostics.observations.length,0)
})
