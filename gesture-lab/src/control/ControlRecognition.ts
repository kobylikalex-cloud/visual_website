import type { Point3D } from '../gestures/TrackingQuality.ts'
import type { HandPose } from '../gestures/HandPoseEngine.ts'
import type { HandOrientation } from '../gestures/HandOrientationDiagnostics.ts'
import { classifyHandOrientation, getHandOrientationMetrics } from '../gestures/HandOrientationDiagnostics.ts'
import { getFingerPoseEvidence } from './FingerPoseEvidence.ts'

/** Control-only interpretation; the original A/B classifiers remain unchanged.
 * Keep OPEN's guarded 3/4 agreement; click-capable FIST requires all four fingers.
 * DIP is measured for validity, but is not a hard veto: recorded fists had DIP 127–128°.
 */
export function recognizeControlHand(worldLandmarks: Point3D[]): { pose: HandPose; orientation: HandOrientation } {
  const features = getFingerPoseEvidence(worldLandmarks)
  if (!features) return { pose: 'UNKNOWN', orientation: 'TRANSITION' }
  const metrics = getHandOrientationMetrics(worldLandmarks)
  if (!metrics) return { pose: 'UNKNOWN', orientation: 'TRANSITION' }

  // One noisy or occluded finger should not reject an otherwise clear hand.
  // A directly contradictory finger always vetoes the gesture.
  const extended = features.filter(finger => finger.state === 'EXTENDED').length
  const curled = features.filter(finger => finger.state === 'CURLED').length
  return {
    pose: extended >= 3 && curled === 0 ? 'OPEN'
      : curled === 4 && extended === 0 ? 'FIST'
      : 'UNKNOWN',
    orientation: classifyHandOrientation(metrics),
  }
}
