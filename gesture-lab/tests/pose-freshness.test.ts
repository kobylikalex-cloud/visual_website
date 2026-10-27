import test from 'node:test'
import assert from 'node:assert/strict'
import {PageGestureEngine} from '../src/control/PageGestureEngine.ts'
import {TOUCHPAD_GESTURE_CONFIG} from '../src/control/GestureConfig.ts'
import type {InteractionFrame} from '../src/control/types.ts'

const frame=(t:number,pose:'OPEN'|'FIST'|'UNKNOWN'):InteractionFrame=>({timestampMs:t,ambiguous:false,reason:'valid',viewport:{width:1000,height:800},targets:[],
  hands:[{id:1,timestampMs:t,pose,orientation:'UPRIGHT_LIKE',center:{x:.5,y:.5},orientationMetrics:{imageTiltDegrees:0,depthTiltDegrees:10,palmFacingCameraPercent:95}}]})

for(const pose of ['FIST','UNKNOWN'] as const)test(`fresh unarmed ${pose} remains uncertain between observations, rather than repeatedly expiring`,()=>{
  const e=new PageGestureEngine(TOUCHPAD_GESTURE_CONFIG)
  for(let t=0;t<=1000;t+=50){
    const observation=e.update(frame(t,pose),t+45)
    assert.equal(observation.interactionState,'UNCERTAIN')
    for(const dt of [46,60,80]){
      const rendered=e.tick(t+dt)
      assert.equal(rendered.interactionState,'UNCERTAIN','gesture uncertainty is not tracking expiry')
      assert.equal(rendered.activation,null);assert.equal(rendered.pointer,null);assert.equal(rendered.scrollDeltaY,0)
    }
  }
  assert.equal(e.scrollDiagnostics.transitionCount,1,'fresh stationary uncertainty must not create alternating INACTIVE events')
  assert.equal(e.tick(1201).interactionState,'INACTIVE','actual source expiry still stops the engine')
})
