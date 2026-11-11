import { hasValidHandLandmarks, type Point3D } from './TrackingQuality.ts'

const FINGERS = [
  ['Index', 5, 6, 7, 8],
  ['Middle', 9, 10, 11, 12],
  ['Ring', 13, 14, 15, 16],
  ['Pinky', 17, 18, 19, 20],
] as const

export type FingerFeatures = {
  finger: typeof FINGERS[number][0]
  pipAngleDegrees: number
  dipAngleDegrees: number
  reachPercent: number
}

function distance(a: Point3D, b: Point3D): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function jointAngle(a: Point3D, b: Point3D, c: Point3D): number | null {
  const u = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
  const v = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z }
  const uLength = Math.hypot(u.x, u.y, u.z)
  const vLength = Math.hypot(v.x, v.y, v.z)
  // Normalize separately to avoid a scale-dependent squared-length cutoff.
  if (uLength === 0 || vLength === 0 || !Number.isFinite(uLength + vLength)) return null
  const cosine = (u.x / uLength) * (v.x / vLength) +
    (u.y / uLength) * (v.y / vLength) + (u.z / uLength) * (v.z / vLength)
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI
}

/** Unrounded world-space measurements, shared by recognition and debug telemetry. */
export function getFingerFeatures(landmarks: readonly Point3D[]): FingerFeatures[] | null {
  if (!hasValidHandLandmarks(landmarks)) return null

  const features: FingerFeatures[] = []
  for (const [finger, mcp, pip, dip, tip] of FINGERS) {
    const pipAngleDegrees = jointAngle(landmarks[mcp], landmarks[pip], landmarks[dip])
    const dipAngleDegrees = jointAngle(landmarks[pip], landmarks[dip], landmarks[tip])
    if (pipAngleDegrees === null || dipAngleDegrees === null) return null

    const boneLength = distance(landmarks[mcp], landmarks[pip]) +
      distance(landmarks[pip], landmarks[dip]) + distance(landmarks[dip], landmarks[tip])
    const reachPercent = 100 * (distance(landmarks[mcp], landmarks[tip]) / boneLength)
    if (!Number.isFinite(reachPercent)) return null
    features.push({ finger, pipAngleDegrees, dipAngleDegrees, reachPercent: Math.min(100, reachPercent) })
  }
  return features
}
