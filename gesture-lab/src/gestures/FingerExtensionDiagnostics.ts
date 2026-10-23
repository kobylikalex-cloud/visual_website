import { getFingerFeatures, type FingerFeatures } from './FingerGeometry.ts'
import type { Point3D } from './TrackingQuality.ts'

export type FingerExtensionReading = FingerFeatures

/** Rounded display readings only. Reach remains telemetry until live calibration. */
export function getFingerExtensionReadings(landmarks: readonly Point3D[]): FingerExtensionReading[] {
  return (getFingerFeatures(landmarks) ?? []).map(reading => ({
    finger: reading.finger,
    pipAngleDegrees: Math.round(reading.pipAngleDegrees),
    dipAngleDegrees: Math.round(reading.dipAngleDegrees),
    reachPercent: Math.round(reading.reachPercent),
  }))
}
