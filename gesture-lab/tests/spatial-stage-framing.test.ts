import test from 'node:test'
import assert from 'node:assert/strict'
import {BoxGeometry, Mesh, MeshPhysicalMaterial, Vector3} from 'three'
import {SpatialAppearance} from '../src/spatial/SpatialAppearance.ts'
import {createSpatialCamera} from '../src/spatial/SpatialScene.ts'

test('the decorative platform is fully inside the unchanged camera vertical frame', () => {
  const cube=new Mesh(new BoxGeometry(1.2,1.2,1.2),new MeshPhysicalMaterial())
  const appearance=new SpatialAppearance(cube)
  const camera=createSpatialCamera(2.5)
  appearance.stage.updateMatrixWorld(true)
  const platforms=appearance.stage.children.filter(child=>child instanceof Mesh && child.geometry.type==='CylinderGeometry')
  assert.equal(platforms.length,2)
  const point=new Vector3()
  try {
    for(const platform of platforms) {
      assert.ok(platform instanceof Mesh)
      const vertices=platform.geometry.getAttribute('position')
      for(let i=0;i<vertices.count;i++) {
        point.fromBufferAttribute(vertices,i).applyMatrix4(platform.matrixWorld).project(camera)
        assert.ok(point.y>=-.98 && point.y<=.98,`platform clipped at NDC height ${point.y}`)
      }
    }
  } finally {
    appearance.dispose();cube.geometry.dispose();cube.material.dispose()
  }
})
