import test from 'node:test'
import assert from 'node:assert/strict'
import {PointerController} from '../src/control/PointerController.ts'
import {DEFAULT_GESTURE_CONFIG,TOUCHPAD_GESTURE_CONFIG} from '../src/control/GestureConfig.ts'

test('the compact app touchpad reaches a screen edge with half the former hand travel while retaining1.6x gain',()=>{
  const old=new PointerController({...DEFAULT_GESTURE_CONFIG,pointerMode:'relative',pointerSmoothingMs:0})
  const compact=new PointerController({...TOUCHPAD_GESTURE_CONFIG,pointerSmoothingMs:0})
  const view={width:1000,height:800}
  old.update({x:.5,y:.5},0,view);compact.update({x:.5,y:.5},0,view)
  const a=old.update({x:.5-.7/(2*1.6),y:.5},50,view)
  const b=compact.update({x:.5-.35/(2*1.6),y:.5},50,view)
  assert.ok(Math.abs(a.x-1000)<1e-6)
  assert.ok(Math.abs(b.x-1000)<1e-6)
  assert.equal(TOUCHPAD_GESTURE_CONFIG.pointerGain,1.6)
  compact.reset()
  assert.deepEqual(compact.update({x:.8,y:.2},1000,view),b,'clutching does not warp to a new camera position')
  compact.recenter()
  assert.deepEqual(compact.update({x:.1,y:.9},1100,view),{x:500,y:400})
})
