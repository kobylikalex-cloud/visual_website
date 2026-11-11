import test from 'node:test'
import assert from 'node:assert/strict'
import {PageScrollSession} from '../src/control/PageScrollSession.ts'
import type {TrackedHand} from '../src/control/types.ts'
const hand=(t:number,y=.5):TrackedHand=>({id:1,timestampMs:t,center:{x:.5,y},pose:'OPEN',orientation:'FLAT_LIKE'})

test('flat confirmation and neutral settling use the same fresh evidence window instead of adding delays',()=>{
  const s=new PageScrollSession()
  for(let t=0;t<250;t+=50){
    assert.equal(s.observe(hand(t),true,true,t+45).state,'ENTRY')
    assert.equal(s.tick(t+46).deltaY,0)
  }
  assert.equal(s.observe(hand(250),true,true,295).state,'ACTIVE','200ms confirmation and250ms settling must not add up to450ms')
  assert.equal(s.observe(hand(300,.6),true,true,345).neutralY,.5,'initial rest must not follow the first downward movement')
  assert.ok(s.tick(361).deltaY>0)
  assert.equal(s.observe(hand(350),true,true,395).velocity,0)
})

test('entry still requires the complete settled window, strong posture and fresh one-hand evidence',()=>{
  const moving=new PageScrollSession()
  for(let t=0;t<=700;t+=50)assert.equal(moving.observe(hand(t,t%100?.4:.6),true,true,t+45).neutralY,null)
  const partial=new PageScrollSession()
  for(let t=0;t<=700;t+=50)assert.equal(partial.observe(hand(t),false,true,t+45).neutralY,null)
})
