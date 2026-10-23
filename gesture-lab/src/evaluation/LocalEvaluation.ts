import type { HandPose } from '../gestures/HandPoseEngine.ts'
import { hasValidHandLandmarks, type Point3D } from '../gestures/TrackingQuality.ts'
import type { ComparisonRow, Prediction } from './RecognitionComparison.ts'

export const TRUTH_LABELS = ['OPEN_UPRIGHT', 'OPEN_FLAT', 'FIST', 'OTHER'] as const
export type TruthLabel = typeof TRUTH_LABELS[number]
export type HandLabel = 'Left' | 'Right'
export type EvaluationSample = {
  timestampMs: number
  hand: HandLabel
  truth: TruthLabel
  segmentId: number
  markerMs: number
  landmarks: Point3D[] | null
  observed: boolean
  inferenceMs: number
  conservative: Prediction
  hybrid: Prediction
  orientation: ComparisonRow['orientation']
  orientationMetrics: ComparisonRow['orientationMetrics']
}
type Marker = { truth: TruthLabel; since: number; segmentId: number }
const unknown = (): Prediction => ({ raw: 'UNKNOWN', stable: 'UNKNOWN', computeMs: null })
const expectedPose = (truth: TruthLabel): HandPose => truth.startsWith('OPEN_') ? 'OPEN' : truth === 'FIST' ? 'FIST' : 'UNKNOWN'

/** Opt-in, bounded memory only. Explicit download is handled separately by the debug UI. */
export class LocalEvaluation {
  samples: EvaluationSample[] = []
  recording = false
  private labels = new Map<HandLabel, Marker>()
  private segmentId = 0
  private startedAt = 0
  private maxSamples: number

  constructor(maxSamples = 10000) {
    if (!Number.isInteger(maxSamples) || maxSamples < 1) throw new RangeError('Invalid sample limit')
    this.maxSamples = maxSamples
  }

  setLabel(hand: HandLabel, truth: TruthLabel | null, nowMs: number): void {
    if (truth === null) this.labels.delete(hand)
    else this.labels.set(hand, { truth, since: nowMs, segmentId: ++this.segmentId })
  }

  getLabel(hand: HandLabel): TruthLabel | null {
    return this.labels.get(hand)?.truth ?? null
  }

  start(nowMs: number): void {
    this.samples = []
    this.startedAt = nowMs
    this.recording = this.labels.size > 0
    for (const marker of this.labels.values()) {
      marker.since = nowMs
      marker.segmentId = ++this.segmentId
    }
  }

  stop(): void { this.recording = false }

  clear(): void {
    this.stop()
    this.samples = []
  }

  record(rows: readonly ComparisonRow[], nowMs: number, inferenceMs: number): void {
    if (!this.recording) return
    // Never truncate only one hand of a two-hand frame at the capacity boundary.
    if (this.samples.length + this.labels.size > this.maxSamples) { this.stop(); return }
    for (const [hand, marker] of this.labels) {
      const matching = rows.filter(row => row.label === hand && row.identityReliable)
      const row = matching.length === 1 ? matching[0] : undefined
      this.samples.push({
        timestampMs: nowMs - this.startedAt, hand, truth: marker.truth,
        segmentId: marker.segmentId, markerMs: marker.since - this.startedAt,
        landmarks: row && hasValidHandLandmarks(row.landmarks) ? row.landmarks.map(point => ({ ...point })) : null,
        observed: !!row, inferenceMs,
        conservative: row ? { ...row.conservative } : unknown(),
        hybrid: row ? { ...row.hybrid } : unknown(),
        orientation: row?.orientation ?? 'TRANSITION', orientationMetrics: row?.orientationMetrics ?? null,
      })
    }
    if (this.samples.length >= this.maxSamples) this.stop()
  }
}

function distribution(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return {
    count: sorted.length,
    medianMs: sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null,
    p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
  }
}

export function summarizeEvaluation(samples: readonly EvaluationSample[]) {
  function stage(algorithm: 'conservative' | 'hybrid', output: 'raw' | 'stable') {
    function binary(target: 'OPEN' | 'FIST') {
      let tp = 0, fn = 0, fp = 0, tn = 0
      for (const sample of samples) {
        const positive = expectedPose(sample.truth) === target
        const predicted = sample[algorithm][output] === target
        if (positive) { if (predicted) tp++; else fn++ }
        else { if (predicted) fp++; else tn++ }
      }
      return { tp, fn, fp, tn, positives: tp + fn, negatives: fp + tn,
        falseNegativeRate: tp + fn ? fn / (tp + fn) : null,
        falsePositiveRate: fp + tn ? fp / (fp + tn) : null }
    }
    const byLabel = Object.fromEntries(TRUTH_LABELS.map(label => [label,
      { total: 0, OPEN: 0, FIST: 0, UNKNOWN: 0 }]))
    const segments = new Map<string, { firstMatch: number | null }>()
    for (const sample of samples) {
      const predicted = sample[algorithm][output]
      byLabel[sample.truth].total++
      byLabel[sample.truth][predicted]++
      // Positive-pose acquisition only; OTHER false activations are scored above.
      if (sample.truth === 'OTHER') continue
      const key = `${sample.hand}:${sample.segmentId}`
      const segment = segments.get(key) ?? { firstMatch: null }
      if (predicted === expectedPose(sample.truth) && segment.firstMatch === null) {
        segment.firstMatch = Math.max(0, sample.timestampMs - sample.markerMs)
      }
      segments.set(key, segment)
    }
    const recognized = [...segments.values()].flatMap(value => value.firstMatch === null ? [] : [value.firstMatch])
    return { OPEN: binary('OPEN'), FIST: binary('FIST'), byLabel,
      unknown: samples.filter(sample => sample[algorithm][output] === 'UNKNOWN').length,
      latency: { ...distribution(recognized), segments: segments.size, unrecognized: segments.size - recognized.length } }
  }
  function algorithm(name: 'conservative' | 'hybrid') {
    return { raw: stage(name, 'raw'), stable: stage(name, 'stable'),
      compute: distribution(samples.flatMap(sample => sample[name].computeMs === null ? [] : [sample[name].computeMs])) }
  }
  return { samples: samples.length, missingOrAmbiguous: samples.filter(sample => !sample.observed).length,
    conservative: algorithm('conservative'), hybrid: algorithm('hybrid'),
    inference: distribution(samples.map(sample => sample.inferenceMs)) }
}
