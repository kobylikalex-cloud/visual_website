import test from 'node:test'
import assert from 'node:assert/strict'
import {SpatialControlBridge} from '../src/spatial/SpatialControlBridge.ts'
import {PageGestureEngine} from '../src/control/PageGestureEngine.ts'
import {TOUCHPAD_GESTURE_CONFIG} from '../src/control/GestureConfig.ts'
import type {InteractionFrame,TrackingFrame} from '../src/control/types.ts'
import type {Vec3} from '../src/spatial/types.ts'
const frame=(t:number,pose:'OPEN'|'FIST'='OPEN'):InteractionFrame=>({timestampMs:t,ambiguous:false,reason:'valid',viewport:{width:1000,height:800},targets:[],
 hands:[{id:1,timestampMs:t,pose,center:{x:.5,y:.5},orientation:'UPRIGHT_LIKE',orientationMetrics:{imageTiltDegrees:0,depthTiltDegrees:10,palmFacingCameraPercent:95}}]})
const raw=(t:number):TrackingFrame=>({timestampMs:t,detections:[]})

function calibrationHarness(){
 const bridge=new SpatialControlBridge(),base=new PageGestureEngine(TOUCHPAD_GESTURE_CONFIG).cancel()
 bridge.connectScene({bounds:{min:{x:-2,y:-2,z:-1},max:{x:2,y:2,z:1}},pick:()=>null,planePoint:()=>null,
  getPosition:()=>({x:0,y:0,z:0}),setPosition:()=>{},getOwnerToken:()=>1,getRect:()=>({left:0,top:0,width:1000,height:800})})
 for(let t=0;t<=320;t+=40){
  const world=Array.from({length:21},()=>({x:0,y:0,z:0}))
  world[0]={x:0,y:.045,z:0};world[5]={x:-.036,y:-.021,z:0};world[9]={x:-.012,y:-.033,z:0};world[13]={x:.014,y:-.029,z:0};world[17]={x:.036,y:-.013,z:0}
  bridge.afterFrame({timestampMs:t,imageSize:{width:1280,height:720},detections:[{worldLandmarks:world,
   landmarks:world.map(p=>({x:.5+p.x*2,y:.5+p.y*2*1280/720,z:0}))}]},frame(t,'FIST'),base,false,t)
 }
 return {bridge,base}
}

test('depth calibration cannot capture a stable fist after missing or ambiguous hand observations',()=>{
 for(const ambiguous of [false,true]){
  const {bridge,base}=calibrationHarness(),lost=frame(360,'FIST')
  lost.ambiguous=ambiguous;if(!ambiguous)lost.hands=[]
  bridge.afterFrame(raw(360),lost,base,false,360)
  assert.equal(bridge.captureCalibration('neutral',360),false)
  assert.equal(bridge.getDebug().calibration.neutralScale,null)
 }
})

test('depth calibration requires a fresh paired observation even when no new camera frame arrives',()=>{
 const {bridge}=calibrationHarness()
 assert.equal(bridge.captureCalibration('neutral',10000),false)
 bridge.tick(10000)
 assert.equal(bridge.getDebug().depth.valid,false)
})

test('depth calibration can still capture a fresh stable fist',()=>{
 const {bridge}=calibrationHarness()
 assert.equal(bridge.captureCalibration('neutral',340),true)
 assert.ok(bridge.getDebug().calibration.neutralScale!>0)
})
test('an absent spatial scene leaves the accepted normal engine snapshots unchanged',()=>{
 const reference=new PageGestureEngine(TOUCHPAD_GESTURE_CONFIG), actual=new PageGestureEngine(TOUCHPAD_GESTURE_CONFIG), bridge=new SpatialControlBridge()
 for(let t=0;t<=1500;t+=50){const f=frame(t,t>=450&&t<850?'FIST':'OPEN');const before=bridge.beforeFrame(raw(t),f,t+45)
  assert.deepEqual(before,{consumed:false,processed:false,handoff:null})
  const a=actual.update(f,t+45),b=reference.update(f,t+45)
  bridge.afterFrame(raw(t),f,a,actual.diagnostics.confirmed,t+45)
  assert.deepEqual(a,b);assert.equal(bridge.tick(t+46),null)
 }
})
test('an attached cube preserves ordinary button click, release and direct flat-palm scrolling snapshots',()=>{
 const reference=new PageGestureEngine(TOUCHPAD_GESTURE_CONFIG),actual=new PageGestureEngine(TOUCHPAD_GESTURE_CONFIG),bridge=new SpatialControlBridge()
 bridge.connectScene({bounds:{min:{x:-2,y:-2,z:-1},max:{x:2,y:2,z:1}},pick:()=>({id:'spatial-cube',ownerToken:1,point:{x:0,y:0,z:.5},position:{x:0,y:0,z:0}}),
  planePoint:()=>null,getPosition:()=>({x:0,y:0,z:0}),setPosition:()=>assert.fail('ordinary controls must not move the cube'),getOwnerToken:()=>1,getRect:()=>({left:0,top:0,width:1000,height:800})})
 let activations=0,scrollDistance=0
 for(let t=0;t<=3000;t+=50){
  const f=frame(t,t>=600&&t<1000?'FIST':'OPEN')
  f.targets=[{id:'test-2',kind:'click',activationToken:1,rect:{left:430,top:330,width:140,height:140}}]
  if(t>=1400&&t<2400){f.hands[0].orientation='FLAT_LIKE';f.hands[0].orientationMetrics={imageTiltDegrees:0,depthTiltDegrees:80,palmFacingCameraPercent:10};f.hands[0].center.y=.5+Math.min(.12,Math.max(0,t-1650)/2500)}
  const route=bridge.beforeFrame(raw(t),f,t+45)
  assert.equal(route.consumed,false)
  const a=actual.update(f,t+45),b=reference.update(f,t+45)
  if(!route.processed)bridge.afterFrame(raw(t),f,a,actual.diagnostics.confirmed,t+45)
  assert.deepEqual(a,b)
  if(a.activation){activations++;actual.acknowledge(a.activation.sequence,true,t+45);reference.acknowledge(b.activation!.sequence,true,t+45)}
  bridge.tick(t+46)
  const rendered=actual.tick(t+46,f.targets)
  assert.deepEqual(rendered,reference.tick(t+46,f.targets));scrollDistance+=rendered.scrollDeltaY
 }
 assert.equal(activations,1);assert.ok(scrollDistance>0)
})

test('a cube grab owns FIST effects and releases geometry without dispatching normal clicks or scroll',()=>{
 const bridge=new SpatialControlBridge(), e=new PageGestureEngine(TOUCHPAD_GESTURE_CONFIG)
 let position:Vec3={x:0,y:0,z:0}, ordinaryEffects=0
 bridge.connectScene({bounds:{min:{x:-2,y:-2,z:-1},max:{x:2,y:2,z:1}},pick:()=>({id:'spatial-cube',ownerToken:1,position:{...position},point:{x:0,y:0,z:.5}}),
  planePoint:(p,z)=>({x:(p.x-500)/100,y:(400-p.y)/100,z}),getPosition:()=>({...position}),setPosition:p=>{position={...p}},getOwnerToken:()=>1,getRect:()=>({left:0,top:0,width:1000,height:800})})
 for(let t=0;t<=350;t+=50){const f=frame(t),base=e.update(f,t+45);bridge.afterFrame(raw(t),f,base,e.diagnostics.confirmed,t+45)}
 for(let t=400;t<=700;t+=50){const f=frame(t,'FIST'),route=bridge.beforeFrame(raw(t),f,t+45);assert.equal(route.consumed,true);e.cancel('Spatial owns input');bridge.tick(t+46);const base=e.tick(t+46);ordinaryEffects+=base.activation?1:0;assert.equal(base.scrollDeltaY,0);assert.equal(base.scrollVelocity,0)}
 assert.equal(bridge.getDebug().snapshot!.state,'GRABBING_3D')
 const released=bridge.beforeFrame(raw(750),frame(750),795)
 assert.equal(released.consumed,false);assert.equal(released.processed,true);assert.ok(released.handoff)
 assert.equal(ordinaryEffects,0)
 assert.deepEqual(position,{x:0,y:0,z:0})
})
