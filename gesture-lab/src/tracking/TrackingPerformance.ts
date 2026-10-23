export function distribution(values: readonly number[]) {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b)
  if (!sorted.length) return { median: null, p95: null }
  const middle = Math.floor(sorted.length / 2)
  return { median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * .95) - 1] }
}

/** One capture/inference in flight, no queued backlog. Tokens survive reset. */
export class FrameGate {
  private sequence = 0
  private active: number | null = null
  startedAt = 0
  begin(now: number): number | null { if (this.active !== null) return null; this.startedAt = now; return this.active = ++this.sequence }
  finish(token: number): boolean { if (this.active !== token) return false; this.active = null; return true }
  reset() { this.active = null; this.sequence++; this.startedAt = 0 }
  get busy() { return this.active !== null }
}

export class TrackingPerformance {
  private capacity: number
  private started = 0
  private processed = 0
  private cameraCount = 0
  private lastCamera: number | null = null
  private lastRender: number | null = null
  private renderIntervals: number[] = []
  private inference: number[] = []
  private delivery: number[] = []
  private processing: number[] = []
  private longTaskCount = 0
  private longTaskMs = 0
  private drops = { busy: 0, stale: 0, transfer: 0 }
  constructor(capacity = 300) { this.capacity = capacity }
  start(now: number) { this.started = now }
  private add(list: number[], value: number) { list.push(value); if (list.length > this.capacity) list.shift() }
  render(now: number) { if (this.lastRender !== null && now > this.lastRender) this.add(this.renderIntervals, now - this.lastRender); this.lastRender = now }
  camera(presentedFrames: number) { this.cameraCount += this.lastCamera === null ? 1 : Math.max(0, presentedFrames - this.lastCamera); this.lastCamera = presentedFrames }
  drop(kind: keyof TrackingPerformance['drops']) { this.drops[kind]++ }
  result(inferenceMs: number, processingMs: number, deliveryMs: number) { this.processed++; this.add(this.inference, inferenceMs); this.add(this.processing, processingMs); this.add(this.delivery, deliveryMs) }
  longTask(duration: number) { this.longTaskCount++; this.longTaskMs += duration }
  report(now: number) {
    const seconds = Math.max(.001, (now - this.started) / 1000)
    const meanRender = this.renderIntervals.length ? this.renderIntervals.reduce((a, b) => a + b, 0) / this.renderIntervals.length : 0
    return { seconds, processedFrames: this.processed, processedFps: this.processed / seconds,
      renderFps: meanRender ? 1000 / meanRender : null, renderInterval: distribution(this.renderIntervals),
      inference: distribution(this.inference), processing: distribution(this.processing), delivery: distribution(this.delivery),
      cameraFrames: this.cameraCount, cameraFps: this.cameraCount / seconds,
      unprocessedCameraFrames: Math.max(0, this.cameraCount - this.processed), drops: { ...this.drops }, longTaskCount: this.longTaskCount, longTaskMs: this.longTaskMs }
  }
}
export type PerformanceReport = ReturnType<TrackingPerformance['report']>
