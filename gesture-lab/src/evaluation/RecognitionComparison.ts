import { classifyHandPose, HandPoseStabilizer, type HandPose } from '../gestures/HandPoseEngine.ts'
import { getHandOrientationMetrics, classifyHandOrientation } from '../gestures/HandOrientationDiagnostics.ts'
import { hasValidHandLandmarks, type Point3D } from '../gestures/TrackingQuality.ts'
import { classifyHybridHandPose } from './HistoricalHybrid.ts'

export type Prediction = { raw: HandPose; stable: HandPose; computeMs: number | null }
export type ComparisonRow = {
  label: string
  identityReliable: boolean
  landmarks: Point3D[]
  conservative: Prediction
  hybrid: Prediction
  orientation: ReturnType<typeof classifyHandOrientation>
  orientationMetrics: ReturnType<typeof getHandOrientationMetrics>
}

/** Shadow evaluation only: the two pipelines share inputs and temporal policy, never state. */
export class RecognitionComparison {
  private filters = new Map<string, { conservative: HandPoseStabilizer; hybrid: HandPoseStabilizer }>()

  reset(): void { this.filters.clear() }

  update(hands: readonly { label: string; landmarks: Point3D[] }[], nowMs: number): ComparisonRow[] {
    const counts = new Map<string, number>()
    for (const hand of hands) counts.set(hand.label, (counts.get(hand.label) ?? 0) + 1)
    const valid = new Set(hands.filter(hand =>
      (hand.label === 'Left' || hand.label === 'Right') && counts.get(hand.label) === 1
    ).map(hand => hand.label))
    for (const key of this.filters.keys()) if (!valid.has(key)) this.filters.delete(key)

    return hands.map(({ label, landmarks }) => {
      const identityReliable = valid.has(label)
      let filters = this.filters.get(label)
      if (!filters && identityReliable) {
        filters = { conservative: new HandPoseStabilizer(150), hybrid: new HandPoseStabilizer(150) }
        this.filters.set(label, filters)
      }
      const start = performance.now()
      const conservative = classifyHandPose(landmarks)
      const middle = performance.now()
      const hybrid = classifyHybridHandPose(landmarks)
      const end = performance.now()
      const orientationMetrics = hasValidHandLandmarks(landmarks) ? getHandOrientationMetrics(landmarks) : null
      return {
        label, landmarks, identityReliable,
        conservative: { raw: conservative, stable: filters?.conservative.update(conservative, nowMs) ?? 'UNKNOWN', computeMs: middle - start },
        hybrid: { raw: hybrid, stable: filters?.hybrid.update(hybrid, nowMs) ?? 'UNKNOWN', computeMs: end - middle },
        orientation: classifyHandOrientation(orientationMetrics), orientationMetrics,
      }
    })
  }
}
