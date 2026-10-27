import type { Point3D } from '../gestures/TrackingQuality'
export type Delegate = 'CPU' | 'GPU'
export type BackendMode = 'AUTO' | Delegate | 'COMPARE'
export type RecognitionModel = 'landmarks' | 'learned'
export type ResultGeometry = { landmarks: (Point3D & { visibility: number })[][]; worldLandmarks: Point3D[][]; handedness: { categoryName: string }[][];
  learnedGestures?: { categoryName: string; score: number }[][] }
export type BenchmarkReport = { samples: number; CPU: { median: number | null; p95: number | null } | null; GPU: { median: number | null; p95: number | null } | null; unavailable: string[] }
export type InferenceWorkerMessage =
  | { type: 'ready'; backend: Delegate; benchmarking: boolean }
  | ({ type: 'result'; token: number; timestampMs: number; inferenceMs: number; benchmark?: BenchmarkReport } & ResultGeometry)
  | { type: 'skipped'; token: number; timestampMs: number }
  | { type: 'error'; message: string }
export type WorkerInput = { type: 'init'; mode: BackendMode; recognitionModel?: RecognitionModel } | { type: 'frame'; bitmap: ImageBitmap; timestampMs: number; token: number }
