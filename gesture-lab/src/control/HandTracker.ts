import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from './GestureConfig.ts'
import type { Detection, Point2, TrackedHand, TrackingFrame, TrackingResult } from './types.ts'
import { hasValidHandLandmarks } from '../gestures/TrackingQuality.ts'
import { recognizeControlHand } from './ControlRecognition.ts'

const distance = (a: Point2, b: Point2): number => Math.hypot(a.x - b.x, a.y - b.y)

function palmCenter(detection: Detection): Point2 | null {
  // Tracking position and finger recognition are distinct. A bad/occluded
  // fingertip can make the gesture UNKNOWN but must not erase a visible palm.
  if (!detection || !hasValidHandLandmarks(detection.landmarks) ||
      !hasValidHandLandmarks(detection.worldLandmarks)) return null

  const points = detection.landmarks
  const palm = [points[0], points[5], points[9], points[13], points[17]]
  // Fingers can leave the camera bounds while the palm remains in view.
  // Reject only the palm moving outside the image, not individual fingertips.
  if (palm.some(p => p.x < -0.04 || p.x > 1.04 || p.y < -0.04 || p.y > 1.04)) return null
  const wrist = points[0]
  const long = { x: points[9].x - wrist.x, y: points[9].y - wrist.y }
  const across = { x: points[17].x - points[5].x, y: points[17].y - points[5].y }
  // Reject a genuinely collapsed palm, not an edge-on finger silhouette.
  if (Math.abs(long.x * across.y - long.y * across.x) <= 1e-10) return null
  const center = {
    x: palm.reduce((sum, point) => sum + point.x, 0) / palm.length,
    y: palm.reduce((sum, point) => sum + point.y, 0) / palm.length,
  }
  // Controllers project this center into a [0, 1] viewport.
  return center.x >= 0 && center.x <= 1 && center.y >= 0 && center.y <= 1
    ? center : null
}

/** Minimum simultaneous separation along two linear frame-to-frame movements. */
function movementSeparation(a0: Point2, a1: Point2, b0: Point2, b1: Point2): number {
  const start = { x: a0.x - b0.x, y: a0.y - b0.y }
  const delta = { x: a1.x - b1.x - start.x, y: a1.y - b1.y - start.y }
  const lengthSquared = delta.x * delta.x + delta.y * delta.y
  const time = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    -(start.x * delta.x + start.y * delta.y) / lengthSquared))
  return Math.hypot(start.x + time * delta.x, start.y + time * delta.y)
}

export class HandTracker {
  private readonly config: GestureConfig
  private previous: TrackedHand[] = []
  private lastTimestamp: number | null = null
  private nextId = 1

  constructor(config: GestureConfig = DEFAULT_GESTURE_CONFIG) {
    this.config = { ...config }
    for (const key of ['freshnessMs', 'trackMatchDistance', 'trackAmbiguityMargin', 'crossingDistance'] as const) {
      if (!Number.isFinite(config[key]) || config[key] < 0) throw new RangeError(`Invalid ${key}`)
    }
  }

  update(frame: TrackingFrame): TrackingResult {
    const timestamp = frame.timestampMs
    if (!Number.isFinite(timestamp) || timestamp < 0 ||
        (this.lastTimestamp !== null && timestamp <= this.lastTimestamp)) {
      return this.invalidate('Invalid or nonmonotonic frame timestamp')
    }
    const stale = this.lastTimestamp !== null && timestamp - this.lastTimestamp > this.config.freshnessMs
    this.lastTimestamp = timestamp
    if (stale) return this.invalidate('Frame arrived after tracking expired')
    if (!Array.isArray(frame.detections) || frame.detections.length > 2) {
      return this.invalidate('Unsupported hand count')
    }
    if (frame.detections.length === 0) {
      this.previous = []
      return { hands: [], ambiguous: false, reason: 'No hands detected' }
    }

    const centers = Array.from(frame.detections, palmCenter)
    if (centers.some(center => center === null)) return this.invalidate('Invalid or degenerate hand geometry')
    const validCenters = centers as Point2[]
    if (validCenters.length === 2 && distance(validCenters[0], validCenters[1]) <= this.config.crossingDistance) {
      return this.invalidate('Hands are too close for reliable identity')
    }

    // Enumerate the complete one-to-one assignments (at most two hands). New
    // detections get -1; missing previous hands vanish immediately. Labels never enter identity.
    let assignment = validCenters.map(() => -1)
    if (this.previous.length > 0) {
      const options = this.previous.length === 1
        ? (validCenters.length === 1 ? [[0]] : [[0, -1], [-1, 0]])
        : (validCenters.length === 1 ? [[0], [1]] : [[0, 1], [1, 0]])
      const candidates = options.map(indices => {
        const jumps = indices.map((previous, index) => previous < 0 ? 0 :
          distance(this.previous[previous].center, validCenters[index]))
        return { indices, jumps, cost: jumps.reduce((sum, value) => sum + value, 0) }
      }).filter(option => option.jumps.every(jump => jump <= this.config.trackMatchDistance))
        .sort((a, b) => a.cost - b.cost)
      if (!candidates.length) return this.invalidate('Hand movement exceeds association distance')
      if (candidates.length > 1 && candidates[1].cost - candidates[0].cost <= this.config.trackAmbiguityMargin) {
        return this.invalidate('Spatial association is ambiguous')
      }
      assignment = candidates[0].indices
      if (this.previous.length === 2 && validCenters.length === 2 &&
          movementSeparation(this.previous[assignment[0]].center, validCenters[0],
            this.previous[assignment[1]].center, validCenters[1]) <= this.config.crossingDistance) {
        return this.invalidate('Hand movements cross or overlap')
      }
    }

    const hands = frame.detections.map((detection, index): TrackedHand => ({
      id: assignment[index] < 0 ? this.nextId++ : this.previous[assignment[index]].id,
      center: validCenters[index],
      ...recognizeControlHand(detection.worldLandmarks),
      timestampMs: timestamp,
    }))
    // Return raw recognition uncertainty; confirmation belongs to the action state machine.
    this.previous = hands
    return { hands, ambiguous: false, reason: 'Spatial tracking valid' }
  }

  private invalidate(reason: string): TrackingResult {
    this.previous = []
    return { hands: [], ambiguous: true, reason }
  }

  reset(): void {
    this.previous = []
    this.lastTimestamp = null
    // Keep IDs unique across cancellation/reset so old intent cannot attach to a new hand.
  }
}
