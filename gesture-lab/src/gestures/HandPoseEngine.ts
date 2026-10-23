
export type HandPose = 'OPEN' | 'FIST' | 'UNKNOWN'

type Point3D = {
  x: number
  y: number
  z: number
}

// MCP, PIP and DIP joints for four fingers
const FINGERS = [
  [5, 6, 7],    // Index
  [9, 10, 11],  // Middle
  [13, 14, 15], // Ring
  [17, 18, 19]  // Pinky
] as const

function calculateAngle(
  a: Point3D,
  b: Point3D,
  c: Point3D
): number | null {
  const ab = {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z
  }

  const cb = {
    x: c.x - b.x,
    y: c.y - b.y,
    z: c.z - b.z
  }

  const dot =
    ab.x * cb.x +
    ab.y * cb.y +
    ab.z * cb.z

  const lengthAB = Math.hypot(ab.x, ab.y, ab.z)
  const lengthCB = Math.hypot(cb.x, cb.y, cb.z)

  const denominator = lengthAB * lengthCB

  if (!Number.isFinite(denominator) || denominator < 1e-8) {
    return null
  }

  const cosine = Math.max(
    -1,
    Math.min(1, dot / denominator)
  )

  return Math.acos(cosine) * (180 / Math.PI)
}

export function classifyHandPose(
  landmarks: Point3D[]
): HandPose {
  if (!landmarks || landmarks.length !== 21) {
    return 'UNKNOWN'
  }

  let extended = 0
  let curled = 0

  for (const [mcp, pip, dip] of FINGERS) {
    const angle = calculateAngle(
      landmarks[mcp],
      landmarks[pip],
      landmarks[dip]
    )

    if (angle === null) return 'UNKNOWN'

    if (angle >= 145) {
      extended++
    } else if (angle <= 125) {
      curled++
    }
  }

  if (extended >= 3 && curled <= 1) {
    return 'OPEN'
  }

  if (curled >= 3 && extended <= 1) {
    return 'FIST'
  }

  return 'UNKNOWN'
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
