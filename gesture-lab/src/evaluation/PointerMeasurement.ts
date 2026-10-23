import type { InteractionSnapshot, Point2 } from '../control/types.ts'
import { distribution } from '../tracking/TrackingPerformance.ts'

export type PointerMeasurement = {
  mode: 'off' | 'stationary' | 'moving'; points: Point2[]; frames: number; interruptions: number; switches: number
  previousFocus: string | null; wasConfirmed: boolean; startedAt: number | null; complete: boolean
}
export class PointerMeasurementSession {
  data: PointerMeasurement
  constructor(mode: PointerMeasurement['mode'] = 'off') {
    this.data = { mode, points: [], frames: 0, interruptions: 0, switches: 0, previousFocus: null, wasConfirmed: false, startedAt: null, complete: false }
  }
  observe(snapshot: InteractionSnapshot, confirmed: boolean, now: number, cameraFrame = false) {
    const m = this.data
    if (m.mode === 'off' || m.complete) return
    if (m.startedAt === null) m.startedAt = now
    if (m.mode === 'stationary' && now - m.startedAt >= 10000) { m.complete = true; return }
    if (cameraFrame) m.frames++
    if (m.wasConfirmed && !confirmed) m.interruptions++
    if (m.previousFocus && snapshot.focusId !== m.previousFocus) m.switches++
    m.previousFocus = snapshot.focusId; m.wasConfirmed = confirmed
    if (cameraFrame && snapshot.pointer) { m.points.push({ ...snapshot.pointer }); if (m.points.length > 1800) m.points.shift() }
  }
}

/** Software capture-to-first CSS feedback, excludes unobservable camera/display latency. */
export class FeedbackLatency {
  private pending: number | null = null
  private samples: number[] = []
  submitted(timestamp: number) { this.pending = timestamp }
  cancel() { this.pending = null }
  rendered(now: number) {
    if (this.pending === null) return
    this.samples.push(now - this.pending); this.pending = null
    if (this.samples.length > 300) this.samples.shift()
  }
  report() { return distribution(this.samples) }
}
