import type { HandPose } from '../gestures/HandPoseEngine.ts'
import type { Point3D } from '../gestures/TrackingQuality.ts'

// Reference: a54a49e5f40a3a962b37149940cda40ec48a3877.
// Preserve historical rounded readings, absolute geometry guard and consensus.
// Evaluation only; do not route this reference to control actions.
export type HybridReading = { pipAngleDegrees: number; reachPercent: number }

export function classifyHybridReadings(readings: readonly HybridReading[]): HandPose {
  if (readings.length !== 4) return 'UNKNOWN'
  let extended = 0
  let curled = 0
  for (const { pipAngleDegrees: angle, reachPercent: reach } of readings) {
    if (!Number.isFinite(angle) || !Number.isFinite(reach)) return 'UNKNOWN'
    const isExtended = (angle >= 145 && reach >= 65) || (angle >= 100 && reach >= 70)
    const isCurled = angle <= 135 && reach <= 58
    if (isExtended) extended++
    else if (isCurled) curled++
  }
  if (curled >= 3 && extended <= 1) return 'FIST'
  if (extended >= 3 && curled <= 1) return 'OPEN'
  return 'UNKNOWN'
}

function distance(a: Point3D, b: Point3D): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function jointAngle(a: Point3D, b: Point3D, c: Point3D): number | null {
  const ux = a.x - b.x, uy = a.y - b.y, uz = a.z - b.z
  const vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z
  const magnitude = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz)
  if (magnitude <= 1e-8) return null
  const cosine = Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / magnitude))
  return Math.round(Math.acos(cosine) * 180 / Math.PI)
}

export function classifyHybridHandPose(landmarks: readonly Point3D[]): HandPose {
  if (landmarks.length !== 21 || !landmarks.every(point => point != null &&
    Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z))) return 'UNKNOWN'
  const readings: HybridReading[] = []
  for (const [mcp, pip, dip, tip] of [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]) {
    // Sparse arrays are rejected rather than throwing in the diagnostic reference.
    if (![mcp, pip, dip, tip].every(index => landmarks[index] != null)) return 'UNKNOWN'
    const angle = jointAngle(landmarks[mcp], landmarks[pip], landmarks[dip])
    const boneLength = distance(landmarks[mcp], landmarks[pip]) +
      distance(landmarks[pip], landmarks[dip]) + distance(landmarks[dip], landmarks[tip])
    if (angle === null || boneLength <= 1e-8) return 'UNKNOWN'
    readings.push({ pipAngleDegrees: angle, reachPercent: Math.round(Math.min(100,
      100 * distance(landmarks[mcp], landmarks[tip]) / boneLength)) })
  }
  return classifyHybridReadings(readings)
}
