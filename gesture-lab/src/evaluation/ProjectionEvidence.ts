import { hasValidHandLandmarks, type Point3D } from '../gestures/TrackingQuality.ts'
import { getFingerPoseEvidence, type FingerPoseEvidence } from '../control/FingerPoseEvidence.ts'

export type ImageSize = { width: number; height: number }

/** Image-plane diagnostics only. Never authorizes a gesture. */
export function getProjectedFingerEvidence(points: readonly Point3D[], size?: ImageSize | null): FingerPoseEvidence[] | null {
  if (!size || !Number.isFinite(size.width + size.height) || size.width <= 0 || size.height <= 0 || !hasValidHandLandmarks(points)) return null
  // x/y are independently normalized by image width/height. Restore the image
  // aspect before measuring, and deliberately discard inferred depth.
  return getFingerPoseEvidence(points.map(p => ({ x: p.x * size.width / size.height, y: p.y, z: 0 })))
}
