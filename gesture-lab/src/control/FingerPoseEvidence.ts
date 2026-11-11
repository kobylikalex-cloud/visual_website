import { getFingerFeatures, type FingerFeatures } from '../gestures/FingerGeometry.ts'
import type { Point3D } from '../gestures/TrackingQuality.ts'

export type FingerPoseEvidence = FingerFeatures & {
  // Signed tip displacement along the palm's long axis, normalized by finger
  // chain length. Negative means folded behind that finger's knuckle plane.
  palmAdvancePercent: number
  state: 'EXTENDED' | 'CURLED' | 'UNCERTAIN'
}

/** Control-only evidence; historical A/B geometry and orientation stay intact. */
export function getFingerPoseEvidence(points: readonly Point3D[]): FingerPoseEvidence[] | null {
  const features = getFingerFeatures(points)
  if (!features) return null
  const axis = { x: points[9].x - points[0].x, y: points[9].y - points[0].y, z: points[9].z - points[0].z }
  const length = Math.hypot(axis.x, axis.y, axis.z)
  if (length === 0 || !Number.isFinite(length)) return null
  const unit = { x: axis.x / length, y: axis.y / length, z: axis.z / length }
  return features.map((feature, i) => {
    const mcp = 5 + i * 4, tip = points[mcp + 3], base = points[mcp]
    let chain = 0
    for (let bone = 0; bone < 3; bone++) {
      const a = points[mcp + bone], b = points[mcp + bone + 1]
      chain += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
    }
    const palmAdvancePercent = 100 * ((tip.x - base.x) * unit.x + (tip.y - base.y) * unit.y + (tip.z - base.z) * unit.z) / chain
    const angle = feature.pipAngleDegrees, reach = feature.reachPercent
    const extended = (angle >= 145 && reach >= 65) || (angle >= 100 && reach >= 70)
    // Preserve the observed compact fist band. Longer proximal bones can keep
    // MCP-to-tip reach above 58% despite flexion; require the tip to fold back
    // into the palm half-space and remain below the existing extended band.
    const curled = angle <= 135 && (reach <= 58 || (reach < 70 && palmAdvancePercent <= 0))
    return { ...feature, palmAdvancePercent, state: extended ? 'EXTENDED' : curled ? 'CURLED' : 'UNCERTAIN' }
  })
}
