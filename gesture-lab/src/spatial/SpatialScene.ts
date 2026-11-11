import {
  ACESFilmicToneMapping, BoxGeometry, DirectionalLight, EdgesGeometry,
  GridHelper, HemisphereLight, LineBasicMaterial, LineSegments, Mesh,
  MeshPhysicalMaterial, PerspectiveCamera, Plane, PMREMGenerator, Raycaster,
  Scene, Vector2, Vector3, WebGLRenderer, Euler,
} from 'three'
import type {WebGLRenderTarget} from 'three'
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js'
import type {Point2} from '../control/types.ts'
import type {CanvasRect,SpatialBounds,SpatialHit,SpatialScenePort,SpatialSnapshot,SpatialState,Vec3} from './types.ts'
import {nextSpatialRenderTime} from './SpatialRenderClock.ts'
import {SpatialAppearance} from './SpatialAppearance.ts'

export function pointerToNdc(pointer:Point2,rect:CanvasRect):Point2|null {
  if (![pointer.x,pointer.y,rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0) return null
  return {x:((pointer.x-rect.left)/rect.width)*2-1,y:1-((pointer.y-rect.top)/rect.height)*2}
}

export function createSpatialCamera(aspect:number):PerspectiveCamera {
  const camera=new PerspectiveCamera(42,Number.isFinite(aspect)&&aspect>0?aspect:1,.1,60)
  camera.position.set(0,0,7)
  camera.lookAt(0,0,0)
  camera.updateMatrixWorld(true)
  return camera
}

export function projectPointerToPlane(pointer:Point2,rect:CanvasRect,z:number,camera:PerspectiveCamera):Vec3|null {
  const ndc=pointerToNdc(pointer,rect)
  if (!ndc||!Number.isFinite(z)) return null
  camera.updateMatrixWorld(true)
  const raycaster=new Raycaster()
  raycaster.setFromCamera(new Vector2(ndc.x,ndc.y),camera)
  const normal=camera.getWorldDirection(new Vector3())
  const plane=new Plane().setFromNormalAndCoplanarPoint(normal,new Vector3(0,0,z))
  const hit=raycaster.ray.intersectPlane(plane,new Vector3())
  return hit?{x:hit.x,y:hit.y,z:hit.z}:null
}

export function raycastSpatialCube(pointer:Point2,rect:CanvasRect,camera:PerspectiveCamera,mesh:Mesh):Vec3|null {
  const ndc=pointerToNdc(pointer,rect)
  if (!ndc||ndc.x < -1||ndc.x > 1||ndc.y < -1||ndc.y > 1) return null
  camera.updateMatrixWorld(true)
  mesh.updateWorldMatrix(true,false)
  const raycaster=new Raycaster()
  raycaster.setFromCamera(new Vector2(ndc.x,ndc.y),camera)
  const hit=raycaster.intersectObject(mesh,false)[0]
  return hit?{x:hit.point.x,y:hit.point.y,z:hit.point.z}:null
}

export function clampSpatialPosition(position:Vec3,bounds:SpatialBounds):Vec3 {
  return {
    x:Math.max(bounds.min.x,Math.min(bounds.max.x,position.x)),
    y:Math.max(bounds.min.y,Math.min(bounds.max.y,position.y)),
    z:Math.max(bounds.min.z,Math.min(bounds.max.z,position.z)),
  }
}

export function translateWithGripOffset(point:Vec3,offset:Vec3,bounds:SpatialBounds):Vec3 {
  return clampSpatialPosition({x:point.x+offset.x,y:point.y+offset.y,z:point.z+offset.z},bounds)
}

let nextOwnerToken=1

/** Conservative center limits for this fixed, camera-facing scene, including the
 * cube's presentation rotation. Use the nearest corner for the perspective span. */
export function visibleSpatialBounds(camera:PerspectiveCamera,limits:SpatialBounds):SpatialBounds {
  const extent={x:0,y:0,z:0},rotation=new Euler(.18,.42,-.025)
  for (const x of [-.6,.6]) for (const y of [-.6,.6]) for (const z of [-.6,.6]) {
    const p=new Vector3(x,y,z).applyEuler(rotation)
    extent.x=Math.max(extent.x,Math.abs(p.x));extent.y=Math.max(extent.y,Math.abs(p.y));extent.z=Math.max(extent.z,Math.abs(p.z))
  }
  const tangent=Math.tan(camera.fov*Math.PI/360)/camera.zoom
  const fitDistance=Math.max(extent.y/tangent,extent.x/(tangent*camera.aspect))
  const maxZ=Math.min(limits.max.z,camera.position.z-extent.z-fitDistance)
  const halfY=(camera.position.z-maxZ-extent.z)*tangent
  const x=Math.max(0,halfY*camera.aspect-extent.x),y=Math.max(0,halfY-extent.y)
  return {min:{x:Math.max(limits.min.x,-x),y:Math.max(limits.min.y,-y),z:Math.min(limits.min.z,maxZ)},
    max:{x:Math.min(limits.max.x,x),y:Math.min(limits.max.y,y),z:maxZ}}
}

export type SpatialRenderMetrics={fps:number;renderMs:number;frames:number}

/** Renderer-owned mutable transforms. Construction is the only browser/GPU boundary. */
export class SpatialSceneController implements SpatialScenePort {
  readonly bounds:SpatialBounds={min:{x:-2.6,y:-1.6,z:-1.5},max:{x:2.6,y:1.6,z:1.8}}
  private readonly ownerToken=nextOwnerToken++
  private readonly canvas:HTMLCanvasElement
  private readonly renderer:WebGLRenderer
  private readonly scene=new Scene()
  private readonly camera=createSpatialCamera(1)
  private readonly geometry=new BoxGeometry(1.2,1.2,1.2)
  private readonly material=new MeshPhysicalMaterial({
    color:0x8cb7cd,metalness:.10,roughness:.17,clearcoat:1,clearcoatRoughness:.12,
    transmission:0,transparent:true,opacity:.23,depthWrite:false,
    thickness:.65,ior:1.45,envMapIntensity:.4,
    emissive:0x185571,emissiveIntensity:.03,
  })
  private readonly cube=new Mesh(this.geometry,this.material)
  private readonly edges=new LineSegments(new EdgesGeometry(this.geometry),new LineBasicMaterial({color:0x9bcbd0,transparent:true,opacity:.3}))
  private readonly grid=new GridHelper(12,24,0x48646b,0x273a42)
  private readonly keyLight=new DirectionalLight(0xd9f4f4,3)
  private readonly environment:WebGLRenderTarget
  private readonly appearance:SpatialAppearance
  private disposed=false
  private feedback:SpatialState='IDLE'
  private nativeHover=false
  private rect:CanvasRect={left:0,top:0,width:1,height:1}
  private width=0
  private height=0
  private pixelRatio=0
  private nextRender=-Infinity
  private metricStart:number|null=null
  private metricFrames=0
  private metrics:SpatialRenderMetrics={fps:0,renderMs:0,frames:0}

  constructor(canvas:HTMLCanvasElement) {
    this.canvas=canvas
    this.renderer=new WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'low-power'})
    this.renderer.setClearColor(0x000000,0)
    this.renderer.toneMapping=ACESFilmicToneMapping
    this.renderer.toneMappingExposure=1.08
    this.renderer.transmissionResolutionScale=.5
    const environmentScene=new RoomEnvironment()
    const generator=new PMREMGenerator(this.renderer)
    this.environment=generator.fromScene(environmentScene,.04)
    this.scene.environment=this.environment.texture
    environmentScene.dispose()
    generator.dispose()

    // A fixed presentation angle reveals the cube's three faces. Input never changes rotation.
    this.cube.rotation.set(.18,.42,-.025)
    this.cube.name='spatial-cube'
    this.cube.add(this.edges)
    this.scene.add(this.cube)
    this.appearance=new SpatialAppearance(this.cube)
    this.scene.add(this.appearance.stage)
    this.keyLight.position.set(-3,4,5)
    const fill=new DirectionalLight(0x72dfe9,2)
    fill.position.set(4,1,-2)
    const warm=new DirectionalLight(0xbb8bff,1.4)
    warm.position.set(1,4,2)
    this.scene.add(this.keyLight,fill,warm,new HemisphereLight(0xc5e4eb,0x14242d,1.1))
    this.grid.position.y=-2.3
    this.grid.visible=false
    this.scene.add(this.grid)
    this.resize()
  }

  getOwnerToken():number { return this.disposed?-1:this.ownerToken }

  getRect():CanvasRect {
    if (!this.disposed) {
      const rect=this.canvas.getBoundingClientRect()
      this.rect={left:rect.left,top:rect.top,width:rect.width,height:rect.height}
    }
    return {...this.rect}
  }

  getPosition():Vec3 { return {x:this.cube.position.x,y:this.cube.position.y,z:this.cube.position.z} }

  setPosition(position:Vec3):void {
    if (this.disposed||![position.x,position.y,position.z].every(Number.isFinite)) return
    const next=clampSpatialPosition(position,this.bounds)
    this.cube.position.set(next.x,next.y,next.z)
    this.cube.updateMatrixWorld(true)
  }

  pick(pointer:Point2):SpatialHit|null {
    if (this.disposed) return null
    this.resize()
    const point=raycastSpatialCube(pointer,this.getRect(),this.camera,this.cube)
    return point?{id:'spatial-cube',ownerToken:this.ownerToken,point,position:this.getPosition()}:null
  }

  planePoint(pointer:Point2,z:number):Vec3|null {
    if (this.disposed) return null
    this.resize()
    return projectPointerToPlane(pointer,this.getRect(),z,this.camera)
  }

  resize():void {
    if (this.disposed) return
    const rect=this.getRect()
    if (rect.width<=0||rect.height<=0) return
    const dpr=Math.min(window.devicePixelRatio||1,1.75)
    if (rect.width===this.width&&rect.height===this.height&&dpr===this.pixelRatio) return
    this.width=rect.width
    this.height=rect.height
    this.pixelRatio=dpr
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(rect.width,rect.height,false)
    this.camera.aspect=rect.width/rect.height
    this.camera.updateProjectionMatrix()
    const visible=visibleSpatialBounds(this.camera,{min:{x:-2.6,y:-1.6,z:-1.5},max:{x:2.6,y:1.6,z:1.8}})
    this.bounds.min=visible.min;this.bounds.max=visible.max
    this.setPosition(this.getPosition())
  }

  setFeedback(value:SpatialSnapshot|SpatialState|null):void {
    if (this.disposed) return
    this.feedback=typeof value==='string'?value:value?.state??'IDLE'
    this.updateFeedback()
  }

  setNativeHover(hover:boolean):void {
    if (this.disposed||this.nativeHover===hover) return
    this.nativeHover=hover
    this.updateFeedback()
  }

  private updateFeedback():void {
    const grabbed=this.feedback==='GRABBING_3D'
    const pending=this.feedback==='GRAB_PENDING'
    const focused=this.feedback==='TARGET_FOCUSED'||pending||this.nativeHover
    this.edges.material.color.setHex(grabbed?0xd2f8f2:pending?0xdfcba5:focused?0x93e0e4:0x9bcbd0)
    this.edges.material.opacity=grabbed?.95:focused?.76:.3
    this.material.emissiveIntensity=grabbed?.12:focused?.075:.03
    this.appearance.setState(this.nativeHover&&this.feedback==='IDLE'?'TARGET_FOCUSED':this.feedback)
  }

  setDebug(enabled:boolean):void { if (!this.disposed) this.grid.visible=enabled }

  reset():void {
    this.setPosition({x:0,y:0,z:0})
    this.setNativeHover(false)
    this.setFeedback('IDLE')
  }

  render(now:number):boolean {
    if (this.disposed) return false
    const deadline=nextSpatialRenderTime(now,this.nextRender)
    if(deadline===null)return false
    this.resize()
    if (this.rect.width<=0||this.rect.height<=0) return false
    this.nextRender=deadline
    // Lighting only: held and released object transforms remain exactly unchanged.
    this.keyLight.intensity=3+Math.sin(now*.00025)*.035
    const started=performance.now()
    this.renderer.render(this.scene,this.camera)
    this.metrics.renderMs=performance.now()-started
    this.metrics.frames++
    if (this.metricStart===null||now-this.metricStart>2000) { this.metricStart=now; this.metricFrames=0 }
    this.metricFrames++
    const elapsed=now-this.metricStart
    if (elapsed>=500) this.metrics.fps=(this.metricFrames-1)*1000/elapsed
    return true
  }

  getMetrics():SpatialRenderMetrics { return {...this.metrics} }

  dispose():void {
    if (this.disposed) return
    this.getRect()
    this.disposed=true
    this.appearance.dispose()
    this.geometry.dispose()
    this.material.dispose()
    this.edges.geometry.dispose()
    this.edges.material.dispose()
    this.grid.geometry.dispose()
    const gridMaterials=Array.isArray(this.grid.material)?this.grid.material:[this.grid.material]
    gridMaterials.forEach(material=>material.dispose())
    this.environment.dispose()
    this.scene.environment=null
    this.scene.clear()
    this.renderer.dispose()
  }
}
