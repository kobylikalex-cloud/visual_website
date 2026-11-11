import {TOUCHPAD_GESTURE_CONFIG,type GestureConfig} from '../control/GestureConfig.ts'
import type {InteractionFrame,Point2,TrackingFrame} from '../control/types.ts'
import type {PageGestureSnapshot} from '../control/PageGestureEngine.ts'
import type {PerformanceReport} from '../tracking/TrackingPerformance.ts'
import {RelativePalmDepth} from './RelativePalmDepth.ts'
import {SpatialInteractionEngine} from './SpatialInteractionEngine.ts'
import type {DepthReading,SpatialInput,SpatialScenePort,SpatialSnapshot} from './types.ts'

export type SpatialHandoff={point:Point2;viewport:{width:number;height:number}}
type FeedbackPort=SpatialScenePort&{setFeedback?(snapshot:SpatialSnapshot):void;setDebug?(enabled:boolean):void;reset?():void;getMetrics?():{fps:number;renderMs:number;frames:number}}
const noDepth=(reason:string):DepthReading=>({valid:false,scale:null,relative:1,neutralScale:null,quality:'unavailable',reason})

/** Optional route adapter. No cube enters the accepted HTML target selector.
 * The normal App calls it only when /spatial-lab supplies an instance. */
export class SpatialControlBridge {
  private scene:FeedbackPort|null=null
  private engine:SpatialInteractionEngine|null=null
  private depth=new RelativePalmDepth()
  private config:GestureConfig={...TOUCHPAD_GESTURE_CONFIG}
  private viewport={width:1,height:1}
  private lastBase:Point2|null=null
  private reading:DepthReading=noDepth('Show one hand')
  private referenced=false
  private native=false
  private debug=false
  private perf:PerformanceReport|null=null
  private backend='Not initialized'
  private queuedHandoff:SpatialHandoff|null=null
  private gesture='UNKNOWN'
  private projectedPalmScale:number|null=null
  private depthSourceAt=-Infinity

  connectScene(scene:FeedbackPort|null){
    this.engine?.cancel('Spatial scene changed')
    this.scene=scene;this.engine=scene?new SpatialInteractionEngine(scene,this.config):null
    this.depth.resetGrabReference();this.referenced=false
    scene?.setDebug?.(this.debug)
  }
  setNativeActive(active:boolean){this.native=active;if(active)this.queuedHandoff=this.cancel('Native scene input')}
  setDebug(enabled:boolean){this.debug=enabled;this.scene?.setDebug?.(enabled)}
  setPerformance(perf:PerformanceReport,backend:string){this.perf=perf;this.backend=backend}
  configure(config:GestureConfig){this.config={...config};this.engine?.configure(config)}

  beforeFrame(raw:TrackingFrame,frame:InteractionFrame,now:number):{consumed:boolean;processed:boolean;handoff:SpatialHandoff|null}{
    if(this.native)return {consumed:true,processed:false,handoff:null}
    if(!this.engine?.wouldConsume(frame.hands[0]?.pose??'UNKNOWN'))return {consumed:false,processed:false,handoff:null}
    const result=this.update(raw,frame,now,{pointer:this.lastBase,focusId:null,confirmed:false,scrollActive:false,scrollEntering:false})
    const released=!result.exclusive
    const handoff=released?this.takeHandoff(now):null
    return {consumed:result.exclusive||frame.hands.length!==1||frame.hands[0].pose!=='OPEN',processed:true,handoff}
  }
  afterFrame(raw:TrackingFrame,frame:InteractionFrame,base:PageGestureSnapshot,confirmed:boolean,now:number){
    this.lastBase=base.pointer?{...base.pointer}:null
    if(!this.engine||this.native)return
    this.update(raw,frame,now,{pointer:base.pointer,focusId:base.focusId,confirmed,
      scrollActive:base.interactionState==='SCROLL_ACTIVE',scrollEntering:base.interactionState==='SCROLL_ENTRY'})
  }
  tick(now:number):SpatialHandoff|null{
    if(now-this.depthSourceAt>this.config.freshnessMs&&this.reading.valid){
      this.depth.resetGrabReference();this.referenced=false;this.reading=noDepth('Palm observation expired')
    }
    if(this.queuedHandoff){const retained=this.queuedHandoff;this.queuedHandoff=null;return retained}
    if(!this.engine)return null
    const output=this.engine.tick(now)
    this.scene?.setFeedback?.(output.snapshot)
    if(!output.snapshot.exclusive&&this.referenced){this.depth.resetGrabReference();this.referenced=false}
    return output.retainedPointer?{point:output.retainedPointer,viewport:{...this.viewport}}:null
  }
  cancel(reason='Spatial input stopped',now=performance.now()):SpatialHandoff|null{
    const queued=this.queuedHandoff;this.queuedHandoff=null
    this.engine?.cancel(reason)
    this.depth.resetGrabReference();this.referenced=false
    return this.takeHandoff(now)??queued
  }
  reset(){this.queuedHandoff=this.cancel('Cube reset');this.scene?.reset?.();if(this.scene)this.engine=new SpatialInteractionEngine(this.scene,this.config)}
  captureCalibration(position:'near'|'neutral'|'far',now=performance.now()){
    if(!this.reading.valid||!Number.isFinite(now)||now<this.depthSourceAt||now-this.depthSourceAt>this.config.freshnessMs)return false
    const captured=this.depth.captureCalibration(position)
    if(captured)this.queuedHandoff=this.cancel('Depth calibration changed')
    return captured
  }
  getDebug(){const snapshot=this.engine?.snapshot??null;return {enabled:this.debug,gesture:this.gesture,projectedPalmScale:this.projectedPalmScale,
    snapshot:snapshot&&this.scene?{...snapshot,position:this.scene.getPosition()}:snapshot,depth:{...this.reading},calibration:this.depth.getCalibration(),
    performance:this.perf,backend:this.backend,render:this.scene?.getMetrics?.()??null,native:this.native}}

  private takeHandoff(now:number):SpatialHandoff|null{
    if(!this.engine)return null
    const output=this.engine.tick(now)
    this.scene?.setFeedback?.(output.snapshot)
    return output.retainedPointer?{point:output.retainedPointer,viewport:{...this.viewport}}:null
  }
  private update(raw:TrackingFrame,frame:InteractionFrame,now:number,base:SpatialInput['base']):SpatialSnapshot{
    this.viewport={...frame.viewport}
    const hand=frame.hands.length===1&&!frame.ambiguous?frame.hands[0]:null
    const detection=raw.detections.length===1?raw.detections[0]:null
    this.gesture=hand?.pose??'UNKNOWN'
    const a=detection?.landmarks[5],b=detection?.landmarks[17]
    const projected=a&&b&&raw.imageSize?Math.hypot((a.x-b.x)*raw.imageSize.width,(a.y-b.y)*raw.imageSize.height):NaN
    this.projectedPalmScale=Number.isFinite(projected)?projected:null
    if(hand&&detection&&raw.imageSize){
      this.reading=this.depth.observe({timestampMs:frame.timestampMs,imageLandmarks:detection.landmarks,
        worldLandmarks:detection.worldLandmarks,imageSize:raw.imageSize},{handId:hand.id,pose:hand.pose})
      this.depthSourceAt=frame.timestampMs
    }else{
      this.depth.resetGrabReference();this.referenced=false
      this.reading=noDepth('Fresh paired palm observations unavailable')
    }
    const inputDepth={...this.reading,relative:this.depth.getCalibration().complete
      ?this.depth.mapRelativeToScene(this.reading.relative,{near:1.5,neutral:1,far:.5}):this.reading.relative}
    const result=this.engine!.update({timestampMs:frame.timestampMs,receivedAt:now,hands:frame.hands,ambiguous:frame.ambiguous,viewport:frame.viewport,base,depth:inputDepth})
    if(result.state==='GRABBING_3D'&&!this.referenced)this.referenced=this.depth.captureGrabReference()
    if(!result.exclusive&&this.referenced){this.depth.resetGrabReference();this.referenced=false}
    this.scene?.setFeedback?.(result)
    return result
  }
}
