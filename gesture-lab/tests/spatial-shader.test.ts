import test from 'node:test'
import assert from 'node:assert/strict'
import {BoxGeometry, Mesh, MeshPhysicalMaterial} from 'three'
import {SpatialAppearance} from '../src/spatial/SpatialAppearance.ts'

test('shader chunks start on their own lines so Three can expand the lighting pipeline', () => {
  const cube=new Mesh(new BoxGeometry(1.2,1.2,1.2),new MeshPhysicalMaterial())
  const appearance=new SpatialAppearance(cube)
  for(const root of [appearance.stage,...cube.children])root.traverse(object=>{
    if(!(object instanceof Mesh))return
    for(const material of (Array.isArray(object.material)?object.material:[object.material])){
      if(!('fragmentShader' in material))continue
      const shader=String(material.fragmentShader)
      for(const line of shader.split('\n'))if(line.includes('#include')){
        assert.match(line,/^\s*#include\s+<[^>]+>\s*$/,'GLSL chunks cannot be appended to a statement')
      }
    }
  })
  appearance.dispose();cube.geometry.dispose();cube.material.dispose()
})
