/** Unvalidated learned-model sessions are observational regardless of UI state. */
export function isEvaluationFrame(recording: boolean, benchmarking: boolean, model: 'landmarks' | 'learned'): boolean {
  return recording || benchmarking || model === 'learned'
}
