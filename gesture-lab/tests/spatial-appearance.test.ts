import test from 'node:test'
import assert from 'node:assert/strict'
import {BoxGeometry, Mesh, MeshPhysicalMaterial, Raycaster, Vector2} from 'three'
import {SpatialAppearance} from '../src/spatial/SpatialAppearance.ts'
import {createSpatialCamera} from '../src/spatial/SpatialScene.ts'

function fixture() {
  const cube = new Mesh(new BoxGeometry(1.2,1.2,1.2),new MeshPhysicalMaterial())
  cube.rotation.set(.18,.42,-.025)
  cube.updateMatrixWorld(true)
  return cube
}

test('cinematic layer adds a bounded three-dimensional stage, not a flat image', () => {
  const cube=fixture(), appearance=new SpatialAppearance(cube)
  let meshes=0
  appearance.stage.traverse(object=>{if(object instanceof Mesh) meshes++})
  assert.ok(meshes>=3, 'the stage must have actual platform, floor and lighting geometry')
  assert.ok(meshes<=24, 'bound the visual-only geometry budget')
  assert.ok(cube.children.length>0, 'cube receives a separate luminous detail layer')
  appearance.dispose()
  cube.geometry.dispose();cube.material.dispose()
})

test('appearance construction and every feedback state preserve target transforms and geometry', () => {
  const cube=fixture(), originalGeometry=cube.geometry
  cube.position.set(.4,.2,.6); cube.updateMatrixWorld(true)
  const before=cube.matrixWorld.clone(), scale=cube.scale.clone()
  const appearance=new SpatialAppearance(cube)
  for (const state of ['IDLE','TARGET_FOCUSED','GRAB_PENDING','GRABBING_3D','RELEASING','UNCERTAIN'] as const) {
    appearance.setState(state)
    cube.updateMatrixWorld(true)
    assert.ok(cube.matrixWorld.equals(before),state)
    assert.ok(cube.scale.equals(scale),state)
    assert.equal(cube.geometry,originalGeometry)
  }
  appearance.dispose()
  assert.equal(cube.geometry,originalGeometry)
  cube.geometry.dispose();cube.material.dispose()
})

test('decorations cannot steal picking and leave original cube hit point unchanged', () => {
  const cube=fixture(), camera=createSpatialCamera(1.6), raycaster=new Raycaster()
  raycaster.setFromCamera(new Vector2(0,0),camera)
  const before=raycaster.intersectObject(cube,false)[0]
  assert.ok(before)
  const appearance=new SpatialAppearance(cube)
  cube.updateMatrixWorld(true);appearance.stage.updateMatrixWorld(true)
  const after=raycaster.intersectObject(cube,false)[0]
  assert.ok(after.point.distanceTo(before.point)<1e-10)
  assert.equal(raycaster.intersectObject(appearance.stage,true).length,0)
  assert.ok(raycaster.intersectObject(cube,true).every(hit=>hit.object===cube))
  appearance.dispose()
  cube.geometry.dispose();cube.material.dispose()
})

test('visual resources dispose once without disposing the controller-owned target', () => {
  const cube=fixture();let targetDisposed=0,disposed=0
  cube.geometry.addEventListener('dispose',()=>targetDisposed++)
  cube.material.addEventListener('dispose',()=>targetDisposed++)
  const appearance=new SpatialAppearance(cube)
  const resources=new Set<object>()
  for (const root of [appearance.stage,...cube.children]) root.traverse(object=>{
    if(object instanceof Mesh){
      if(!resources.has(object.geometry)){resources.add(object.geometry);object.geometry.addEventListener('dispose',()=>disposed++)}
    }
  })
  assert.ok(resources.size>0)
  appearance.dispose();const once=disposed
  assert.ok(once>0)
  appearance.dispose()
  assert.equal(disposed,once)
  assert.equal(targetDisposed,0)
  assert.equal(cube.children.length,0)
  cube.geometry.dispose();cube.material.dispose()
})
