import type { GestureConfig } from './GestureConfig.ts'
import type { Point2 } from './types.ts'

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

/** Shift the active area around a measured palm center; recognition thresholds stay fixed. */
export function calibratePointer(center: Point2, config: GestureConfig): GestureConfig {
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return { ...config }
  const x = clamp(1 - center.x, 0.05, 0.95)
  const y = clamp(center.y, 0.05, 0.95)
  // Preserve the measured center by narrowing an off-center range to fit the image.
  const width = Math.min(config.pointerMaxX - config.pointerMinX, 2 * x, 2 * (1 - x))
  const height = Math.min(config.pointerMaxY - config.pointerMinY, 2 * y, 2 * (1 - y))
  return { ...config, pointerMinX: x - width / 2, pointerMaxX: x + width / 2,
    pointerMinY: y - height / 2, pointerMaxY: y + height / 2 }
}

export function constrainCardPosition(position: Point2, delta: Point2,
  arena: { width: number; height: number }, card: { width: number; height: number }): Point2 {
  const xLimit = Math.max(0, (arena.width - card.width) / 2)
  const yLimit = Math.max(0, (arena.height - card.height) / 2)
  return { x: clamp(position.x + delta.x, -xLimit, xLimit), y: clamp(position.y + delta.y, -yLimit, yLimit) }
}
