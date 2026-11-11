import test from 'node:test'
import assert from 'node:assert/strict'
import { PointerController } from '../src/control/PointerController.ts'
import { PageGestureEngine } from '../src/control/PageGestureEngine.ts'
import { TOUCHPAD_GESTURE_CONFIG } from '../src/control/GestureConfig.ts'
import type { InteractionFrame } from '../src/control/types.ts'

test('fast touchpad reversals settle within120ms after publication, without overshoot or lost mirroring',()=>{
  const viewport={width:1000,height:800}
  for(const sourceHz of [17,30])for(const renderHz of [60,120]){
    const p=new PointerController(TOUCHPAD_GESTURE_CONFIG)
    const targets=[500,500+1000*.15*1.6/.7,500-1000*.15*1.6/.7,500]
    const onsets=new Map<number,number>(), reached=new Map<number,number>()
    let lastPhase=0
    for(let i=0;i<=renderHz*1.6;i++){
      const t=i*1000/renderHz, sourceT=Math.floor(t*sourceHz/1000+1e-8)*1000/sourceHz
      const phase=sourceT<200?0:sourceT<650?1:sourceT<1100?2:3
      if(phase!==lastPhase){onsets.set(phase,t);lastPhase=phase}
      const x=phase===1?.425:phase===2?.575:.5
      const result=p.update({x,y:.5},t+45,viewport,sourceT)
      assert.ok(result.x>=targets[2]-1e-6&&result.x<=targets[1]+1e-6,'no overshoot beyond commanded endpoints')
      assert.ok(Math.abs(result.y-400)<1e-6)
      if(phase>0&&!reached.has(phase)&&Math.abs(result.x-targets[phase])<=Math.abs(targets[phase]-targets[phase-1])*.1)reached.set(phase,t)
    }
    for(const phase of [1,2,3]){
      assert.ok(reached.has(phase),`phase${phase} must reach its destination`)
      assert.ok(reached.get(phase)!-onsets.get(phase)!<=120,`${sourceHz}/${renderHz}, phase${phase}: ${reached.get(phase)!-onsets.get(phase)!}ms`)
    }
  }
})

test('rapid repeated open/fist cycles remain one-shot; short fists and a second hand never activate',()=>{
  const e=new PageGestureEngine(TOUCHPAD_GESTURE_CONFIG)
  e.setAutomaticScroll(false)
  let t=0, clicks=0
  const feed=(pose:'OPEN'|'FIST',count=1)=>{
    const frame:InteractionFrame={timestampMs:t,ambiguous:false,reason:'valid',viewport:{width:1000,height:800},
      targets:[{id:'pulse',kind:'click',activationToken:1,rect:{left:450,top:350,width:100,height:100}}],
      hands:Array.from({length:count},(_,id)=>({id:id+1,timestampMs:t,pose,center:{x:.5,y:.5},orientation:'UPRIGHT_LIKE' as const}))}
    const result=e.update(frame,t+45)
    if(result.activation){clicks++;e.acknowledge(result.activation.sequence,true,t+45)}
    assert.equal(e.tick(t+50).activation,null)
    t+=1000/30
  }
  const hold=(pose:'OPEN'|'FIST',samples:number,count=1)=>{for(let i=0;i<samples;i++)feed(pose,count)}
  hold('OPEN',16)
  for(let cycle=0;cycle<8;cycle++){hold('FIST',9);hold('OPEN',12)}
  assert.equal(clicks,8)
  hold('FIST',4);hold('OPEN',12)
  assert.equal(clicks,8,'a120ms fist is intentionally insufficient, even during fast navigation')
  hold('FIST',1,2);hold('FIST',12)
  assert.equal(clicks,8,'a friend entering the image cannot inherit a prepared click')
  hold('OPEN',12);hold('FIST',30)
  assert.equal(clicks,9,'holding a full fist produces exactly one click after safe reacquisition')
})
