import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from './GestureConfig.ts'
import type { Point2 } from './types.ts'
const clamp = (value: number) => Math.max(0, Math.min(1, value))

/** Internal geometry only: callers never move the system cursor. */
export class PointerController {
  private config: GestureConfig
  private position: Point2 | null = null
  private timestampMs: number | null = null

  constructor(config: GestureConfig = DEFAULT_GESTURE_CONFIG) { this.config = { ...config }; this.setGain(config.pointerGain) }

  /** Preserve filter position and time when tuning sensitivity during tracking. */
  setGain(gain: number) {
    if (!Number.isFinite(gain) || gain < 0.8 || gain > 2.5) throw new RangeError('Pointer gain must be between 0.8 and 2.5')
    this.config = { ...this.config, pointerGain: gain }
  }

  reset() { this.position = null; this.timestampMs = null }

  project(center: Point2, viewport: { width: number; height: number }): Point2 {
    return {
      x: clamp(0.5 + this.config.pointerGain * ((1 - center.x - this.config.pointerMinX) / (this.config.pointerMaxX - this.config.pointerMinX) - 0.5)) * viewport.width,
      y: clamp(0.5 + this.config.pointerGain * ((center.y - this.config.pointerMinY) / (this.config.pointerMaxY - this.config.pointerMinY) - 0.5)) * viewport.height,
    }
  }

  update(center: Point2, timestampMs: number, viewport: { width: number; height: number }): Point2 {
    const projected = this.project(center, viewport)
    const target = { x: projected.x / viewport.width, y: projected.y / viewport.height }
    if (this.position === null || this.timestampMs === null) this.position = target
    else if (Math.hypot(target.x - this.position.x, target.y - this.position.y) > this.config.pointerDeadZone) {
      const elapsed = Math.max(0, timestampMs - this.timestampMs)
      const alpha = this.config.pointerSmoothingMs <= 0 ? 1 : 1 - Math.exp(-elapsed / this.config.pointerSmoothingMs)
      this.position = { x: this.position.x + alpha * (target.x - this.position.x), y: this.position.y + alpha * (target.y - this.position.y) }
    }
    this.timestampMs = timestampMs
    return { x: this.position.x * viewport.width, y: this.position.y * viewport.height }
  }
}
