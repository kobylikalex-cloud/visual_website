import test from 'node:test'
import assert from 'node:assert/strict'
import {nextSpatialRenderTime} from '../src/spatial/SpatialRenderClock.ts'

test('60 Hz scene rendering retains deadline phase across common display rates and jitter',()=>{
 for(const hz of [60,75,90,120,144])for(const jitter of [0,.15]){
  let deadline=-Infinity,count=0
  for(let i=0;i<hz*5;i++){
   const now=i*1000/hz+Math.sin(i)*jitter
   const next=nextSpatialRenderTime(now,deadline)
   if(next!==null){deadline=next;count++}
  }
  assert.ok(count>=298&&count<=301,`${hz} Hz / ${jitter} jitter: ${count/5} draws/s`)
 }
})

test('a long pause resumes with one draw and never queues missed frames',()=>{
 const next=nextSpatialRenderTime(10000,10)!
 assert.ok(next>10000)
 assert.equal(nextSpatialRenderTime(10000,next),null)
 assert.equal(nextSpatialRenderTime(NaN,next),null)
})
