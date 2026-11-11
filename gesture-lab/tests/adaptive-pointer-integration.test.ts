import test from 'node:test'
import assert from 'node:assert/strict'
import { PointerController } from '../src/control/PointerController.ts'
import { DEFAULT_GESTURE_CONFIG } from '../src/control/GestureConfig.ts'

const config = { ...DEFAULT_GESTURE_CONFIG, pointerMode: 'relative' as const, pointerFilter: 'adaptive' as const }
const viewport = {width:1000,height:800}
test('adaptive touchpad uses camera timestamps independently of rendering and speeds coarse motion without overshoot', () => {
  for(const sourceHz of [17,30]) for(const renderHz of [60,120]) {
    const p = new PointerController(config); let reached:number|null=null; let onset:number|null=null
    for(let i=0;i<=renderHz;i++) {
      const t=i*1000/renderHz, sourceIndex=Math.floor(t*sourceHz/1000+1e-8)
      const point=p.update({x:sourceIndex===0?.5:.43,y:.5}, t+45,viewport,sourceIndex*1000/sourceHz)
      if(sourceIndex>0&&onset===null)onset=t
      if(point.x>=644&&reached===null)reached=t
      assert.ok(point.x>=500&&point.x<=660.000001)
    }
    assert.ok(reached!==null&&onset!==null&&reached-onset<180,`${sourceHz}/${renderHz}: ${reached! - onset!}ms`)
  }
})
test('adaptive clutch discards its velocity and pending travel and retains mirrored gain',()=>{
  const p=new PointerController(config)
  p.update({x:.5,y:.5},45,viewport,0)
  p.update({x:.43,y:.5},104,viewport,59)
  const before=p.update({x:.43,y:.5},120,viewport,59)
  p.reset()
  assert.deepEqual(p.update({x:.9,y:.1},1000,viewport,955),before)
  assert.deepEqual(p.update({x:.9,y:.1},1100,viewport,1055),before)
})

test('adaptive fine movement is filtered rather than trapped inside the legacy7px dead zone',()=>{
  const p=new PointerController(config)
  p.update({x:.5,y:.5},45,viewport,0)
  const palmX=.5-4*.7/(1.6*1000)
  p.update({x:palmX,y:.5},95,viewport,50)
  const moving=p.update({x:palmX,y:.5},145,viewport,100)
  assert.ok(moving.x>500&&moving.x<504,'small deliberate movements must produce continuous feedback')
  for(let t=150;t<=1000;t+=10){
    const point=p.update({x:palmX,y:.5},t+45,viewport,t)
    assert.ok(point.x<=504+1e-9);assert.equal(point.y,400)
  }
  assert.ok(p.update({x:palmX,y:.5},1100,viewport,1055).x>503.9)
})
