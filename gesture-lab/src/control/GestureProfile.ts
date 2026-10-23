import { getFingerFeatures } from '../gestures/FingerGeometry.ts'
import { getHandOrientationMetrics } from '../gestures/HandOrientationDiagnostics.ts'
import type { HandPose } from '../gestures/HandPoseEngine.ts'
import type { HandOrientation } from '../gestures/HandOrientationDiagnostics.ts'
import type { Point3D } from '../gestures/TrackingQuality.ts'

export type CalibrationLabel = 'OPEN_UPRIGHT' | 'FIST' | 'OPEN_FLAT'
export type CalibrationSample = { pose: number[]; orientation: [number, number] }
export type GestureProfile = Record<CalibrationLabel, CalibrationSample>
export type CalibrationRecordings = Record<CalibrationLabel, CalibrationSample[]>
export type CalibratedGesture = { pose: HandPose; orientation: HandOrientation }

export function readCalibrationSample(landmarks: Point3D[]): CalibrationSample | null {
  const fingers = getFingerFeatures(landmarks)
  const orientation = getHandOrientationMetrics(landmarks)
  if (!fingers || !orientation || fingers.length !== 4) return null
  return {
    pose: fingers.flatMap(finger => [finger.reachPercent / 100, finger.pipAngleDegrees / 180]),
    orientation: [orientation.depthTiltDegrees / 90, orientation.palmFacingCameraPercent / 100],
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
}

function centroid(samples: CalibrationSample[]): CalibrationSample {
  return {
    pose: Array.from({ length: 8 }, (_, i) => median(samples.map(s => s.pose[i]))),
    orientation: [median(samples.map(s => s.orientation[0])), median(samples.map(s => s.orientation[1]))],
  }
}

function poseDistance(sample: CalibrationSample, center: CalibrationSample): number {
  const sum = sample.pose.reduce((total, v, index) => {
    const scale = index % 2 === 0 ? 0.18 : 0.24
    return total + Math.pow((v - center.pose[index]) / scale, 2)
  }, 0)
  return Math.sqrt(sum / 8)
}

function orientationDistance(sample: CalibrationSample, center: CalibrationSample): number {
  return Math.hypot(
    (sample.orientation[0] - center.orientation[0]) / 0.20,
    (sample.orientation[1] - center.orientation[1]) / 0.25,
  ) / Math.sqrt(2)
}

export function buildGestureProfile(recordings: CalibrationRecordings): GestureProfile | null {
  for (const key of ['OPEN_UPRIGHT', 'FIST', 'OPEN_FLAT'] as const) {
    if (!recordings[key] || recordings[key].length < 6) return null
  }
  const profile: GestureProfile = {
    OPEN_UPRIGHT: centroid(recordings.OPEN_UPRIGHT),
    FIST: centroid(recordings.FIST),
    OPEN_FLAT: centroid(recordings.OPEN_FLAT),
  }
  // Reject indistinguishable or mixed calibration poses. The user must record
  // three visibly different postures before controls can be reconfigured.
  if (Math.min(poseDistance(profile.FIST, profile.OPEN_UPRIGHT),
    poseDistance(profile.FIST, profile.OPEN_FLAT)) < 1.35 ||
    orientationDistance(profile.OPEN_UPRIGHT, profile.OPEN_FLAT) < 0.60) return null
  return profile
}

/** Session-calibrated nearest-template recognition, with an explicit reject band.
 * It is NOT a claim of general gesture accuracy; timing and target locking
 * remain mandatory before any action.
 */
export function recognizeCalibratedHand(landmarks: Point3D[], profile: GestureProfile): CalibratedGesture {
  const sample = readCalibrationSample(landmarks)
  if (!sample) return { pose: 'UNKNOWN', orientation: 'TRANSITION' }

  const openScore = Math.min(poseDistance(sample, profile.OPEN_UPRIGHT),
    poseDistance(sample, profile.OPEN_FLAT))
  const fistScore = poseDistance(sample, profile.FIST)
  if (fistScore < 1.50 && openScore - fistScore >= 0.45) {
    const facingFist = orientationDistance(sample, profile.FIST)
    return { pose: 'FIST', orientation: facingFist <= 2 ? 'UPRIGHT_LIKE' : 'TRANSITION' }
  }
  if (!(openScore < 1.50 && fistScore - openScore >= 0.45)) {
    return { pose: 'UNKNOWN', orientation: 'TRANSITION' }
  }

  const upright = orientationDistance(sample, profile.OPEN_UPRIGHT)
  const flat = orientationDistance(sample, profile.OPEN_FLAT)
  const orientation: HandOrientation =
    upright < 1.65 && flat - upright >= 0.25 ? 'UPRIGHT_LIKE'
      : flat < 1.65 && upright - flat >= 0.25 ? 'FLAT_LIKE'
        : 'TRANSITION'
  return { pose: 'OPEN', orientation }
}
