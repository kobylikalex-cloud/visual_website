import type { Point3D } from '../gestures/TrackingQuality.ts'
import type { HandPose } from '../gestures/HandPoseEngine.ts'
import type { HandOrientation } from '../gestures/HandOrientationDiagnostics.ts'
import { classifyHandOrientation, getHandOrientationMetrics } from '../gestures/HandOrientationDiagnostics.ts'
import { getFingerFeatures } from '../gestures/FingerGeometry.ts'

/** Control-only interpretation; the original A/B classifiers remain unchanged.
 * Reuse the observed hybrid PIP/reach bands, requiring all four fingers to agree.
 * DIP is measured for validity, but is not a hard veto: recorded fists had DIP 127–128°.
 */
export function recognizeControlHand(worldLandmarks: Point3D[]): { pose: HandPose; orientation: HandOrientation } {
  const features = getFingerFeatures(worldLandmarks)
  if (!features) return { pose: 'UNKNOWN', orientation: 'TRANSITION' }
  const metrics = getHandOrientationMetrics(worldLandmarks)
  if (!metrics) return { pose: 'UNKNOWN', orientation: 'TRANSITION' }

  const extended = features.every(({ pipAngleDegrees: angle, reachPercent: reach }) =>
    (angle >= 145 && reach >= 65) || (angle >= 100 && reach >= 70))
  const curled = features.every(({ pipAngleDegrees: angle, reachPercent: reach }) =>
    angle <= 135 && reach <= 58)
  return {
    pose: extended ? 'OPEN' : curled ? 'FIST' : 'UNKNOWN',
    orientation: classifyHandOrientation(metrics),
  }
}
