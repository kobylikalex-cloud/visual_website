import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, CylinderGeometry,
  DoubleSide, ExtrudeGeometry, FrontSide, Group, Material, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, Quaternion, RingGeometry, ShaderMaterial,
  Shape, SphereGeometry, Vector3,
} from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js'
import type {SpatialState} from './types.ts'

const CYAN=new Color('#54e9fa'), VIOLET=new Color('#b989ff')
const noPicking=()=>undefined
const planeVertex=`varying vec2 vUv; varying vec3 vPoint;
void main(){vUv=uv;vPoint=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`
const outputColor=`
#include <tonemapping_fragment>
#include <colorspace_fragment>`

/** Visual-only optics. Owns no controls, camera, target transform or render clock.
 * Geometry and shaders are bounded; no full-screen bloom, reflection camera,
 * downloaded texture, animation loop or screen-sized intermediate render target.
 */
export class SpatialAppearance {
  readonly stage=new Group()
  private readonly details=new Group()
  private readonly geometries=new Set<BufferGeometry>()
  private readonly materials=new Set<Material>()
  private readonly edgeMaterial:MeshBasicMaterial
  private readonly glowMaterial:MeshBasicMaterial
  private readonly ringMaterial:MeshBasicMaterial
  private readonly glassMaterial:ShaderMaterial
  private readonly cube:Mesh
  private disposed=false

  constructor(cube:Mesh){
    this.cube=cube
    this.stage.name='cinematic-decoration-only'
    this.details.name='noninteractive-cube-lighting'
    this.edgeMaterial=this.ownMaterial(new MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.92,depthWrite:false,toneMapped:false}))
    this.glowMaterial=this.ownMaterial(new MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.18,depthWrite:false,blending:AdditiveBlending,toneMapped:false}))
    this.ringMaterial=this.ownMaterial(new MeshBasicMaterial({color:0x70b9d6,transparent:true,opacity:.42,side:DoubleSide,blending:AdditiveBlending,depthWrite:false,toneMapped:false}))
    const edges:[Vector3,Vector3][]=[]
    for(const axis of [0,1,2])for(const a of [-.595,.595])for(const b of [-.595,.595]){
      const start=new Vector3(),end=new Vector3()
      start.setComponent(axis,-.57);end.setComponent(axis,.57)
      for(const point of [start,end]){point.setComponent((axis+1)%3,a);point.setComponent((axis+2)%3,b)}
      edges.push([start,end])
    }
    this.details.add(this.rails(edges,.008,this.edgeMaterial),this.rails(edges,.023,this.glowMaterial))
    // Rounded surface normals and reflected studio strips give the glass thickness.
    // The original BoxGeometry stays the only raycast target.
    this.glassMaterial=this.ownMaterial(new ShaderMaterial({
      transparent:true,depthWrite:false,side:FrontSide,toneMapped:false,
      uniforms:{uCyan:{value:CYAN},uViolet:{value:VIOLET},uEmphasis:{value:1}},
      vertexShader:`varying vec3 vNormal;varying vec3 vWorld;varying vec3 vLocal;
        void main(){vec4 world=modelMatrix*vec4(position,1.0);vWorld=world.xyz;
          vNormal=normalize(mat3(modelMatrix)*normal);vLocal=position;
          gl_Position=projectionMatrix*viewMatrix*world;}`,
      fragmentShader:`varying vec3 vNormal;varying vec3 vWorld;varying vec3 vLocal;
        uniform vec3 uCyan;uniform vec3 uViolet;uniform float uEmphasis;
        void main(){vec3 n=normalize(vNormal),v=normalize(cameraPosition-vWorld);
          float fres=pow(1.0-max(dot(n,v),0.0),2.2);vec3 r=reflect(-v,n);
          vec3 tint=mix(uCyan,uViolet,smoothstep(-.48,.56,vLocal.x));
          float key=pow(max(dot(r,normalize(vec3(-.7,1.2,1.4))),0.0),34.0);
          float violet=pow(max(dot(r,normalize(vec3(1.0,-.55,1.3))),0.0),24.0);
          // Reflected softboxes are evaluated per fragment: bevels catch the light
          // while broad faces retain dark, transparent areas between reflections.
          float strip=exp(-pow((r.x+r.y*.26+.22)*22.0,2.0));
          float ribbon=exp(-pow((r.y-r.x*.18-.52)*26.0,2.0));
          float lower=exp(-pow((vLocal.y+.47)*12.0,2.0));
          float edge=max(max(smoothstep(.53,.596,abs(vLocal.x))*smoothstep(.53,.596,abs(vLocal.y)),
            smoothstep(.53,.596,abs(vLocal.x))*smoothstep(.53,.596,abs(vLocal.z))),
            smoothstep(.53,.596,abs(vLocal.y))*smoothstep(.53,.596,abs(vLocal.z)));
          vec3 c=tint*(.075+fres*.5+edge*.72+lower*.10);
          c+=vec3(.75,.94,1.0)*(key*.95+strip*.27+ribbon*.12)+uViolet*violet*.55;
          float a=.16+fres*.34+edge*.30+key*.22+strip*.12;
          gl_FragColor=vec4(c*uEmphasis,min(a,.86));
          ${outputColor}
        }`,
    }))
    const shell=this.mesh(new RoundedBoxGeometry(1.198,1.198,1.198,3,.035),this.glassMaterial)
    shell.name='optical-glass-shell';shell.renderOrder=3;this.details.add(shell)
    const inner=this.ownMaterial(new ShaderMaterial({
      transparent:true,depthWrite:false,side:DoubleSide,blending:AdditiveBlending,toneMapped:false,vertexShader:planeVertex,
      fragmentShader:`varying vec2 vUv;varying vec3 vPoint;
        void main(){vec2 p=vUv*2.0-1.0;
          float c=exp(-dot((p-vec2(-.68,-.7))*vec2(1.7,.9),(p-vec2(-.68,-.7))*vec2(1.7,.9))*2.5);
          float v=exp(-dot((p-vec2(.76,-.4))*vec2(1.7,1.0),(p-vec2(.76,-.4))*vec2(1.7,1.0))*3.0);
          float streak=exp(-pow((p.x+p.y*.24+.52)*14.0,2.0))*.09;
          float a=pow(max(0.0,1.0-abs(p.x)),.5)*pow(max(0.0,1.0-abs(p.y)),.5);
          gl_FragColor=vec4(vec3(.05,.7,1.0)*(c+streak)+vec3(.58,.15,1.0)*v,a*.42);
          ${outputColor}
        }`,
    }))
    const core=this.mesh(new PlaneGeometry(1.14,1.14),inner);core.position.z=-.46;this.details.add(core)
    const innerFloor=this.mesh(new PlaneGeometry(1.14,1.14),inner)
    innerFloor.rotation.x=-Math.PI/2;innerFloor.position.y=-.54;this.details.add(innerFloor)
    const innerSide=this.mesh(new PlaneGeometry(1.14,1.14),inner)
    innerSide.rotation.y=Math.PI/2;innerSide.position.x=-.54;this.details.add(innerSide)
    const corners:BufferGeometry[]=[]
    for(const x of [-.58,.58])for(const y of [-.58,.58])for(const z of [-.58,.58]){
      const g=new SphereGeometry(.018,8,6);g.translate(x,y,z);corners.push(g)
    }
    this.details.add(this.mesh(this.join(corners),this.ownMaterial(new MeshBasicMaterial({color:0xd4faff,toneMapped:false}))))
    cube.add(this.details)

    // Dark brushed metal, not a bright grey cylinder competing with the object.
    const metal=this.ownMaterial(new MeshStandardMaterial({color:0x07101c,metalness:.78,roughness:.27,envMapIntensity:.25}))
    const platform=this.ownMaterial(new ShaderMaterial({
      toneMapped:false,uniforms:{uCyan:{value:CYAN},uViolet:{value:VIOLET}},
      vertexShader:`varying vec3 p;varying vec3 n;void main(){p=position;n=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader:`varying vec3 p;varying vec3 n;uniform vec3 uCyan;uniform vec3 uViolet;
        void main(){float radius=length(p.xz);float angle=atan(p.z,p.x);
          vec3 tint=mix(uCyan,uViolet,smoothstep(-1.8,1.8,p.x));
          float metal=pow(max(0.0,cos(angle+1.1)),18.0)*.035+pow(max(0.0,cos(angle-2.0)),14.0)*.025;
          float rings=exp(-pow((radius-2.22)*90.0,2.0))*.04+exp(-pow((radius-2.51)*90.0,2.0))*.07;
          float reflection=exp(-pow((p.x+.62)*4.0,2.0))*exp(-pow((p.z-.5)*.85,2.0));
          float purple=exp(-pow((p.x-.68)*4.5,2.0))*exp(-pow((p.z-.3)*.8,2.0));
          vec3 c=vec3(.004,.009,.017)+tint*(metal+rings);
          c+=uCyan*reflection*.065+uViolet*purple*.055;
          c+=vec3(.012,.022,.04)*max(0.0,1.0-abs(n.y));
          gl_FragColor=vec4(c,1.0);${outputColor}
        }`,
    }))
    // The podium is set behind the entire target depth envelope. Even at the
    // lowest position on a narrow viewport, decoration cannot hide the target.
    const base=this.mesh(new CylinderGeometry(2.68,2.78,.12,96),metal);base.position.set(0,-1.72,-5.5);this.stage.add(base)
    const top=this.mesh(new CylinderGeometry(2.58,2.68,.085,96),platform);top.position.set(0,-1.60,-5.5);this.stage.add(top)
    const rings=[2.22,2.50,2.58].map(r=>{const g=new RingGeometry(r-.006,r+.006,128);g.rotateX(-Math.PI/2);g.translate(0,-1.553,-5.5);return g})
    this.stage.add(this.mesh(this.join(rings),this.ringMaterial))
    for(const [color,offset] of [['#5be6fa',.15],['#bd8bff',Math.PI+.15]] as const){
      const material=this.ownMaterial(new MeshBasicMaterial({color,transparent:true,opacity:.93,side:DoubleSide,depthWrite:false,blending:AdditiveBlending,toneMapped:false}))
      const sections=[0,1.1,2.1].map(a=>{const g=new RingGeometry(2.60,2.63,24,1,offset+a,.18);g.rotateX(-Math.PI/2);g.translate(0,-1.546,-5.5);return g})
      this.stage.add(this.mesh(this.join(sections),material))
    }
    const floor=this.ownMaterial(new ShaderMaterial({
      transparent:true,depthWrite:false,side:DoubleSide,toneMapped:false,vertexShader:planeVertex,
      fragmentShader:`varying vec2 vUv;varying vec3 vPoint;
        void main(){vec2 p=vPoint.xy;vec2 g=abs(fract(p/.65-.5)-.5)/max(fwidth(p/.65),vec2(.001));
          float lines=1.0-min(min(g.x,g.y),1.0);float fade=exp(-length(p)*.15);
          float left=exp(-length((p-vec2(-4.2,1.0))*vec2(2.0,.24))*.9);
          float right=exp(-length((p-vec2(4.2,.4))*vec2(2.0,.24))*.9);
          float center=exp(-length((p-vec2(0,2.0))*vec2(.9,.23))*1.8);
          vec3 c=vec3(.005,.010,.018)+vec3(.02,.065,.10)*lines*fade;
          c+=vec3(.015,.37,.48)*left*.27+vec3(.22,.06,.4)*right*.28+vec3(.06,.2,.3)*center*.12;
          gl_FragColor=vec4(c,fade);${outputColor}
        }`,
    }))
    const ground=this.mesh(new PlaneGeometry(38,34),floor);ground.rotation.x=-Math.PI/2;ground.position.set(0,-1.85,-4);this.stage.add(ground)
    const pool=this.ownMaterial(new ShaderMaterial({
      transparent:true,depthWrite:false,side:DoubleSide,blending:AdditiveBlending,toneMapped:false,vertexShader:planeVertex,
      fragmentShader:`varying vec2 vUv;varying vec3 vPoint;
        void main(){vec2 p=vUv*2.0-1.0;float falloff=exp(-dot(p*vec2(1.2,.85),p*vec2(1.2,.85))*5.0);
          vec3 c=mix(vec3(.03,.8,1.0),vec3(.53,.18,1.0),smoothstep(-.5,.5,p.x));
          gl_FragColor=vec4(c,falloff*.24);${outputColor}
        }`,
    }))
    const lightPool=this.mesh(new PlaneGeometry(5.15,5.15),pool);lightPool.rotation.x=-Math.PI/2;lightPool.position.set(0,-1.54,-5.5);this.stage.add(lightPool)

    // Filled, bevelled architectural wings rather than floating wire brackets.
    const ribs:[Vector3,Vector3][]=[],walls:BufferGeometry[]=[]
    for(const side of [-1,1]){
      const pts=[new Vector3(side*7,-2.3,-6),new Vector3(side*4.8,-1.7,-6),
        new Vector3(side*4.2,-.95,-6),new Vector3(side*4.2,1.25,-6),new Vector3(side*5.1,2.2,-6),new Vector3(side*7,2.8,-6)]
      for(let i=1;i<pts.length;i++)ribs.push([pts[i-1],pts[i]])
      const shape=new Shape();shape.moveTo(pts[0].x,pts[0].y)
      for(const p of pts.slice(1))shape.lineTo(p.x,p.y)
      shape.lineTo(side*15,5);shape.lineTo(side*15,-5);shape.closePath()
      const g=new ExtrudeGeometry(shape,{depth:.4,bevelEnabled:true,bevelThickness:.12,bevelSize:.14,bevelSegments:2,steps:1})
      g.translate(0,0,-6.55);walls.push(g)
    }
    const wall=this.mesh(this.join(walls),metal);wall.name='architectural-shell';this.stage.add(wall)
    this.stage.add(this.rails(ribs,.15,metal))
    const lightRibs=ribs.map(([a,b]):[Vector3,Vector3]=>[a.clone().add(new Vector3(0,0,.16)),b.clone().add(new Vector3(0,0,.16))])
    this.stage.add(this.rails(lightRibs,.048,this.glowMaterial),this.rails(lightRibs,.012,this.edgeMaterial))
    const atmosphere=this.ownMaterial(new ShaderMaterial({
      transparent:true,depthWrite:false,blending:AdditiveBlending,toneMapped:false,vertexShader:planeVertex,
      fragmentShader:`varying vec2 vUv;varying vec3 vPoint;
        void main(){vec2 p=vUv*2.0-1.0;
          float a=exp(-dot((p-vec2(-.34,-.05))*vec2(2.5,.9),(p-vec2(-.34,-.05))*vec2(2.5,.9))*3.0);
          float b=exp(-dot((p-vec2(.40,.05))*vec2(2.7,.9),(p-vec2(.40,.05))*vec2(2.7,.9))*3.0);
          float shaft=exp(-pow((p.x+p.y*.5+.25)*10.0,2.0))*.035;
          vec3 c=vec3(.025,.40,.58)*a+vec3(.27,.08,.53)*b+vec3(.1,.4,.6)*shaft;
          gl_FragColor=vec4(c,(a+b)*.30+shaft);${outputColor}
        }`,
    }))
    const haze=this.mesh(new PlaneGeometry(18,8),atmosphere);haze.position.set(0,.25,-8);this.stage.add(haze)
    this.stage.traverse(object=>{object.raycast=noPicking});this.details.traverse(object=>{object.raycast=noPicking})
  }
  private ownMaterial<T extends Material>(material:T):T{this.materials.add(material);return material}
  private mesh(geometry:BufferGeometry,material:Material):Mesh{this.geometries.add(geometry);const m=new Mesh(geometry,material);m.raycast=noPicking;return m}
  private join(pieces:BufferGeometry[]):BufferGeometry{
    const joined=mergeGeometries(pieces);pieces.forEach(g=>g.dispose())
    if(!joined)throw new Error('Unable to assemble presentation geometry')
    return joined
  }
  private rails(segments:[Vector3,Vector3][],radius:number,material:Material):Mesh{
    const pieces=segments.map(([a,b])=>{
      const d=new Vector3().subVectors(b,a),g=new CylinderGeometry(radius,radius,d.length(),8,1)
      g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),d.normalize()))
      g.translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2)
      const p=g.getAttribute('position'),colors=new Float32Array(p.count*3),color=new Color()
      for(let i=0;i<p.count;i++){color.copy(CYAN).lerp(VIOLET,Math.max(0,Math.min(1,p.getX(i)/1.2+.5)));color.toArray(colors,i*3)}
      g.setAttribute('color',new BufferAttribute(colors,3));return g
    })
    return this.mesh(this.join(pieces),material)
  }
  setState(state:SpatialState):void{
    if(this.disposed)return
    const active=state==='GRABBING_3D',focus=state==='TARGET_FOCUSED'||state==='GRAB_PENDING'
    this.edgeMaterial.opacity=active?1:focus?.98:.92
    this.glowMaterial.opacity=active?.32:focus?.25:.18
    this.ringMaterial.opacity=active?.64:focus?.54:.42
    this.glassMaterial.uniforms.uEmphasis.value=active?1.35:focus?1.16:1
  }
  dispose():void{
    if(this.disposed)return
    this.disposed=true;this.cube.remove(this.details);this.stage.removeFromParent()
    this.geometries.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose())
    this.geometries.clear();this.materials.clear();this.details.clear();this.stage.clear()
  }
}
