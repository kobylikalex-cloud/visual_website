import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, Color,
  CylinderGeometry, DoubleSide, Group, Material, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, Quaternion, RingGeometry,
  ShaderMaterial, Vector3,
} from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import type {SpatialState} from './types.ts'

const CYAN = new Color('#62e4f2')
const VIOLET = new Color('#bd93fa')
const noPicking = () => undefined

/** Presentation only. Does not own input, projection, camera or cube transforms.
 * No network assets, animation loop, bloom compositor or reflection cameras.
 */
export class SpatialAppearance {
  readonly stage = new Group()
  private readonly details = new Group()
  private readonly geometries = new Set<BufferGeometry>()
  private readonly materials = new Set<Material>()
  private readonly edgeMaterial:MeshBasicMaterial
  private readonly glowMaterial:MeshBasicMaterial
  private readonly ringMaterial:MeshBasicMaterial
  private readonly cube:Mesh
  private disposed=false

  constructor(cube:Mesh) {
    this.cube=cube
    this.stage.name='cinematic-decoration-only'
    this.details.name='noninteractive-cube-lighting'
    this.edgeMaterial=this.ownMaterial(new MeshBasicMaterial({
      vertexColors:true,transparent:true,opacity:.9,depthWrite:false,toneMapped:false,
    }))
    this.glowMaterial=this.ownMaterial(new MeshBasicMaterial({
      vertexColors:true,transparent:true,opacity:.16,depthWrite:false,
      blending:AdditiveBlending,toneMapped:false,
    }))
    this.ringMaterial=this.ownMaterial(new MeshBasicMaterial({
      color:0x6edbe5,transparent:true,opacity:.65,side:DoubleSide,
      blending:AdditiveBlending,depthWrite:false,toneMapped:false,
    }))

    const edges:[Vector3,Vector3][]=[]
    for(const axis of [0,1,2]) for(const a of [-.6,.6]) for(const b of [-.6,.6]) {
      const start=new Vector3(),end=new Vector3()
      start.setComponent(axis,-.6);end.setComponent(axis,.6)
      start.setComponent((axis+1)%3,a);end.setComponent((axis+1)%3,a)
      start.setComponent((axis+2)%3,b);end.setComponent((axis+2)%3,b)
      edges.push([start,end])
    }
    this.details.add(this.rails(edges,.0065,this.edgeMaterial))
    this.details.add(this.rails(edges,.022,this.glowMaterial))

    // View-dependent edge shading suggests glass without an expensive transmission pass.
    const glass=this.ownMaterial(new ShaderMaterial({
      transparent:true,depthWrite:false,side:DoubleSide,
      uniforms:{uCyan:{value:CYAN},uViolet:{value:VIOLET}},
      vertexShader:`varying vec3 vNormal;varying vec3 vEye;varying vec3 vLocal;
        void main(){vec4 view=modelViewMatrix*vec4(position,1.0);
          vNormal=normalize(normalMatrix*normal);vEye=-view.xyz;vLocal=position;
          gl_Position=projectionMatrix*view;}`,
      fragmentShader:`varying vec3 vNormal;varying vec3 vEye;varying vec3 vLocal;
        uniform vec3 uCyan;uniform vec3 uViolet;
        void main(){float rim=pow(1.0-abs(dot(normalize(vNormal),normalize(vEye))),2.4);
          vec3 tint=mix(uCyan,uViolet,smoothstep(-.6,.6,vLocal.x));
          float diagonal=pow(max(0.0,1.0-abs(vLocal.x+vLocal.y*.65-.18)*11.0),4.0);
          gl_FragColor=vec4(tint*(.30+rim*.55+diagonal*.12),.035+rim*.18+diagonal*.025);}`,
    }))
    this.details.add(this.mesh(new BoxGeometry(1.198,1.198,1.198),glass))
    cube.add(this.details)

    // This stage sits below and behind the accepted movement volume.
    const metal=this.ownMaterial(new MeshStandardMaterial({color:0x15232d,metalness:.7,roughness:.34}))
    const dais=this.mesh(new CylinderGeometry(2.45,2.58,.16,80),metal)
    dais.position.set(0,-2.55,-1.6)
    this.stage.add(dais)
    for(const radius of [1.88,2.25,2.46]) {
      const ring=this.mesh(new RingGeometry(radius-.009,radius+.009,96),this.ringMaterial)
      ring.rotation.x=-Math.PI/2;ring.position.set(0,-2.463,-1.6)
      this.stage.add(ring)
    }
    for(const [color,offset] of [['#63e9fa',0],['#b98af6',Math.PI]] as const) {
      const material=this.ownMaterial(new MeshBasicMaterial({
        color,transparent:true,opacity:.85,side:DoubleSide,
        blending:AdditiveBlending,depthWrite:false,toneMapped:false,
      }))
      const pieces=[0,.75,1.5].map(a=>new RingGeometry(2.38,2.42,20,1,offset+a,.35))
      const joined=mergeGeometries(pieces)
      pieces.forEach(g=>g.dispose())
      if(joined){const rim=this.mesh(joined,material);rim.rotation.x=-Math.PI/2;
        rim.position.set(0,-2.46,-1.6);this.stage.add(rim)}
    }

    const floorMaterial=this.ownMaterial(new ShaderMaterial({
      transparent:true,depthWrite:false,side:DoubleSide,
      uniforms:{uCyan:{value:CYAN},uViolet:{value:VIOLET}},
      vertexShader:`varying vec2 vPlane;void main(){vPlane=position.xy;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader:`uniform vec3 uCyan;uniform vec3 uViolet;varying vec2 vPlane;
        void main(){vec2 grid=abs(fract(vPlane/.72-.5)-.5)/max(fwidth(vPlane/.72),vec2(.001));
          float line=1.0-min(min(grid.x,grid.y),1.0);float fade=exp(-length(vPlane)*.20);
          float left=exp(-length((vPlane-vec2(-1.1,.1))*vec2(.8,.5))*1.7);
          float right=exp(-length((vPlane-vec2(1.25,-.1))*vec2(.8,.5))*1.7);
          vec3 c=vec3(.018,.03,.05)+line*vec3(.055,.12,.16)*fade;
          c+=uCyan*left*.07+uViolet*right*.06;gl_FragColor=vec4(c,fade*.85);}`,
    }))
    const floor=this.mesh(new PlaneGeometry(32,28),floorMaterial)
    floor.rotation.x=-Math.PI/2;floor.position.y=-2.72;this.stage.add(floor)
    const poolMaterial=this.ownMaterial(new ShaderMaterial({
      transparent:true,depthWrite:false,side:DoubleSide,blending:AdditiveBlending,
      vertexShader:`varying vec2 vUv;void main(){vUv=uv;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader:`varying vec2 vUv;void main(){vec2 p=vUv*2.0-1.0;
        float a=exp(-dot(p*vec2(1.2,.9),p*vec2(1.2,.9))*5.0)*.26;
        vec3 c=mix(vec3(.15,.85,1.0),vec3(.64,.27,1.0),smoothstep(-.6,.6,p.x));
        gl_FragColor=vec4(c,a);}`,
    }))
    const pool=this.mesh(new PlaneGeometry(4.8,4.8),poolMaterial)
    pool.rotation.x=-Math.PI/2;pool.position.set(0,-2.456,-1.6);this.stage.add(pool)

    const ribs:[Vector3,Vector3][]=[]
    for(const side of [-1,1]) {
      const pts=[new Vector3(side*7.8,-2.6,-3),new Vector3(side*6.5,-1.5,-3),
        new Vector3(side*6,-.7,-3),new Vector3(side*6,1.35,-3),new Vector3(side*6.7,2.4,-3)]
      for(let i=1;i<pts.length;i++)ribs.push([pts[i-1],pts[i]])
    }
    this.stage.add(this.rails(ribs,.09,metal))
    const accents:[Vector3,Vector3][]=ribs.map(([a,b])=>[
      a.clone().add(new Vector3(0,0,.10)),b.clone().add(new Vector3(0,0,.10)),
    ])
    this.stage.add(this.rails(accents,.026,this.glowMaterial))
    this.stage.add(this.rails(accents,.009,this.edgeMaterial))
    const atmosphere=this.ownMaterial(new ShaderMaterial({
      transparent:true,depthWrite:false,blending:AdditiveBlending,
      vertexShader:`varying vec2 uvp;void main(){uvp=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader:`varying vec2 uvp;void main(){vec2 p=uvp*2.0-1.0;
        float l=exp(-dot((p-vec2(-.3,.05))*vec2(2.0,1.1),(p-vec2(-.3,.05))*vec2(2.0,1.1))*3.0);
        float r=exp(-dot((p-vec2(.4,-.15))*vec2(2.2,1.2),(p-vec2(.4,-.15))*vec2(2.2,1.2))*3.0);
        gl_FragColor=vec4(vec3(.06,.46,.6)*l+vec3(.30,.12,.5)*r,(l+r)*.13);}`,
    }))
    const haze=this.mesh(new PlaneGeometry(16,7),atmosphere)
    haze.position.set(0,0,-4);this.stage.add(haze)
    this.stage.traverse(object=>{object.raycast=noPicking})
    this.details.traverse(object=>{object.raycast=noPicking})
  }

  private ownMaterial<T extends Material>(material:T):T {this.materials.add(material);return material}
  private mesh(geometry:BufferGeometry,material:Material):Mesh {
    this.geometries.add(geometry)
    const mesh=new Mesh(geometry,material);mesh.raycast=noPicking;return mesh
  }
  private rails(segments:[Vector3,Vector3][],radius:number,material:Material):Mesh {
    const pieces=segments.map(([a,b])=>{
      const direction=new Vector3().subVectors(b,a)
      const geometry=new CylinderGeometry(radius,radius,direction.length(),6,1)
      const rotation=new Quaternion().setFromUnitVectors(new Vector3(0,1,0),direction.normalize())
      geometry.applyQuaternion(rotation);geometry.translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2)
      const pos=geometry.getAttribute('position'),colors=new Float32Array(pos.count*3),color=new Color()
      for(let i=0;i<pos.count;i++) {
        color.copy(CYAN).lerp(VIOLET,Math.max(0,Math.min(1,pos.getX(i)/1.2+.5)))
        colors[i*3]=color.r;colors[i*3+1]=color.g;colors[i*3+2]=color.b
      }
      geometry.setAttribute('color',new BufferAttribute(colors,3));return geometry
    })
    const joined=mergeGeometries(pieces)
    pieces.forEach(geometry=>geometry.dispose())
    if(!joined)throw new Error('Unable to assemble presentation geometry')
    return this.mesh(joined,material)
  }
  setState(state:SpatialState):void {
    if(this.disposed)return
    const active=state==='GRABBING_3D',focus=state==='TARGET_FOCUSED'||state==='GRAB_PENDING'
    this.edgeMaterial.opacity=active?1:focus?.98:.88
    this.glowMaterial.opacity=active?.32:focus?.25:.18
    this.ringMaterial.opacity=active?.95:focus?.8:.65
  }
  dispose():void {
    if(this.disposed)return
    this.disposed=true;this.cube.remove(this.details);this.stage.removeFromParent()
    this.geometries.forEach(geometry=>geometry.dispose());this.materials.forEach(material=>material.dispose())
    this.geometries.clear();this.materials.clear();this.details.clear();this.stage.clear()
  }
}
