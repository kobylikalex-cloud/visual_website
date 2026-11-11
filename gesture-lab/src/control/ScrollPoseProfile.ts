import type { HandOrientationMetrics } from '../gestures/HandOrientationDiagnostics.ts'

export type ScrollPoseProfile = { enterDepth: number; exitDepth: number; enterFacing: number; exitFacing: number }
export const DEFAULT_SCROLL_POSE: ScrollPoseProfile = { enterDepth: 42, exitDepth: 27, enterFacing: 75, exitFacing: 90 }
export type PoseSample = { timestampMs: number; handId: number; pose: string; metrics: HandOrientationMetrics | null }

function valid(m: HandOrientationMetrics | null | undefined): m is HandOrientationMetrics {
  return !!m && Number.isFinite(m.imageTiltDegrees + m.depthTiltDegrees + m.palmFacingCameraPercent) &&
    m.imageTiltDegrees >= 0 && m.imageTiltDegrees <= 90 && m.depthTiltDegrees >= 0 && m.depthTiltDegrees <= 90 &&
    m.palmFacingCameraPercent >= 0 && m.palmFacingCameraPercent <= 100
}

export function classifyScrollPose(metrics: HandOrientationMetrics | null | undefined, profile: ScrollPoseProfile) {
  if (!valid(metrics)) return 'UNKNOWN' as const
  const { depthTiltDegrees: depth, palmFacingCameraPercent: facing } = metrics
  // Personal flat calibration must preserve the original clear upright band.
  if (depth <= 27 && facing >= 70) return 'POINTER' as const
  if (depth >= profile.enterDepth && facing <= profile.enterFacing) return 'ENTER' as const
  if (depth > profile.exitDepth && facing < profile.exitFacing) return 'RETAIN' as const
  return 'POINTER' as const
}

/** A bounded, settled flat-pose sample; stores metrics only, never landmarks. */
export function calibrateFlatPose(samples: readonly PoseSample[], now: number): ScrollPoseProfile {
  const last = samples.at(-1)
  if (!last || samples.length < 6 || !Number.isFinite(now) || now < last.timestampMs || now - last.timestampMs > 200 ||
      last.timestampMs - samples[0].timestampMs < 300 || samples.some((s, i) => s.handId !== last.handId || s.pose !== 'OPEN' ||
        !valid(s.metrics) || now - s.timestampMs > 1000 || i > 0 && (s.timestampMs <= samples[i - 1].timestampMs || s.timestampMs - samples[i - 1].timestampMs > 200))) {
    throw new RangeError('Hold one open flat hand steadily for half a second before capturing its posture.')
  }
  const depth = samples.map(s => s.metrics!.depthTiltDegrees).sort((a, b) => a - b)
  const facing = samples.map(s => s.metrics!.palmFacingCameraPercent).sort((a, b) => a - b)
  const spread = depth.at(-1)! - depth[0], facingSpread = facing.at(-1)! - facing[0]
  if (depth[Math.floor(depth.length / 2)] < 28 || spread > 15 || facingSpread > 25) {
    throw new RangeError('Posture overlaps upright aiming or is moving too much. Tilt the open palm flat and hold still.')
  }
  // Slack comes from observed spread (minimum one rounded metric unit). Keep
  // entry separate from the existing <=27° upright band. The old 15° gap
  // becomes retention hysteresis, accommodating arm-height changes after entry.
  const enterDepth = Math.max(28, depth[0] - Math.max(1, spread))
  const enterFacing = Math.min(95, facing.at(-1)! + Math.max(1, facingSpread))
  return { enterDepth, exitDepth: Math.max(0, enterDepth - 15), enterFacing, exitFacing: Math.min(100, enterFacing + 15) }
}
