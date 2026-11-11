import type { Point3D } from '../gestures/TrackingQuality.ts'
import type { DepthReading, PalmObservation } from './types.ts'

// Long palm-only baselines: no thumb, PIP, DIP, fingertip or box extent.
const BASELINES = [[0,5],[0,9],[0,13],[0,17],[5,17],[5,13],[9,17]] as const
const PALM = [0,5,9,13,17] as const
const MAX_GAP_MS = 250
const WINDOW_MS = 400
const STABLE_SPAN_MS = 240
const STABLE_LOG_RANGE = .04
const CALIBRATION_SEPARATION = 2 * STABLE_LOG_RANGE
const ENDPOINT_NOISE_PX = 1
const DIRECTION_NOISE_RAD = 2 * Math.PI / 180
const MIN_PROJECTED_PX = 24
const MIN_NORMAL_COSINE = .55
const MIN_BASELINE_PROJECTION = .5

export type DepthContext = {handId?:number;pose?:string}
export type DepthCalibration = {
  nearScale:number|null;neutralScale:number|null;farScale:number|null;complete:boolean
}
export type SceneDepthRange = {near:number;neutral:number;far:number}
type Sample = {scale:number;lengths:number[];errors:number[];normal:Point3D;timestampMs:number}
type Measurement = {sample:Sample|null;reason:string}

const difference = (a:Point3D,b:Point3D):Point3D => ({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z})
const norm = (p:Point3D) => Math.hypot(p.x,p.y,p.z)
const dot = (a:Point3D,b:Point3D) => a.x*b.x+a.y*b.y+a.z*b.z
const median = (values:number[]) => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]

/** Relative palm magnification, not camera distance. World positions contribute
 * unit directions only; image z and absolute world scale/translation are unused.
 * The caller owns pose recognition, hand identity, source freshness and release.
 */
export class RelativePalmDepth {
  private handId:number|undefined
  private pose = 'UNKNOWN'
  private lastTimestamp:number|null = null
  private accepted:Sample|null = null
  private latest:Sample|null = null
  private reference:Sample|null = null
  private relative = 1
  private window:Sample[] = []
  private calibration:Omit<DepthCalibration,'complete'> = {nearScale:null,neutralScale:null,farScale:null}

  /** Stateless measurement, useful for diagnostics. It neither anchors nor moves
   * the held relative value, and always returns relative=1, neutralScale=null. */
  measure(observation:PalmObservation):DepthReading {
    const result=this.measureSample(observation)
    return {valid:result.sample!==null,scale:result.sample?.scale??null,relative:1,neutralScale:null,
      quality:result.sample?'conditioned':'invalid',reason:result.reason}
  }

  observe(observation:PalmObservation,context:DepthContext={}):DepthReading {
    this.latest=null
    const timestamp=observation.timestampMs
    if(!Number.isFinite(timestamp) || (this.lastTimestamp!==null && timestamp<=this.lastTimestamp))
      return this.invalid('non-monotonic-timestamp')
    const gap=this.lastTimestamp===null?0:timestamp-this.lastTimestamp
    this.lastTimestamp=timestamp
    if(context.handId!==undefined && this.handId!==undefined && context.handId!==this.handId) {
      this.handId=context.handId
      this.reference=null; this.accepted=null; this.window=[]
      this.calibration={nearScale:null,neutralScale:null,farScale:null}
      return this.invalid('hand-identity-changed')
    }
    if(context.handId!==undefined) this.handId=context.handId
    const pose=context.pose??'UNKNOWN'
    if(pose!==this.pose) {
      this.window=[]
      // OPEN→FIST changes are never a scale reference or a velocity comparison.
      if(!this.reference) this.accepted=null
      this.pose=pose
    }
    if(this.reference && pose!=='FIST') return this.invalid('pose-change')
    if(gap>MAX_GAP_MS) return this.invalid('source-gap')
    const measurement=this.measureSample(observation)
    const sample=measurement.sample
    if(!sample) return this.invalid(measurement.reason)
    const shapeReference=this.reference??this.accepted
    if(shapeReference) {
      const ratios=sample.lengths.map((length,i)=>Math.log(length/shapeReference.lengths[i]))
      const common=median(ratios)
      if(ratios.some((ratio,i)=>Math.abs(ratio-common)>Math.max(.06,2*Math.hypot(sample.errors[i],shapeReference.errors[i]))))
        return this.invalid('inconsistent-palm-baselines')
    }
    if(this.accepted) {
      const elapsed=Math.min(MAX_GAP_MS,timestamp-this.accepted.timestampMs)/1000
      // A 4% noise allowance plus exp(1.6*t) magnification envelope: ~11%
      // per 40 ms; this is a UI continuity limit, not a physical speed estimate.
      if(Math.abs(Math.log(sample.scale/this.accepted.scale))>STABLE_LOG_RANGE+1.6*elapsed)
        return this.invalid('implausible-scale-jump')
    }
    this.accepted=sample; this.latest=sample
    if(this.reference) this.relative=sample.scale/this.reference.scale
    else this.relative=1
    if(pose==='FIST') {
      this.window.push(sample)
      this.window=this.window.filter(item=>timestamp-item.timestampMs<=WINDOW_MS)
    } else this.window=[]
    return {valid:true,scale:sample.scale,relative:this.relative,
      neutralScale:this.reference?.scale??this.calibration.neutralScale,quality:'conditioned',reason:'ok'}
  }

  /** Call only when the existing recognizer confirms acquisition. Latest sample
   * must itself be valid and FIST; never falls back to an earlier/open sample. */
  captureGrabReference():boolean {
    if(this.pose!=='FIST' || !this.latest) return false
    this.reference=this.latest
    this.relative=1
    return true
  }

  resetGrabReference():void {
    this.reference=null; this.latest=null; this.accepted=null; this.window=[]; this.relative=1
  }

  /** Capture the median of >=6 FIST samples covering >=240 ms, with <=4%
   * log-scale spread and <=5 degrees palm-normal motion. Failed captures do
   * not change the existing calibration. Endpoint order works in any sequence. */
  captureCalibration(position:'near'|'neutral'|'far'):boolean {
    if(this.pose!=='FIST' || !this.latest || this.window.length<6) return false
    const first=this.window[0],last=this.window[this.window.length-1]
    if(last.timestampMs-first.timestampMs<STABLE_SPAN_MS) return false
    const logs=this.window.map(sample=>Math.log(sample.scale))
    if(Math.max(...logs)-Math.min(...logs)>STABLE_LOG_RANGE) return false
    if(this.window.some(sample=>Math.abs(dot(sample.normal,first.normal))<Math.cos(5*Math.PI/180))) return false
    const next={...this.calibration,[`${position}Scale`]:Math.exp(median(logs))}
    const {nearScale,neutralScale,farScale}=next
    const separated=(a:number|null,b:number|null)=>a===null || b===null || Math.log(a/b)>CALIBRATION_SEPARATION
    if(!separated(nearScale,neutralScale) || !separated(neutralScale,farScale) || !separated(nearScale,farScale)) return false
    this.calibration=next
    return true
  }

  getCalibration():DepthCalibration {
    const c=this.calibration
    return {...c,complete:c.nearScale!==null && c.neutralScale!==null && c.farScale!==null}
  }

  /** Map magnification relative to the grab anchor. Calibrated endpoint ratios
   * set sensitivity; relative=1 always maps to range.neutral, even if the grab
   * was made elsewhere. This keeps acquisition continuous. Output is bounded.
   * Incomplete calibration uses linear unit-ratio sensitivity. */
  mapRelativeToScene(relative:number,range:SceneDepthRange):number {
    if(!Number.isFinite(relative) || relative<=0) return range.neutral
    const c=this.getCalibration()
    const near=relative>=1
    let fraction=near?relative-1:1-relative
    if(c.complete) {
      const endpoint=(near?c.nearScale!:c.farScale!)/c.neutralScale!
      fraction=Math.log(relative)/Math.log(endpoint)
    }
    fraction=Math.max(0,Math.min(1,fraction))
    return range.neutral+fraction*((near?range.near:range.far)-range.neutral)
  }

  reset():void {
    this.resetGrabReference()
    this.handId=undefined; this.pose='UNKNOWN'; this.lastTimestamp=null
    this.calibration={nearScale:null,neutralScale:null,farScale:null}
  }

  private invalid(reason:string):DepthReading {
    this.latest=null; this.window=[]
    return {valid:false,scale:null,relative:this.relative,
      neutralScale:this.reference?.scale??this.calibration.neutralScale,quality:'invalid',reason}
  }

  private measureSample(observation:PalmObservation):Measurement {
    const {imageLandmarks:image,worldLandmarks:world,imageSize:size,timestampMs}=observation
    const fail=(reason:string):Measurement=>({sample:null,reason})
    if(!Number.isFinite(timestampMs) || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width<=0 || size.height<=0)
      return fail('invalid-observation')
    if(image.length!==21 || world.length!==21) return fail('missing-landmarks')
    for(const i of PALM) {
      const p=image[i],w=world[i]
      if(!p || !w || ![p.x,p.y,w.x,w.y,w.z].every(Number.isFinite)) return fail('non-finite-palm')
      if(p.x<0 || p.x>1 || p.y<0 || p.y>1) return fail('palm-out-of-frame')
    }
    const sideU=difference(world[5],world[0]),sideV=difference(world[17],world[0])
    const lengthU=norm(sideU),lengthV=norm(sideV)
    if(!Number.isFinite(lengthU) || !Number.isFinite(lengthV) || lengthU===0 || lengthV===0) return fail('degenerate-palm')
    // Normalize before crossing: even extreme finite world units cannot create
    // a zero/Infinity area merely by squaring their coordinate scale.
    const u={x:sideU.x/lengthU,y:sideU.y/lengthU,z:sideU.z/lengthU}
    const v={x:sideV.x/lengthV,y:sideV.y/lengthV,z:sideV.z/lengthV}
    const cross={x:u.y*v.z-u.z*v.y,y:u.z*v.x-u.x*v.z,z:u.x*v.y-u.y*v.x}
    const area=norm(cross)
    if(!Number.isFinite(area) || area<.15) return fail('degenerate-palm')
    const normal={x:cross.x/area,y:cross.y/area,z:cross.z/area}
    if(Math.abs(normal.z)<MIN_NORMAL_COSINE) return fail('edge-on-palm')
    const lengths:number[]=[],errors:number[]=[]
    for(const [a,b] of BASELINES) {
      const vector=difference(world[b],world[a]),length=norm(vector),projected=Math.hypot(vector.x,vector.y)
      if(!Number.isFinite(length) || length<=0) return fail('degenerate-baseline')
      const projection=projected/length
      if(projection<MIN_BASELINE_PROJECTION) return fail('ill-conditioned-baseline')
      const dx=(image[b].x-image[a].x)*size.width,dy=(image[b].y-image[a].y)*size.height
      const pixels=Math.hypot(dx,dy)
      if(pixels<MIN_PROJECTED_PX) return fail('palm-too-small')
      // Camera-oriented world x/y should agree with projected image direction.
      // A 20 degree tolerance also accommodates weak-perspective approximation.
      const alignment=dx/pixels*(vector.x/projected)+dy/pixels*(vector.y/projected)
      if(alignment<Math.cos(20*Math.PI/180)) return fail('image-world-direction-mismatch')
      lengths.push(pixels/size.width/projection)
      errors.push(Math.SQRT2*ENDPOINT_NOISE_PX/pixels+Math.sqrt(1-projection*projection)/projection*DIRECTION_NOISE_RAD)
    }
    const scale=Math.sqrt(lengths.reduce((sum,length)=>sum+length*length,0)/lengths.length)
    if(!Number.isFinite(scale) || scale<=0) return fail('invalid-scale')
    return {sample:{scale,lengths,errors,normal,timestampMs},reason:'ok'}
  }
}
