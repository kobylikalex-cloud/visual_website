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
    this.ringMaterial=this.ownMaterial(new MeshBasicMaterial({color:0x5de8f4,transparent:true,opacity:.8,side:DoubleSide,blending:AdditiveBlending,depthWrite:false,toneMapped:false}))
    const edges:[Vector3,Vector3][]=[]
    for(const axis of [0,1,2])for(const a of [-.595,.595])for(const b of [-.595,.595]){
      const start=new Vector3(),end=new Vector3()
      start.setComponent(axis,-.57);end.setComponent(axis,.57)
      for(const point of [start,end]){point.setComponent((axis+1)%3,a);point.setComponent((axis+2)%3,b)}
      edges.push([start,end])
    }
    this.details.add(this.rails(edges,.008,this.edgeMaterial),this.rails(edges,.025,this.glowMaterial))
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
          float fres=pow(1.0-max(dot(n,v),0.0),2.4);vec3 r=reflect(-v,n);
          vec3 tint=mix(uCyan,uViolet,smoothstep(-.48,.56,vLocal.x));
          float key=pow(max(dot(r,normalize(vec3(-.7,1.2,1.4))),0.0),22.0);
          float violet=pow(max(dot(r,normalize(vec3(1.0,-.55,1.3))),0.0),18.0);
          float strip=exp(-pow((r.x+r.y*.32+.24)*16.0,2.0))*.16;
          float edge=max(max(smoothstep(.53,.596,abs(vLocal.x))*smoothstep(.53,.596,abs(vLocal.y)),
            smoothstep(.53,.596,abs(vLocal.x))*smoothstep(.53,.596,abs(vLocal.z))),
            smoothstep(.53,.596,abs(vLocal.y))*smoothstep(.53,.596,abs(vLocal.z)));
          vec3 c=tint*(.13+fres*.68+edge*.55)+vec3(.75,.94,1.0)*(key*.85+strip)+uViolet*violet*.6;
          float a=.23+fres*.36+edge*.24+key*.2;
          gl_FragColor=vec4(c*uEmphasis,min(a,.88));
          ${outputColor}
        }`,
    }))
    const shell=this.mesh(new RoundedBoxGeometry(1.198,1.198,1.198,3,.035),this.glassMaterial)
    shell.name='optical-glass-shell';shell.renderOrder=3;this.details.add(shell)
    const inner=this.ownMaterial(new ShaderMaterial({
      transparent:true,depthWrite:false,side:DoubleSide,blending:AdditiveBlending,toneMapped:false,vertexShader:planeVertex,
      fragmentShader:`varying vec2 vUv;varying vec3 vPoint;
        void main(){vec2 p=vUv*2.0-1.0;
          float c=exp(-dot((p-vec2(-.65,-.6))*vec2(1.4,.8),(p-vec2(-.65,-.6))*vec2(1.4,.8))*2.5);
          float v=exp(-dot((p-vec2(.7,.3))*vec2(1.2,.9),(p-vec2(.7,.3))*vec2(1.2,.9))*3.0);
          float a=pow(max(0.0,1.0-abs(p.x)),.5)*pow(max(0.0,1.0-abs(p.y)),.5);
          gl_FragColor=vec4(vec3(.05,.7,1.0)*c+vec3(.58,.15,1.0)*v,a*.29);
          ${outputColor}
        }`,
    }))
    const core=this.mesh(new PlaneGeometry(1.16,1.16),inner);core.position.z=-.3;this.details.add(core)
    const corners:BufferGeometry[]=[]
    for(const x of [-.58,.58])for(const y of [-.58,.58])for(const z of [-.58,.58]){
      const g=new SphereGeometry(.018,8,6);g.translate(x,y,z);corners.push(g)
    }
    this.details.add(this.mesh(this.join(corners),this.ownMaterial(new MeshBasicMaterial({color:0xd4faff,toneMapped:false}))))
    cube.add(this.details)

    // Dark brushed metal, not a bright grey cylinder competing with the object.
    const metal=this.ownMaterial(new MeshStandardMaterial({color:0x08111c,metalness:.72,roughness:.33,envMapIntensity:.3}))
    const platform=this.ownMaterial(new ShaderMaterial({
      toneMapped:false,uniforms:{uCyan:{value:CYAN},uViolet:{value:VIOLET}},
      vertexShader:`varying vec3 p;varying vec3 n;void main(){p=position;n=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader:`varying vec3 p;varying vec3 n;uniform vec3 uCyan;uniform vec3 uViolet;
        void main(){float radius=length(p.xz);float angle=atan(p.z,p.x);
          vec3 tint=mix(uCyan,uViolet,smoothstep(-2.0,2.0,p.x));
          float metal=pow(max(0.0,cos(angle+1.1)),12.0)*.06+pow(max(0.0,cos(angle-2.0)),10.0)*.04;
          float rings=exp(-pow((radius-2.72)*90.0,2.0))*.12+exp(-pow((radius-2.98)*90.0,2.0))*.12;
          vec3 c=vec3(.009,.017,.027)+tint*(metal+rings);
          c+=vec3(.03,.045,.065)*max(0.0,1.0-abs(n.y));
          gl_FragColor=vec4(c,1.0);${outputColor}
        }`,
    }))
    const base=this.mesh(new CylinderGeometry(3.25,3.38,.14,96),metal);base.position.set(0,-1.69,-1.5);this.stage.add(base)
    const top=this.mesh(new CylinderGeometry(3.17,3.25,.10,96),platform);top.position.set(0,-1.57,-1.5);this.stage.add(top)
    const rings=[2.55,2.93,3.16].map(r=>{const g=new RingGeometry(r-.009,r+.009,128);g.rotateX(-Math.PI/2);g.translate(0,-1.513,-1.5);return g})
    this.stage.add(this.mesh(this.join(rings),this.ringMaterial))
    for(const [color,offset] of [['#5be6fa',.15],['#bd8bff',Math.PI+.15]] as const){
      const material=this.ownMaterial(new MeshBasicMaterial({color,transparent:true,opacity:.93,side:DoubleSide,depthWrite:false,blending:AdditiveBlending,toneMapped:false}))
      const sections=[0,1.1,2.1].map(a=>{const g=new RingGeometry(3.17,3.21,24,1,offset+a,.24);g.rotateX(-Math.PI/2);g.translate(0,-1.505,-1.5);return g})
      this.stage.add(this.mesh(this.join(sections),material))
    }
    const floor=this.ownMaterial(new ShaderMaterial({
      transparent:true,depthWrite:false,side:DoubleSide,toneMapped:false,vertexShader:planeVertex,
      fragmentShader:`varying vec2 vUv;varying vec3 vPoint;
        void main(){vec2 p=vPoint.xy;vec2 g=abs(fract(p/.65-.5)-.5)/max(fwidth(p/.65),vec2(.001));
          float lines=1.0-min(min(g.x,g.y),1.0);float fade=exp(-length(p)*.15);
          float left=exp(-length((p-vec2(-4.5,1.0))*vec2(.8,.25))*.9);
          float right=exp(-length((p-vec2(4.5,.4))*vec2(.8,.25))*.9);
          float center=exp(-length((p-vec2(0,2.0))*vec2(.7,.23))*1.8);
          vec3 c=vec3(.009,.017,.029)+vec3(.025,.09,.12)*lines*fade;
          c+=vec3(.015,.37,.48)*left*.19+vec3(.22,.06,.4)*right*.2+vec3(.06,.2,.3)*center*.2;
          gl_FragColor=vec4(c,fade);${outputColor}
        }`,
    }))
    const ground=this.mesh(new PlaneGeometry(38,34),floor);ground.rotation.x=-Math.PI/2;ground.position.set(0,-1.80,-1);this.stage.add(ground)
    const pool=this.ownMaterial(new ShaderMaterial({
      transparent:true,depthWrite:false,side:DoubleSide,blending:AdditiveBlending,toneMapped:false,vertexShader:planeVertex,
      fragmentShader:`varying vec2 vUv;varying vec3 vPoint;
        void main(){vec2 p=vUv*2.0-1.0;float falloff=exp(-dot(p*vec2(1.2,.85),p*vec2(1.2,.85))*5.0);
          vec3 c=mix(vec3(.03,.8,1.0),vec3(.53,.18,1.0),smoothstep(-.5,.5,p.x));
          gl_FragColor=vec4(c,falloff*.34);${outputColor}
        }`,
    }))
    const lightPool=this.mesh(new PlaneGeometry(6.3,6.3),pool);lightPool.rotation.x=-Math.PI/2;lightPool.position.set(0,-1.50,-1.5);this.stage.add(lightPool)

    // Filled, bevelled architectural wings rather than floating wire brackets.
    const ribs:[Vector3,Vector3][]=[],walls:BufferGeometry[]=[]
    for(const side of [-1,1]){
      const pts=[new Vector3(side*9,-3.2,-3.2),new Vector3(side*6.6,-2.0,-3.2),
        new Vector3(side*5.9,-1.15,-3.2),new Vector3(side*5.9,1.6,-3.2),new Vector3(side*7,2.9,-3.2),new Vector3(side*9,3.9,-3.2)]
      for(let i=1;i<pts.length;i++)ribs.push([pts[i-1],pts[i]])
      const shape=new Shape();shape.moveTo(pts[0].x,pts[0].y)
      for(const p of pts.slice(1))shape.lineTo(p.x,p.y)
      shape.lineTo(side*15,5);shape.lineTo(side*15,-5);shape.closePath()
      const g=new ExtrudeGeometry(shape,{depth:.24,bevelEnabled:true,bevelThickness:.09,bevelSize:.09,bevelSegments:2,steps:1})
      g.translate(0,0,-3.55);walls.push(g)
    }
    const wall=this.mesh(this.join(walls),metal);wall.name='architectural-shell';this.stage.add(wall)
    this.stage.add(this.rails(ribs,.15,metal))
    const lightRibs=ribs.map(([a,b]):[Vector3,Vector3]=>[a.clone().add(new Vector3(0,0,.16)),b.clone().add(new Vector3(0,0,.16))])
    this.stage.add(this.rails(lightRibs,.055,this.glowMaterial),this.rails(lightRibs,.017,this.edgeMaterial))
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
    const haze=this.mesh(new PlaneGeometry(20,10),atmosphere);haze.position.set(0,0,-4.5);this.stage.add(haze)
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
    this.ringMaterial.opacity=active?.95:focus?.9:.8
    this.glassMaterial.uniforms.uEmphasis.value=active?1.35:focus?1.16:1
  }
  dispose():void{
    if(this.disposed)return
    this.disposed=true;this.cube.remove(this.details);this.stage.removeFromParent()
    this.geometries.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose())
    this.geometries.clear();this.materials.clear();this.details.clear();this.stage.clear()
  }
}
