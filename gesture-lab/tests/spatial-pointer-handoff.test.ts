import test from 'node:test'
import assert from 'node:assert/strict'
import {PageGestureEngine} from '../src/control/PageGestureEngine.ts'
import {TOUCHPAD_GESTURE_CONFIG} from '../src/control/GestureConfig.ts'
import type {InteractionFrame} from '../src/control/types.ts'
const viewport={width:1000,height:800}
const frame=(t:number,pose:'OPEN'|'FIST'='OPEN'):InteractionFrame=>({timestampMs:t,ambiguous:false,reason:'valid',viewport,
 targets:[{id:'button',kind:'click',activationToken:1,rect:{left:450,top:350,width:100,height:100}}],hands:[{id:1,timestampMs:t,pose,center:{x:.5,y:.5},orientation:'UPRIGHT_LIKE',orientationMetrics:{imageTiltDegrees:0,depthTiltDegrees:10,palmFacingCameraPercent:95}}]})
test('explicit spatial release retains only geometry and never a prepared button or old filter travel',()=>{
 const e=new PageGestureEngine(TOUCHPAD_GESTURE_CONFIG)
 for(let t=0;t<=350;t+=50)e.update(frame(t),t+45)
 assert.equal(e.clickDiagnostics.state,'TARGET_FOCUSED')
 e.retainPointerGeometry({x:700,y:500},viewport)
 for(let t=400;t<=700;t+=50)assert.equal(e.update(frame(t,'FIST'),t+45).activation,null)
 const reopened=e.update(frame(750),795)
 assert.deepEqual(reopened.pointer,{x:700,y:500})
 assert.equal(reopened.activation,null)
 assert.equal(e.diagnostics.confirmed,false)
 assert.throws(()=>e.retainPointerGeometry({x:NaN,y:0},viewport),RangeError)
})
