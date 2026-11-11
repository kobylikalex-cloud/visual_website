import test from 'node:test'
import assert from 'node:assert/strict'
import {Box3, BoxGeometry, Mesh, MeshPhysicalMaterial, Vector3} from 'three'
import {SpatialAppearance} from '../src/spatial/SpatialAppearance.ts'
import {createSpatialCamera} from '../src/spatial/SpatialScene.ts'

test('the decorative platform is fully inside the cinematic camera vertical frame', () => {
  const cube=new Mesh(new BoxGeometry(1.2,1.2,1.2),new MeshPhysicalMaterial())
  const appearance=new SpatialAppearance(cube)
  appearance.stage.updateMatrixWorld(true)
  const platforms=appearance.stage.children.filter(child=>child instanceof Mesh && child.geometry.type==='CylinderGeometry')
  assert.equal(platforms.length,2)
  const point=new Vector3()
  try {
    for(const platform of platforms) {
      assert.ok(platform instanceof Mesh)
      // The nearest podium surface stays behind the rotated cube even at far Z.
      // This prevents a visible occluder from covering a still-pickable target.
      assert.ok(new Box3().setFromObject(platform).max.z < -2.4)
      const vertices=platform.geometry.getAttribute('position')
      for(const aspect of [.9,1.5,2.5]) {
        const camera=createSpatialCamera(aspect)
        for(let i=0;i<vertices.count;i++) {
          point.fromBufferAttribute(vertices,i).applyMatrix4(platform.matrixWorld).project(camera)
          assert.ok(Math.abs(point.x)<=.98&&Math.abs(point.y)<=.98,`platform clipped at aspect ${aspect}: ${point.toArray()}`)
        }
      }
    }
  } finally {
    appearance.dispose();cube.geometry.dispose();cube.material.dispose()
  }
})
