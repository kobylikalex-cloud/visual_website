/**
 * Camera-relative measurements for a single MediaPipe hand.
 *
 * Important: these angles are relative to the camera's coordinate system,
 * NOT the ground or gravity. They are diagnostics for later calibration;
 * they do not activate scrolling or mouse interactions.
 */
export type HandOrientationMetrics = {
  imageTiltDegrees: number
  depthTiltDegrees: number
  palmFacingCameraPercent: number
}

type Point3D = { x: number; y: number; z: number }

function subtract(a: Point3D, b: Point3D): Point3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function cross(a: Point3D, b: Point3D): Point3D {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  }
}

export function getHandOrientationMetrics(
  landmarks: Point3D[]
): HandOrientationMetrics | null {
  if (landmarks.length !== 21) return null

  const [wrist, indexMcp, middleMcp, pinkyMcp] =
    [landmarks[0], landmarks[5], landmarks[9], landmarks[17]]

  if (![wrist, indexMcp, middleMcp, pinkyMcp].every(
    point => Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      Number.isFinite(point.z)
  )) return null

  // Wrist -> middle-finger knuckle approximates the long palm axis.
  const longAxis = subtract(middleMcp, wrist)
  // Index -> pinky knuckle approximates the palm's width axis.
  const acrossPalm = subtract(pinkyMcp, indexMcp)
  const normal = cross(acrossPalm, longAxis)

  const projectedLength = Math.hypot(longAxis.x, longAxis.y)
  const fullLength = Math.hypot(projectedLength, longAxis.z)
  const normalLength = Math.hypot(normal.x, normal.y, normal.z)

  if (fullLength < 1e-8 || normalLength < 1e-8) return null

  return {
    // 0° = projected palm axis vertical; 90° = horizontal in image.
    imageTiltDegrees: Math.round(
      Math.atan2(Math.abs(longAxis.x), Math.abs(longAxis.y)) *
      180 / Math.PI
    ),
    // 0° = palm axis in image plane; 90° = toward/away from camera.
    depthTiltDegrees: Math.round(
      Math.atan2(Math.abs(longAxis.z), projectedLength) *
      180 / Math.PI
    ),
    // 100% = palm plane faces the camera; 0% = palm seen edge-on.
    palmFacingCameraPercent: Math.round(
      100 * Math.abs(normal.z) / normalLength
    )
  }
}
