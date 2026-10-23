/**
 * Diagnostic-only metrics. Do not use them to activate pointer or scrolling.
 * World landmarks can become unreliable when fingers occlude each other.
 */
export type FingerExtensionReading = {
  finger: 'Index' | 'Middle' | 'Ring' | 'Pinky'
  pipAngleDegrees: number
  reachPercent: number
}

type Point3D = { x: number; y: number; z: number }

const FINGERS = [
  ['Index', 5, 6, 7, 8],
  ['Middle', 9, 10, 11, 12],
  ['Ring', 13, 14, 15, 16],
  ['Pinky', 17, 18, 19, 20]
] as const

function distance(a: Point3D, b: Point3D): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function jointAngle(a: Point3D, b: Point3D, c: Point3D): number | null {
  const ux = a.x - b.x
  const uy = a.y - b.y
  const uz = a.z - b.z
  const vx = c.x - b.x
  const vy = c.y - b.y
  const vz = c.z - b.z
  const magnitude = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz)
  if (magnitude <= 1e-8) return null
  const cosine = Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / magnitude))
  return Math.round(Math.acos(cosine) * 180 / Math.PI)
}

/**
 * Reach = direct MCP→tip distance / sum of MCP→PIP→DIP→tip bone lengths.
 * ~100% is fully straight; lower reach means a folded or uncertain finger.
 * No thresholds are applied because these values need live calibration.
 */
export function getFingerExtensionReadings(
  landmarks: Point3D[]
): FingerExtensionReading[] {
  if (landmarks.length !== 21 || !landmarks.every(point =>
    Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
  )) return []

  const result: FingerExtensionReading[] = []
  for (const [finger, mcp, pip, dip, tip] of FINGERS) {
    const angle = jointAngle(landmarks[mcp], landmarks[pip], landmarks[dip])
    const boneLength =
      distance(landmarks[mcp], landmarks[pip]) +
      distance(landmarks[pip], landmarks[dip]) +
      distance(landmarks[dip], landmarks[tip])
    if (angle === null || boneLength <= 1e-8) return []
    const reach = 100 * distance(landmarks[mcp], landmarks[tip]) / boneLength
    result.push({
      finger,
      pipAngleDegrees: angle,
      reachPercent: Math.round(Math.min(100, reach))
    })
  }
  return result
}
