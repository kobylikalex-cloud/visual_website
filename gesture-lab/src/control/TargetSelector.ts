import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from './GestureConfig.ts'
import type { Point2, InteractionTarget } from './types.ts'

export function distanceToTarget(point: Point2, target: InteractionTarget): number {
  const { left, top, width, height } = target.rect
  return Math.hypot(Math.max(left - point.x, 0, point.x - left - width), Math.max(top - point.y, 0, point.y - top - height))
}

export class TargetSelector {
  private config: GestureConfig
  private focusId: string | null = null
  private focusedSince = 0

  constructor(config: GestureConfig = DEFAULT_GESTURE_CONFIG) { this.config = config }

  reset() { this.focusId = null; this.focusedSince = 0 }

  update(point: Point2, targets: InteractionTarget[], timestampMs: number): { focusId: string | null; proximity: Record<string, number> } {
    const eligible = targets.filter(target => !target.disabled)
    const distances = new Map(eligible.map(target => [target.id, distanceToTarget(point, target)]))
    const proximity = Object.fromEntries(eligible.map(target => [target.id, Math.max(0, 1 - distances.get(target.id)! / this.config.targetExitRadius)]))
    const currentDistance = this.focusId === null ? Infinity : distances.get(this.focusId) ?? Infinity
    const nearest = eligible.reduce<InteractionTarget | null>((best, target) => best === null || distances.get(target.id)! < distances.get(best.id)! ? target : best, null)
    let next = this.focusId
    if (currentDistance > this.config.targetExitRadius) next = null
    if (nearest && distances.get(nearest.id)! <= this.config.targetEnterRadius &&
      (next === null || distances.get(nearest.id)! + this.config.targetSwitchMargin < currentDistance)) next = nearest.id
    if (next !== this.focusId) { this.focusId = next; this.focusedSince = timestampMs }
    return { focusId: this.focusId, proximity }
  }

  isLocked(timestampMs: number) { return this.focusId !== null && timestampMs - this.focusedSince >= this.config.targetLockMs }
}
