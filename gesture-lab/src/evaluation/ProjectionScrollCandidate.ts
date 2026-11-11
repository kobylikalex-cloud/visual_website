import type { Point3D } from '../gestures/TrackingQuality.ts'
import type { HandPose } from '../gestures/HandPoseEngine.ts'
import type { ImageSize } from './ProjectionEvidence.ts'
import { getProjectedFingerEvidence } from './ProjectionEvidence.ts'
import { recognizeControlHand } from '../control/ControlRecognition.ts'
import { getFingerPoseEvidence } from '../control/FingerPoseEvidence.ts'

/** Rejected shadow proposal: the flat-fist probe produced 44/199 false OPEN
 * results. Keep for identical-input diagnosis only; no controller imports it. */
export function classifyProjectionScrollCandidate(world: Point3D[], image?: Point3D[], size?: ImageSize): HandPose {
  const baseline = recognizeControlHand(world).pose
  if (baseline !== 'UNKNOWN') return baseline
  const worldEvidence = getFingerPoseEvidence(world)
  const projected = image ? getProjectedFingerEvidence(image, size) : null
  return worldEvidence && worldEvidence.filter(f => f.state === 'EXTENDED').length >= 3 &&
    projected?.every(f => f.state === 'EXTENDED') ? 'OPEN' : 'UNKNOWN'
}
