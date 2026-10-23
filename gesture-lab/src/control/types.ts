import type { Point3D } from '../gestures/TrackingQuality.ts'
import type { HandPose } from '../gestures/HandPoseEngine.ts'
import type { HandOrientation } from '../gestures/HandOrientationDiagnostics.ts'

export type Point2 = { x: number; y: number }
export type Detection = { landmarks: Point3D[]; worldLandmarks: Point3D[]; handedness?: string }
export type TrackingFrame = { timestampMs: number; detections: Detection[]; evaluationOnly?: boolean }
export type TrackedHand = {
  id: number
  center: Point2
  pose: HandPose
  orientation: HandOrientation
  timestampMs: number
}
export type TrackingResult = { hands: TrackedHand[]; ambiguous: boolean; reason: string }
export type Rect = { left: number; top: number; width: number; height: number }
export type InteractionTarget = { id: string; kind: 'click' | 'drag'; rect: Rect; disabled?: boolean; activationToken?: number }
export type InteractionMode = 'IDLE' | 'UNCERTAIN' | 'POINTER' | 'GRASP_PENDING' | 'GRABBING' | 'SCROLL' | 'SCROLL_FAST'
export type InteractionSnapshot = {
  mode: InteractionMode
  focusId: string | null
  proximity: Record<string, number>
  pointer: Point2 | null
  clickId: string | null
  drag: { id: string; deltaX: number; deltaY: number } | null
  scrollVelocity: number
  reason: string
}
export type InteractionFrame = TrackingResult & {
  timestampMs: number
  targets: InteractionTarget[]
  viewport: { width: number; height: number }
}
