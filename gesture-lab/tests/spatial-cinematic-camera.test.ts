import test from 'node:test'
import assert from 'node:assert/strict'
import {BoxGeometry, Mesh, MeshBasicMaterial, Vector3} from 'three'
import type {PerspectiveCamera} from 'three'
import {
  clampSpatialPosition, createSpatialCamera, projectPointerToPlane,
  raycastSpatialCube, translateWithGripOffset, visibleSpatialBounds,
} from '../src/spatial/SpatialScene.ts'
import {SpatialInteractionEngine} from '../src/spatial/SpatialInteractionEngine.ts'
import type {Point2, TrackedHand} from '../src/control/types.ts'
import type {CanvasRect, SpatialInput, SpatialScenePort, Vec3} from '../src/spatial/types.ts'

const aspects=[.9,1.5,2.7]
const limits={min:{x:-2.6,y:-1.6,z:-1.5},max:{x:2.6,y:1.6,z:1.8}}
const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} differs from ${expected}`)
const nearPosition=(actual:Vec3,expected:Vec3)=>{near(actual.x,expected.x);near(actual.y,expected.y);near(actual.z,expected.z)}

function cubeAt(position:Vec3={x:0,y:0,z:0}) {
  const cube=new Mesh(new BoxGeometry(1.2,1.2,1.2),new MeshBasicMaterial())
  cube.rotation.set(.18,.42,-.025)
  cube.position.set(position.x,position.y,position.z)
  cube.updateMatrixWorld(true)
  return cube
}

function pixelFromWorld(world:Vector3,camera:PerspectiveCamera,rect:CanvasRect):Point2 {
  const ndc=world.clone().project(camera)
  return {x:rect.left+(ndc.x+1)*rect.width/2,y:rect.top+(1-ndc.y)*rect.height/2}
}

test('cinematic camera keeps the centered world-axis projection and widens only on narrow canvases',()=>{
  for(const aspect of aspects) {
    const camera=createSpatialCamera(aspect)
    assert.deepEqual(camera.position.toArray(),[0,0,12])
    nearPosition(camera.getWorldDirection(new Vector3()),{x:0,y:0,z:-1})
    near(camera.aspect,aspect)
    const expectedFov=2*Math.atan(Math.tan(8*Math.PI/180)*Math.max(1,1.5/aspect))*180/Math.PI
    near(camera.fov,expectedFov)
    nearPosition(projectPointerToPlane({x:450,y:300},{left:0,top:0,width:900,height:600},0,camera)!,{x:0,y:0,z:0})
  }
})

test('the unchanged interactive cube occupies at least forty percent of desktop canvas height',()=>{
  const cube=cubeAt()
  try {
    for(const aspect of [1.5,2.7]) {
      const camera=createSpatialCamera(aspect)
      const heights:number[]=[]
      for(const x of [-.6,.6])for(const y of [-.6,.6])for(const z of [-.6,.6]) {
        heights.push(new Vector3(x,y,z).applyMatrix4(cube.matrixWorld).project(camera).y)
      }
      const heightFraction=(Math.max(...heights)-Math.min(...heights))/2
      assert.ok(heightFraction>=.4&&heightFraction<=.5,`desktop cube height fraction ${heightFraction}`)
    }
  } finally {cube.geometry.dispose();cube.material.dispose()}
})

test('off-center real surface hits reproject without a grip jump at every supported aspect and depth',()=>{
  const cube=cubeAt()
  try {
    for(const aspect of aspects)for(const z of [-1.5,0,1.8]) {
      const camera=createSpatialCamera(aspect)
      const rect={left:73,top:41,width:540*aspect,height:540}
      const position={x:.12,y:-.08,z}
      cube.position.set(position.x,position.y,position.z);cube.updateMatrixWorld(true)
      for(const localPoint of [new Vector3(-.3,.22,.6),new Vector3(.24,-.21,.6)]) {
        const pointer=pixelFromWorld(localPoint.clone().applyMatrix4(cube.matrixWorld),camera,rect)
        const hit=raycastSpatialCube(pointer,rect,camera,cube)
        assert.ok(hit,'a point on the visible cube face must select the actual mesh')
        const projected=projectPointerToPlane(pointer,rect,hit.z,camera)
        assert.ok(projected)
        nearPosition(projected,hit)
        const grip={x:position.x-hit.x,y:position.y-hit.y,z:position.z-hit.z}
        nearPosition(translateWithGripOffset(projected,grip,visibleSpatialBounds(camera,limits)),position)
      }
    }
  } finally {cube.geometry.dispose();cube.material.dispose()}
})

test('framing retains useful movement and keeps every rotated corner visible at both depth limits',()=>{
  const cube=cubeAt()
  try {
    for(const aspect of aspects) {
      const camera=createSpatialCamera(aspect)
      const bounds=visibleSpatialBounds(camera,limits)
      assert.ok([...Object.values(bounds.min),...Object.values(bounds.max)].every(Number.isFinite))
      assert.ok(bounds.max.x>=.9&&bounds.min.x<=-.9,`usable horizontal travel at aspect ${aspect}`)
      assert.ok(bounds.max.y>=.5&&bounds.min.y<=-.5,`usable vertical travel at aspect ${aspect}`)
      assert.equal(bounds.min.z,limits.min.z);assert.equal(bounds.max.z,limits.max.z)
      for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]) {
        cube.position.set(x,y,z);cube.updateMatrixWorld(true)
        for(const cx of [-.6,.6])for(const cy of [-.6,.6])for(const cz of [-.6,.6]) {
          const ndc=new Vector3(cx,cy,cz).applyMatrix4(cube.matrixWorld).project(camera)
          assert.ok(Math.abs(ndc.x)<=1+1e-9&&Math.abs(ndc.y)<=1+1e-9&&ndc.z>=-1&&ndc.z<=1,
            `aspect ${aspect}, center ${x}/${y}/${z}, corner ${ndc.toArray()}`)
        }
      }
    }
  } finally {cube.geometry.dispose();cube.material.dispose()}
})

test('protected interaction engine acquires, translates and releases with actual cinematic projection',()=>{
  for(const aspect of aspects) {
    const camera=createSpatialCamera(aspect),cube=cubeAt()
    const rect={left:72,top:38,width:540*aspect,height:540}
    const pointer=pixelFromWorld(new Vector3(.23,.17,.6).applyMatrix4(cube.matrixWorld),camera,rect)
    const bounds=visibleSpatialBounds(camera,limits)
    const position=():Vec3=>({x:cube.position.x,y:cube.position.y,z:cube.position.z})
    const port:SpatialScenePort={
      bounds,getOwnerToken:()=>1,getRect:()=>({...rect}),getPosition:position,
      setPosition:value=>{const p=clampSpatialPosition(value,bounds);cube.position.set(p.x,p.y,p.z);cube.updateMatrixWorld(true)},
      planePoint:(point,z)=>projectPointerToPlane(point,rect,z,camera),
      pick:point=>{const hit=raycastSpatialCube(point,rect,camera,cube);return hit?{id:'spatial-cube',ownerToken:1,point:hit,position:position()}:null},
    }
    const engine=new SpatialInteractionEngine(port)
    const input=(time:number,pose:TrackedHand['pose']='OPEN',x=.5,y=.5,relative=0):SpatialInput=>({
      timestampMs:time,receivedAt:time,
      hands:[{id:1,center:{x,y},pose,orientation:'TRANSITION',timestampMs:time}],
      ambiguous:false,viewport:{width:rect.width+144,height:780},
      base:{pointer:{...pointer},focusId:null,confirmed:true,scrollActive:false,scrollEntering:false},
      depth:{valid:true,scale:.2,relative,neutralScale:.2,quality:'valid',reason:'real projection regression'},
    })
    try {
      for(const time of [0,50,100,150])engine.update(input(time))
      assert.equal(engine.snapshot.ready,true)
      for(const time of [200,250,300,350,400])engine.update(input(time,'FIST'))
      assert.equal(engine.snapshot.state,'GRABBING_3D')
      engine.tick(400)
      nearPosition(position(),{x:0,y:0,z:0})
      engine.update(input(450,'FIST',.49,.51))
      engine.tick(475)
      const translated=position()
      assert.ok(translated.x>0&&translated.y<0,'mirrored hand X and screen Y move in the expected world directions')
      near(translated.z,0)
      engine.update(input(500,'FIST',.49,.51,.1))
      engine.tick(525)
      const depthMoved=position()
      assert.ok(depthMoved.z>0&&depthMoved.z<=.3,'closer relative hand depth advances the cube without overshoot')
      const released=engine.update(input(550,'OPEN',.49,.51,.1))
      assert.equal(released.state,'RELEASING')
      engine.tick(550)
      nearPosition(position(),depthMoved)
      engine.tick(600)
      nearPosition(position(),depthMoved)
    } finally {cube.geometry.dispose();cube.material.dispose()}
  }
})
