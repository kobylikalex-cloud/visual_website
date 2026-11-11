import type {Point2,TrackedHand} from '../control/types.ts'
import type {Point3D} from '../gestures/TrackingQuality.ts'

export type Vec3 = {x:number;y:number;z:number}
export type CanvasRect = {left:number;top:number;width:number;height:number}
export type SpatialHit = {id:string;ownerToken:number;point:Vec3;position:Vec3}
export type SpatialBounds = {min:Vec3;max:Vec3}
export type SpatialScenePort = {
  pick(pointer:Point2):SpatialHit|null
  planePoint(pointer:Point2,z:number):Vec3|null
  getPosition():Vec3
  setPosition(position:Vec3):void
  getOwnerToken():number
  getRect():CanvasRect
  bounds:SpatialBounds
}
export type PalmObservation = {timestampMs:number;imageLandmarks:readonly Point3D[];worldLandmarks:readonly Point3D[];imageSize:{width:number;height:number}}
export type DepthReading = {valid:boolean;scale:number|null;relative:number;neutralScale:number|null;quality:string;reason:string}
export type SpatialInput = {
  timestampMs:number;receivedAt:number;hands:readonly TrackedHand[];ambiguous:boolean;viewport:{width:number;height:number}
  base:{pointer:Point2|null;focusId:string|null;confirmed:boolean;scrollActive:boolean;scrollEntering:boolean}
  depth:DepthReading
}
export type SpatialState = 'IDLE'|'TARGET_FOCUSED'|'GRAB_PENDING'|'GRABBING_3D'|'RELEASING'|'UNCERTAIN'
export type SpatialSnapshot = {
  state:SpatialState;selectedId:string|null;handId:number|null;ready:boolean;exclusive:boolean
  position:Vec3;rawPalm:Point2|null;filteredPalm:Point2|null;depth:DepthReading
  reason:string;confirmationProgress:number;grabCount:number
}
export type SpatialTick = {snapshot:SpatialSnapshot;retainedPointer:Point2|null}
