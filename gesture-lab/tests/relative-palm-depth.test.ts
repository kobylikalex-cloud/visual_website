import assert from 'node:assert/strict'
import test from 'node:test'
import { RelativePalmDepth } from '../src/spatial/RelativePalmDepth.ts'
import type { PalmObservation } from '../src/spatial/types.ts'

type Point = {x:number;y:number;z:number}
const close = (a:number,b:number,tolerance=1e-9) => assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`)
// An independently specified rigid palm, projected by a synthetic camera. Fingers
// deliberately have a large extent so a whole-hand box gives a false depth signal.
function observation(timestampMs=0, options:{scale?:number;yaw?:number;pitch?:number;roll?:number;width?:number;height?:number;perspective?:boolean;closed?:boolean;worldScale?:number;worldOffset?:Point}={}):PalmObservation {
  const width=options.width??1280, height=options.height??720
  const points:Point[]=Array.from({length:21},(_,i)=>({x:(i%4-1.5)*.017,y:-.10-i*.002,z:0}))
  points[0]={x:0,y:.045,z:0}; points[5]={x:-.036,y:-.021,z:0}
  points[9]={x:-.012,y:-.033,z:0}; points[13]={x:.014,y:-.029,z:0}; points[17]={x:.036,y:-.013,z:0}
  if(options.closed) for(const i of [1,2,3,4,6,7,8,10,11,12,14,15,16,18,19,20]) points[i]={x:0,y:0,z:-.02}
  const world=points.map(point=>{
    const yaw=(options.yaw??0)*Math.PI/180,pitch=(options.pitch??0)*Math.PI/180,roll=(options.roll??0)*Math.PI/180
    const x=point.x*Math.cos(yaw)+point.z*Math.sin(yaw), z=-point.x*Math.sin(yaw)+point.z*Math.cos(yaw)
    const y=point.y*Math.cos(pitch)-z*Math.sin(pitch), zz=point.y*Math.sin(pitch)+z*Math.cos(pitch)
    return {x:x*Math.cos(roll)-y*Math.sin(roll),y:x*Math.sin(roll)+y*Math.cos(roll),z:zz}
  })
  const image=world.map(point=>{
    const scale=options.scale??1, cameraDistance=.8/scale
    const magnification=options.perspective ? .8/(cameraDistance+point.z) : scale
    return {x:.5+point.x*magnification*2,y:.5+point.y*magnification*2*width/height,z:point.z}
  })
  return {timestampMs,imageSize:{width,height},imageLandmarks:image,worldLandmarks:world.map(p=>({
    x:p.x*(options.worldScale??1)+(options.worldOffset?.x??0),
    y:p.y*(options.worldScale??1)+(options.worldOffset?.y??0),
    z:p.z*(options.worldScale??1)+(options.worldOffset?.z??0),
  }))}
}
function stable(depth:RelativePalmDepth, start:number, scale:number) {
  let result=depth.observe(observation(start,{scale}),{handId:7,pose:'FIST'})
  for(let i=1;i<=8;i++) result=depth.observe(observation(start+i*40,{scale}),{handId:7,pose:'FIST'})
  return result
}

test('palm scale follows projected size and corrects image aspect ratio',()=>{
  const depth=new RelativePalmDepth()
  const a=depth.measure(observation()),b=depth.measure(observation(0,{scale:1.5})),portrait=depth.measure(observation(0,{width:720,height:1280}))
  assert.equal(a.valid,true); assert.equal(b.valid,true); assert.equal(portrait.valid,true)
  close(b.scale!/a.scale!,1.5); close(portrait.scale!,a.scale!)
})

test('analytic foreshortening correction resists rigid yaw pitch and roll',()=>{
  const depth=new RelativePalmDepth(), neutral=depth.measure(observation()).scale!
  for(const rotation of [{yaw:45},{pitch:45},{yaw:30,pitch:30},{roll:87},{yaw:-45,roll:40}]) {
    const result=depth.measure(observation(0,rotation))
    assert.equal(result.valid,true,JSON.stringify(rotation)); close(result.scale!,neutral)
  }
})

test('perspective rotation error stays below 5% at the stated synthetic camera distance',()=>{
  const depth=new RelativePalmDepth(),neutral=depth.measure(observation(0,{perspective:true})).scale!
  for(const yaw of [-45,-30,0,30,45]) {
    const result=depth.measure(observation(0,{yaw,perspective:true}))
    assert.equal(result.valid,true); close(result.scale!/neutral,1,.05)
  }
})

test('one-pixel endpoint perturbations stay inside a 5% scale error budget at 45 degrees',()=>{
  const depth=new RelativePalmDepth(),reference=depth.measure(observation()).scale!
  for(let pattern=0;pattern<16;pattern++) {
    const noisy=observation(0,{yaw:45})
    noisy.imageLandmarks=noisy.imageLandmarks.map((p,i)=>({...p,
      x:p.x+((pattern+i)%2===0?1:-1)/noisy.imageSize.width,
      y:p.y+((pattern+i*3)%3===0?1:-1)/noisy.imageSize.height,
    }))
    const result=depth.measure(noisy)
    assert.equal(result.valid,true); close(result.scale!/reference,1,.05)
  }
})

test('two-degree world-direction error stays inside a 5% scale error budget at 45 degrees',()=>{
  const depth=new RelativePalmDepth(),reference=depth.measure(observation()).scale!
  const noisy=observation(0,{yaw:45})
  noisy.worldLandmarks=observation(0,{yaw:47}).worldLandmarks
  const result=depth.measure(noisy)
  assert.equal(result.valid,true); close(result.scale!/reference,1,.05)
})

test('world absolute translation and uniform metric scale never become measured distance',()=>{
  const depth=new RelativePalmDepth(),a=depth.measure(observation())
  const b=depth.measure(observation(0,{worldScale:10,worldOffset:{x:42,y:70,z:-100}}))
  assert.equal(b.valid,true); close(b.scale!,a.scale!)
})

test('finite extreme world units do not overflow palm conditioning or alter scale',()=>{
  const depth=new RelativePalmDepth(),reference=depth.measure(observation()).scale!
  for(const worldScale of [1e-200,1e200,1e308]) {
    const result=depth.measure(observation(0,{worldScale}))
    assert.equal(result.valid,true); close(result.scale!,reference)
  }
})

test('extreme world units cannot bypass image-world direction disagreement',()=>{
  const depth=new RelativePalmDepth(),flipped=observation(0,{worldScale:1e308})
  flipped.imageLandmarks=flipped.imageLandmarks.map(p=>({...p,x:1-p.x,y:1-p.y}))
  assert.equal(depth.measure(flipped).valid,false)
})

test('finger closure cannot create a scale signal that a whole-hand box would report',()=>{
  const depth=new RelativePalmDepth(),open=observation(),fist=observation(0,{closed:true})
  const height=(o:PalmObservation)=>Math.max(...o.imageLandmarks.map(p=>p.y))-Math.min(...o.imageLandmarks.map(p=>p.y))
  assert.ok(height(open)>height(fist)*1.5)
  close(depth.measure(open).scale!,depth.measure(fist).scale!)
})

test('edge-on collapsed tiny and out-of-frame palms are invalid',()=>{
  const depth=new RelativePalmDepth()
  assert.equal(depth.measure(observation(0,{yaw:80})).valid,false)
  assert.equal(depth.measure(observation(0,{scale:.08})).valid,false)
  const collapsed=observation(); collapsed.worldLandmarks=collapsed.worldLandmarks.map(()=>({x:0,y:0,z:0}))
  assert.equal(depth.measure(collapsed).valid,false)
  const clipped=observation(); clipped.imageLandmarks=clipped.imageLandmarks.map(p=>({...p,x:p.x+1}))
  assert.equal(depth.measure(clipped).valid,false)
})

test('valid image z and fingertip values are not a camera distance measurement',()=>{
  const depth=new RelativePalmDepth(),a=observation(),b=observation()
  b.imageLandmarks=b.imageLandmarks.map(p=>({...p,z:p.z+500}))
  close(depth.measure(a).scale!,depth.measure(b).scale!)
})

test('a grab anchors only the current valid FIST, so opening posture cannot move Z',()=>{
  const depth=new RelativePalmDepth()
  depth.observe(observation(0,{scale:1.3}),{handId:7,pose:'OPEN'})
  assert.equal(depth.captureGrabReference(),false)
  depth.observe(observation(40,{closed:true}),{handId:7,pose:'FIST'})
  assert.equal(depth.captureGrabReference(),true)
  close(depth.observe(observation(80,{closed:true}),{handId:7,pose:'FIST'}).relative,1)
  close(depth.observe(observation(120,{scale:1.05,closed:true}),{handId:7,pose:'FIST'}).relative,1.05)
})

test('implausible jumps freeze the previous relative value and recover from a single glitch',()=>{
  const depth=new RelativePalmDepth(); depth.observe(observation(),{handId:7,pose:'FIST'}); depth.captureGrabReference()
  const before=depth.observe(observation(40,{scale:1.04}),{handId:7,pose:'FIST'})
  const invalid=depth.observe(observation(80,{scale:2}),{handId:7,pose:'FIST'})
  assert.equal(invalid.valid,false); close(invalid.relative,before.relative)
  const recovered=depth.observe(observation(120,{scale:1.05}),{handId:7,pose:'FIST'})
  assert.equal(recovered.valid,true); close(recovered.relative,1.05)
})

test('inconsistent MCP motion is rejected even when the aggregate scale looks plausible',()=>{
  const depth=new RelativePalmDepth(); depth.observe(observation(),{handId:7,pose:'FIST'}); depth.captureGrabReference()
  const malformed=observation(40)
  malformed.imageLandmarks=malformed.imageLandmarks.map((p,i)=>i===5?{...p,x:p.x-.08,y:p.y+.05}:p)
  const result=depth.observe(malformed,{handId:7,pose:'FIST'})
  assert.equal(result.valid,false); close(result.relative,1)
})

test('UNKNOWN pose, identity changes, stale and duplicate observations cannot move held depth',()=>{
  const depth=new RelativePalmDepth(); depth.observe(observation(),{handId:7,pose:'FIST'}); depth.captureGrabReference()
  const moved=depth.observe(observation(40,{scale:1.03}),{handId:7,pose:'FIST'})
  for(const time of [40,20,500]) {
    const result=depth.observe(observation(time,{scale:1.2}),{handId:7,pose:'FIST'})
    assert.equal(result.valid,false); close(result.relative,moved.relative)
  }
  const uncertain=depth.observe(observation(540,{scale:1.3}),{handId:7,pose:'UNKNOWN'})
  assert.equal(uncertain.valid,false); close(uncertain.relative,moved.relative)
  const changed=depth.observe(observation(580,{scale:1.3}),{handId:8,pose:'FIST'})
  assert.equal(changed.valid,false); close(changed.relative,moved.relative)
  assert.equal(depth.captureGrabReference(),false)
})

test('invalid latest FIST cannot reuse a previous valid scale for acquisition',()=>{
  const depth=new RelativePalmDepth(); depth.observe(observation(),{handId:7,pose:'FIST'})
  depth.observe(observation(40,{yaw:85}),{handId:7,pose:'FIST'})
  assert.equal(depth.captureGrabReference(),false)
})

test('calibration requires a stable FIST window and ordered distinct near neutral far scales',()=>{
  const depth=new RelativePalmDepth()
  depth.observe(observation(),{handId:7,pose:'FIST'})
  assert.equal(depth.captureCalibration('neutral'),false)
  stable(depth,40,1); assert.equal(depth.captureCalibration('neutral'),true)
  depth.resetGrabReference(); stable(depth,400,1.4); assert.equal(depth.captureCalibration('near'),true)
  depth.resetGrabReference(); stable(depth,800,.7); assert.equal(depth.captureCalibration('far'),true)
  assert.equal(depth.getCalibration().complete,true)
  close(depth.mapRelativeToScene(1,{near:1.5,neutral:0,far:-1.5}),0)
  close(depth.mapRelativeToScene(1.4,{near:1.5,neutral:0,far:-1.5}),1.5)
  close(depth.mapRelativeToScene(.7,{near:1.5,neutral:0,far:-1.5}),-1.5)
  close(depth.mapRelativeToScene(10,{near:1.5,neutral:0,far:-1.5}),1.5)
})

test('unstable windows, OPEN calibration and inverted endpoints leave calibration unchanged',()=>{
  const depth=new RelativePalmDepth(); stable(depth,0,1); assert.equal(depth.captureCalibration('neutral'),true)
  depth.resetGrabReference(); stable(depth,400,.8); assert.equal(depth.captureCalibration('near'),false)
  assert.equal(depth.getCalibration().nearScale,null)
  depth.observe(observation(760),{handId:7,pose:'OPEN'})
  assert.equal(depth.captureCalibration('far'),false)
  assert.equal(depth.getCalibration().complete,false)
  close(depth.mapRelativeToScene(1.2,{near:1,neutral:0,far:-1}),.2)
})

test('moving fists cannot be captured as stable calibration endpoints',()=>{
  const depth=new RelativePalmDepth()
  for(let i=0;i<=8;i++) depth.observe(observation(i*40,{scale:1+i*.01}),{handId:7,pose:'FIST'})
  assert.equal(depth.captureCalibration('neutral'),false)
  assert.equal(depth.getCalibration().neutralScale,null)
})

test('reset clears reference calibration and frozen output',()=>{
  const depth=new RelativePalmDepth(); stable(depth,0,1); depth.captureGrabReference(); depth.captureCalibration('neutral')
  depth.observe(observation(360,{scale:1.04}),{handId:7,pose:'FIST'}); depth.reset()
  const result=depth.observe(observation(0),{handId:9,pose:'FIST'})
  assert.equal(result.valid,true); close(result.relative,1); assert.equal(result.neutralScale,null)
  assert.equal(depth.getCalibration().neutralScale,null)
})
