import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from './GestureConfig.ts'
import type { Point2 } from './types.ts'
const clamp = (value: number) => Math.max(0, Math.min(1, value))

/** Internal geometry only: callers never move the system cursor. */
export class PointerController {
  private config: GestureConfig
  private position: Point2 | null = null
  private timestampMs: number | null = null

  constructor(config: GestureConfig = DEFAULT_GESTURE_CONFIG) { this.config = config }

  reset() { this.position = null; this.timestampMs = null }

  project(center: Point2, viewport: { width: number; height: number }): Point2 {
    return {
      x: clamp((1 - center.x - this.config.pointerMinX) / (this.config.pointerMaxX - this.config.pointerMinX)) * viewport.width,
      y: clamp((center.y - this.config.pointerMinY) / (this.config.pointerMaxY - this.config.pointerMinY)) * viewport.height,
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
