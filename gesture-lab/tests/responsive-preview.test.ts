import test from 'node:test'
import assert from 'node:assert/strict'
import {PageGestureEngine} from '../src/control/PageGestureEngine.ts'
import {TOUCHPAD_GESTURE_CONFIG} from '../src/control/GestureConfig.ts'
import type {InteractionFrame} from '../src/control/types.ts'

function frame(t:number,pose:'OPEN'|'FIST'|'UNKNOWN'='OPEN',x=.5):InteractionFrame{
  return {timestampMs:t,ambiguous:false,reason:'valid',viewport:{width:1000,height:800},
    targets:[{id:'pulse',kind:'click',activationToken:1,rect:{left:450,top:350,width:100,height:100}}],
    hands:[{id:1,timestampMs:t,pose,center:{x,y:.5},orientation:'UPRIGHT_LIKE',orientationMetrics:{imageTiltDegrees:0,depthTiltDegrees:10,palmFacingCameraPercent:95}}]}
}
test('a known OPEN sample previews touchpad movement immediately without arming an unconfirmed click',()=>{
  const e=new PageGestureEngine({...TOUCHPAD_GESTURE_CONFIG,pointerPreview:true})
  e.setAutomaticScroll(false)
  assert.deepEqual(e.update(frame(0),45).pointer,{x:500,y:400})
  e.update(frame(50,'OPEN',.47),95)
  assert.ok(e.tick(120).pointer!.x>500,'first150ms of intentional motion must not be thrown away')
  assert.equal(e.diagnostics.confirmed,false)
  assert.equal(e.clickDiagnostics.state,'OPEN')
  for(let t=100;t<=500;t+=50)assert.equal(e.update(frame(t,'FIST',.47),t+45).activation,null)
})
test('reopening previews geometry while release lockout and click confirmation remain intact',()=>{
  const e=new PageGestureEngine({...TOUCHPAD_GESTURE_CONFIG,pointerPreview:true})
  e.setAutomaticScroll(false)
  for(let t=0;t<=350;t+=50)e.update(frame(t),t+45)
  let clicks=0
  for(let t=400;t<=700;t+=50)if(e.update(frame(t,'FIST'),t+45).activation)clicks++
  assert.equal(clicks,1)
  assert.deepEqual(e.update(frame(750,'OPEN',.7),795).pointer,{x:500,y:400},'reopening anchors at the retained position')
  e.update(frame(800,'OPEN',.67),845)
  assert.ok(e.tick(870).pointer!.x>500,'movement need not wait for action rearming')
  assert.equal(e.clickDiagnostics.state,'WAIT_FOR_RELEASE')
  for(let t=850;t<=1200;t+=50)assert.equal(e.update(frame(t,'FIST',.67),t+45).activation,null)
})
test('unknown samples freeze an early movement preview and never renew its geometry',()=>{
  const e=new PageGestureEngine({...TOUCHPAD_GESTURE_CONFIG,pointerPreview:true})
  e.setAutomaticScroll(false)
  e.update(frame(0),45);e.update(frame(50,'OPEN',.47),95)
  e.tick(120)
  const stopped=e.update(frame(100,'UNKNOWN',.1),145)
  assert.equal(stopped.pointer,null)
  for(const t of [155,175,195]){assert.equal(e.tick(t).pointer,null);assert.equal(e.tick(t).activation,null)}
})
