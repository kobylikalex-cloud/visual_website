import { getFingerFeatures } from './FingerGeometry.ts'
import type { Point3D } from './TrackingQuality.ts'

export type HandPose = 'OPEN' | 'FIST' | 'UNKNOWN'
export type FingerPose = 'EXTENDED' | 'CURLED' | 'UNKNOWN'

// Retained from the existing PIP classifier; no threshold tuning from synthetic data.
const EXTENDED_MIN_DEGREES = 145
const CURLED_MAX_DEGREES = 125

export function classifyFingerPose(pipDegrees: number, dipDegrees: number): FingerPose {
  if (![pipDegrees, dipDegrees].every(angle => Number.isFinite(angle) && angle >= 0 && angle <= 180)) {
    return 'UNKNOWN'
  }
  if (pipDegrees >= EXTENDED_MIN_DEGREES && dipDegrees >= EXTENDED_MIN_DEGREES) return 'EXTENDED'
  if (pipDegrees <= CURLED_MAX_DEGREES && dipDegrees <= CURLED_MAX_DEGREES) return 'CURLED'
  return 'UNKNOWN'
}

export function classifyHandPose(landmarks: readonly Point3D[]): HandPose {
  const features = getFingerFeatures(landmarks)
  if (!features) return 'UNKNOWN'

  const poses = features.map(({ pipAngleDegrees, dipAngleDegrees }) =>
    classifyFingerPose(pipAngleDegrees, dipAngleDegrees)
  )
  // A partial or contradictory pose must not authorize a whole-hand gesture.
  if (poses.every(pose => pose === 'EXTENDED')) return 'OPEN'
  if (poses.every(pose => pose === 'CURLED')) return 'FIST'
  return 'UNKNOWN'
}

// Preserve the existing import surface for camera integration.
export { HandPoseStabilizer } from './HandPoseStabilizer.ts'
