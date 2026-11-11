import test from 'node:test'
import assert from 'node:assert/strict'
import {BoxGeometry, Mesh, MeshBasicMaterial, Vector3} from 'three'
import {
  clampSpatialPosition, createSpatialCamera, pointerToNdc,
  projectPointerToPlane, raycastSpatialCube, translateWithGripOffset, visibleSpatialBounds,
} from '../src/spatial/SpatialScene.ts'

const rect = {left:100,top:50,width:800,height:400}
const close = (actual:number, expected:number) => assert.ok(Math.abs(actual-expected)<1e-7, `${actual} ≠ ${expected}`)

test('canvas offset and CSS dimensions map global pointer pixels to NDC', () => {
  assert.deepEqual(pointerToNdc({x:500,y:250},rect),{x:0,y:0})
  assert.deepEqual(pointerToNdc({x:100,y:50},rect),{x:-1,y:1})
  assert.deepEqual(pointerToNdc({x:900,y:450},rect),{x:1,y:-1})
  assert.equal(pointerToNdc({x:0,y:0},{...rect,width:0}),null)
})

test('perspective intersection accounts for aspect, vertical FOV and depth', () => {
  const camera = createSpatialCamera(2)
  const point = projectPointerToPlane({x:900,y:50},rect,0,camera)!
  close(point.x,5.374096490495822)
  close(point.y,2.687048245247911)
  close(point.z,0)
  const near = projectPointerToPlane({x:900,y:50},rect,1,camera)!
  close(near.x,4.60636842042499)
  close(near.y,2.303184210212495)
  assert.equal(projectPointerToPlane({x:500,y:250},rect,8,camera),null)
})

test('resizing camera aspect keeps vertical span and adjusts horizontal span', () => {
  const wide = projectPointerToPlane({x:900,y:250},rect,0,createSpatialCamera(2))!
  const squareRect = {...rect,width:400}
  const square = projectPointerToPlane({x:500,y:250},squareRect,0,createSpatialCamera(1))!
  close(wide.x,square.x*2)
})

test('raycasting requires actual mesh intersection and reports world surface point', () => {
  const mesh = new Mesh(new BoxGeometry(1.2,1.2,1.2),new MeshBasicMaterial())
  const camera = createSpatialCamera(2)
  mesh.updateMatrixWorld(true)
  const hit = raycastSpatialCube({x:500,y:250},rect,camera,mesh)!
  close(hit.x,0)
  close(hit.y,0)
  close(hit.z,.6)
  assert.equal(raycastSpatialCube({x:800,y:250},rect,camera,mesh),null)
  mesh.position.set(1,0,0)
  mesh.updateMatrixWorld(true)
  assert.equal(raycastSpatialCube({x:500,y:250},rect,camera,mesh),null)
  mesh.geometry.dispose()
  mesh.material.dispose()
})

test('constant grip offset preserves object center at acquisition and through translation', () => {
  const bounds={min:{x:-2.6,y:-1.6,z:-1.5},max:{x:2.6,y:1.6,z:1.8}}
  assert.deepEqual(translateWithGripOffset({x:.4,y:.2,z:0},{x:-.4,y:-.2,z:0},bounds),{x:0,y:0,z:0})
  assert.deepEqual(translateWithGripOffset({x:1,y:.7,z:1},{x:-.4,y:-.2,z:0},bounds),{x:.6,y:.49999999999999994,z:1})
})

test('virtual limits clamp all axes without mutating input or bounds', () => {
  const bounds={min:{x:-2.6,y:-1.6,z:-1.5},max:{x:2.6,y:1.6,z:1.8}}
  const position={x:10,y:-10,z:10}
  assert.deepEqual(clampSpatialPosition(position,bounds),{x:2.6,y:-1.6,z:1.8})
  assert.deepEqual(position,{x:10,y:-10,z:10})
  assert.deepEqual(clampSpatialPosition({x:-10,y:10,z:-10},bounds),{x:-2.6,y:1.6,z:-1.5})
})

test('invalid projection input is rejected before it can enter the scene', () => {
  const camera=createSpatialCamera(2)
  assert.equal(pointerToNdc({x:NaN,y:100},rect),null)
  assert.equal(projectPointerToPlane({x:500,y:250},rect,NaN,camera),null)
  assert.equal(projectPointerToPlane({x:500,y:250},{...rect,height:-1},0,camera),null)
})

test('movement limits keep every rotated cube corner visible at the nearest depth on phone and wide canvases', () => {
  const limits={min:{x:-2.6,y:-1.6,z:-1.5},max:{x:2.6,y:1.6,z:1.8}}
  for (const aspect of [.75,1,2.8]) {
    const camera=createSpatialCamera(aspect)
    const bounds=visibleSpatialBounds(camera,limits)
    const cube=new Mesh(new BoxGeometry(1.2,1.2,1.2),new MeshBasicMaterial())
    cube.rotation.set(.18,.42,-.025)
    for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) {
      cube.position.set(x,y,bounds.max.z);cube.updateMatrixWorld(true)
      for (const cx of [-.6,.6]) for (const cy of [-.6,.6]) for (const cz of [-.6,.6]) {
        const ndc=new Vector3(cx,cy,cz).applyMatrix4(cube.matrixWorld).project(camera)
        assert.ok(Math.abs(ndc.x)<=1&&Math.abs(ndc.y)<=1,`aspect ${aspect}: corner ${ndc.toArray()}`)
      }
    }
    assert.ok(bounds.max.x<=limits.max.x&&bounds.max.y<=limits.max.y)
    assert.ok(bounds.min.x<=0&&bounds.max.x>=0&&bounds.min.y<=0&&bounds.max.y>=0)
    cube.geometry.dispose();cube.material.dispose()
  }
})
