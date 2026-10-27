import test from 'node:test'
import assert from 'node:assert/strict'
import {PageGestureEngine} from '../src/control/PageGestureEngine.ts'
import {TOUCHPAD_GESTURE_CONFIG} from '../src/control/GestureConfig.ts'
import type {InteractionFrame} from '../src/control/types.ts'

test('adaptive app candidate supports delayed OPEN→click→release→scroll→point while retaining only geometry',()=>{
  const engine=new PageGestureEngine(TOUCHPAD_GESTURE_CONFIG)
  let activations=0,last=engine.cancel(),lastTime=-60
  const feed=(t:number,pose:'OPEN'|'FIST'|'UNKNOWN'='OPEN',flat=false,y=.5,visible=true)=>{
    const f:InteractionFrame={timestampMs:t,ambiguous:false,reason:'valid',viewport:{width:1000,height:800},targets:[{id:'pulse',kind:'click',activationToken:1,rect:{left:450,top:350,width:100,height:100}}],
      hands:visible?[{id:1,timestampMs:t,pose,center:{x:.5,y},orientation:flat?'FLAT_LIKE':'UPRIGHT_LIKE',orientationMetrics:{imageTiltDegrees:0,depthTiltDegrees:flat?60:9,palmFacingCameraPercent:flat?30:95}}]:[]}
    for(let r=lastTime+45+16;r<t+45;r+=16)assert.equal(engine.tick(r).activation,null)
    last=engine.update(f,t+45);lastTime=t
    if(last.activation){activations++;engine.acknowledge(last.activation.sequence,true,t+45)}
    return last
  }
  for(let t=0;t<=360;t+=60)feed(t)
  assert.equal(engine.clickDiagnostics.state,'TARGET_FOCUSED')
  for(let t=420;t<=720;t+=60)feed(t,'FIST')
  assert.equal(activations,1)
  for(let t=780;t<=1080;t+=60)feed(t)
  assert.deepEqual(last.pointer,{x:500,y:400})
  for(let t=1140;t<=1740;t+=60)feed(t,'OPEN',true)
  assert.equal(last.interactionState,'SCROLL_ACTIVE')
  feed(1800,'OPEN',true,.6)
  assert.ok(engine.tick(1861).scrollDeltaY>0)
  feed(1860,'OPEN',true,.5)
  assert.equal(engine.tick(1921).scrollVelocity,0)
  feed(1920,'FIST',true)
  assert.equal(last.activation,null);assert.equal(engine.tick(1981).scrollDeltaY,0)
  for(let t=1980;t<=2400;t+=60)feed(t)
  assert.equal(last.interactionState,'POINTER_MODE')
  assert.deepEqual(last.pointer,{x:500,y:400})
  feed(2460,'UNKNOWN')
  assert.equal(last.activation,null);assert.deepEqual(last.pointer,{x:500,y:400})
  feed(2520,'OPEN',false,.5,false)
  assert.equal(last.interactionState,'INACTIVE')
  assert.equal(engine.tick(2600).interactionState,'INACTIVE')
  assert.equal(activations,1)
})
