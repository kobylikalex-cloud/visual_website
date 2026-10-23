import {
  getFingerExtensionReadings,
  type FingerExtensionReading
} from './FingerExtensionDiagnostics'

export type HandPose = 'OPEN' | 'FIST' | 'UNKNOWN'

/**
 * Combine PIP angles with finger-tip reach rather than relying on PIP
 * angles alone. A horizontal open hand can have inaccurate/occluded
 * PIP landmarks even while the finger tips remain visibly extended.
 *
 * Thresholds are provisional, calibrated against one recorded laptop
 * webcam session. Do not use this classification alone to trigger
 * destructive or irreversible actions.
 */
export function classifyFingerReadings(
  readings: FingerExtensionReading[]
): HandPose {
  if (readings.length !== 4) return 'UNKNOWN'

  let extended = 0
  let curled = 0

  for (const reading of readings) {
    const { pipAngleDegrees: angle, reachPercent: reach } = reading

    if (!Number.isFinite(angle) || !Number.isFinite(reach)) return 'UNKNOWN'

    // Two independent signs of extension. The reach fallback is useful
    // when horizontal fingers partly occlude the PIP landmarks.
    const isExtended =
      (angle >= 145 && reach >= 65) ||
      (angle >= 100 && reach >= 70)

    // Require joint bend AND a short MCP-to-tip reach to identify a fist.
    // A faulty PIP angle alone must not be counted as a curled finger.
    const isCurled = angle <= 135 && reach <= 58

    if (isExtended) extended++
    else if (isCurled) curled++
  }

  if (curled >= 3 && extended <= 1) return 'FIST'
  if (extended >= 3 && curled <= 1) return 'OPEN'
  return 'UNKNOWN'
}

export function classifyHandPose(
  landmarks: { x: number; y: number; z: number }[]
): HandPose {
  return classifyFingerReadings(getFingerExtensionReadings(landmarks))
}

/**
 * Temporal filter: pose changes are committed only after the same raw
 * classification has persisted for confirmMs milliseconds.
 * A single noisy UNKNOWN frame must not cancel a valid OPEN or FIST.
 */
export class HandPoseStabilizer {
  private stable: HandPose = 'UNKNOWN'
  private candidate: HandPose | null = null
  private candidateSince = 0

  private readonly confirmMs: number

  constructor(confirmMs = 150) {
    this.confirmMs = confirmMs
  }

  update(raw: HandPose, timestampMs: number): HandPose {
    if (raw === this.stable) {
      this.candidate = null
      return this.stable
    }

    if (raw !== this.candidate) {
      this.candidate = raw
      this.candidateSince = timestampMs
      return this.stable
    }

    if (timestampMs - this.candidateSince >= this.confirmMs) {
      this.stable = raw
      this.candidate = null
    }

    return this.stable
  }

  reset(): void {
    this.stable = 'UNKNOWN'
    this.candidate = null
    this.candidateSince = 0
  }
}
