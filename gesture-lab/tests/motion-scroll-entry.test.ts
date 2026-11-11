import test from 'node:test'
import assert from 'node:assert/strict'
import {PageScrollSession} from '../src/control/PageScrollSession.ts'
import {PageGestureEngine} from '../src/control/PageGestureEngine.ts'
import {TOUCHPAD_GESTURE_CONFIG} from '../src/control/GestureConfig.ts'
import type {TrackedHand,InteractionFrame} from '../src/control/types.ts'
const hand=(t:number,y=.5,pose:'OPEN'|'UNKNOWN'='OPEN'):TrackedHand=>({id:1,timestampMs:t,pose,center:{x:.5,y},orientation:'FLAT_LIKE',
  orientationMetrics:{imageTiltDegrees:0,depthTiltDegrees:60,palmFacingCameraPercent:30}})

for(const direction of [-1,1])test(`a directed flat stroke enters on three fresh samples without a stationary dwell (${direction})`,()=>{
  const s=new PageScrollSession()
  assert.equal(s.observe(hand(0),true,true,45).state,'ENTRY')
  assert.equal(s.observe(hand(50,.5+direction*.04),true,true,95).state,'ENTRY','one displaced image is insufficient')
  const entered=s.observe(hand(100,.5+direction*.06),true,true,145)
  assert.equal(entered.state,'ACTIVE','an intentional movement must not wait for200ms or a250ms still period')
  assert.equal(entered.neutralY,.5,'the first flat position is the resting anchor, not the end of the movement')
  assert.equal(Math.sign(entered.velocity),direction)
  assert.equal(Math.abs(s.tick(145).deltaY),0,'entry cannot replay pre-confirmation time')
  assert.equal(Math.sign(s.tick(161).deltaY),direction)
  const held=s.observe(hand(150,.5+direction*.06),true,true,195)
  assert.equal(Math.sign(held.velocity),direction,'continuous position-controlled scrolling survives stopping the stroke')
  assert.equal(s.observe(hand(200),true,true,245).velocity,0,'returning to the initial height stops immediately')
})

test('oscillation and a displaced outlier cannot establish a directed scroll stroke',()=>{
  const s=new PageScrollSession()
  for(const [i,y] of [.5,.56,.49,.55,.48,.54,.47].entries()){
    assert.notEqual(s.observe(hand(i*50,y),true,true,i*50+45).state,'ACTIVE')
    assert.equal(s.tick(i*50+46).deltaY,0)
  }
})

test('stationary samples cannot let one later displaced outlier start scrolling',()=>{
  const s=new PageScrollSession()
  s.observe(hand(0),true,true,45);s.observe(hand(50),true,true,95)
  assert.equal(s.observe(hand(100,.56),true,true,145).state,'ENTRY')
  assert.equal(s.tick(161).deltaY,0)
  assert.equal(s.observe(hand(150),true,true,195).state,'ENTRY')
  assert.equal(s.tick(211).deltaY,0)
})

test('UNKNOWN cannot contribute direction evidence or activate across a missing interval',()=>{
  const s=new PageScrollSession()
  s.observe(hand(0),true,true,45)
  s.observe(hand(50,.54),true,true,95)
  assert.equal(s.pause(hand(100,.56,'UNKNOWN'),145).velocity,0)
  assert.notEqual(s.observe(hand(150,.56),true,true,195).state,'ACTIVE','old movement evidence cannot bridge UNKNOWN')
  assert.notEqual(s.observe(hand(200,.6),true,true,245).state,'ACTIVE')
  const entered=s.observe(hand(250,.62),true,true,295)
  assert.equal(entered.state,'ACTIVE')
  assert.equal(entered.neutralY,.56)
})

test('retention orientation and unconfirmed movement never borrow another hand or stale anchor',()=>{
  for(const change of ['partial','identity','stale','replay'] as const){
    const s=new PageScrollSession()
    s.observe(hand(0),true,true,45);s.observe(hand(50,.54),true,true,95)
    const h=hand(change==='replay'?50:100,.57)
    if(change==='identity')h.id=2
    const stopped=s.observe(h,change!=='partial',true,change==='stale'?301:145)
    assert.equal(stopped.neutralY,null);assert.equal(stopped.velocity,0)
    assert.equal(s.tick(146).deltaY,0)
  }
})

test('page arbitration supports direct flat movement without pointer or click effects, and two hands cancel it',()=>{
  const e=new PageGestureEngine(TOUCHPAD_GESTURE_CONFIG)
  const f=(t:number,y:number,count=1):InteractionFrame=>({timestampMs:t,ambiguous:false,reason:'valid',viewport:{width:1000,height:800},
    targets:[{id:'test',kind:'click',activationToken:1,rect:{left:450,top:350,width:100,height:100}}],
    hands:Array.from({length:count},(_,i)=>({...hand(t,y),id:i+1}))})
  for(let t=0;t<=400;t+=50){const upright=f(t,.5);upright.hands[0].orientationMetrics={imageTiltDegrees:0,depthTiltDegrees:10,palmFacingCameraPercent:95};e.update(upright,t+45)}
  e.update(f(450,.5),495);e.update(f(500,.54),545)
  const result=e.update(f(550,.57),595)
  assert.equal(result.interactionState,'SCROLL_ACTIVE')
  assert.equal(result.pointer,null);assert.equal(result.focusId,null);assert.equal(result.activation,null)
  assert.ok(e.tick(611).scrollDeltaY>0)
  assert.equal(e.update(f(600,.6,2),645).scrollVelocity,0)
  assert.equal(e.tick(661).scrollDeltaY,0)
})
