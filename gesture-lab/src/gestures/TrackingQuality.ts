export type Point3D = { x: number; y: number; z: number }

/** Structural validity only: this is not an occlusion or tracking-confidence score. */
export function hasValidHandLandmarks(landmarks: readonly Point3D[]): boolean {
  return landmarks?.length === 21 && Array.from(landmarks).every(point =>
    point != null && Number.isFinite(point.x) &&
    Number.isFinite(point.y) && Number.isFinite(point.z)
  )
}
